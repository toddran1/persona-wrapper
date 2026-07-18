import { randomUUID } from "node:crypto";
import { extname } from "node:path";
import type { ContentBlock } from "@persona/shared";
import OpenAI from "openai";
import { eq, lte } from "drizzle-orm";
import { env } from "../config/env.js";
import { getDatabase } from "../db/client.js";
import { openAIArtifacts } from "../db/schema.js";
import { HttpError } from "../utils/httpError.js";
import { logger } from "../utils/logger.js";
import { storageService } from "./storageService.js";

type Artifact = {
  id: string;
  containerId: string;
  fileId: string;
  fileName: string;
  mimeType: string;
  ownerId?: string | null;
  conversationId?: string | null;
  messageId?: string | null;
  storageKey?: string | null;
  localPath?: string | null;
  sizeBytes?: number | null;
  metadata?: Record<string, unknown> | null;
  expiresAt: number;
};

type ArtifactOwnershipOptions = {
  ownerId?: string;
  conversationId?: string;
  messageId?: string;
  metadata?: Record<string, unknown>;
};

type DownloadedArtifact = {
  buffer: Buffer;
  fileName: string;
  mimeType: string;
};

function safeFileName(fileName: string): string {
  return fileName.replace(/[^a-zA-Z0-9._-]/g, "_").replace(/_+/g, "_").slice(0, 120) || "openai-artifact.bin";
}

function artifactExpiresAt(): Date {
  if (env.OPENAI_ARTIFACT_TTL_HOURS <= 0) {
    return new Date("9999-12-31T23:59:59.000Z");
  }
  return new Date(Date.now() + env.OPENAI_ARTIFACT_TTL_HOURS * 60 * 60 * 1000);
}

function mimeTypeForFileName(fileName: string): string {
  const extension = extname(fileName).toLowerCase();
  if (extension === ".png") return "image/png";
  if (extension === ".jpg" || extension === ".jpeg") return "image/jpeg";
  if (extension === ".webp") return "image/webp";
  if (extension === ".gif") return "image/gif";
  if (extension === ".svg") return "image/svg+xml";
  if (extension === ".mp4") return "video/mp4";
  if (extension === ".webm") return "video/webm";
  if (extension === ".mp3") return "audio/mpeg";
  if (extension === ".wav") return "audio/wav";
  if (extension === ".csv") return "text/csv";
  if (extension === ".txt") return "text/plain";
  if (extension === ".json") return "application/json";
  if (extension === ".pdf") return "application/pdf";
  if (extension === ".xlsx") return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  return "application/octet-stream";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function openAIArtifactIdFromUrl(url: string): string | undefined {
  const match = /^\/api\/openai-artifacts\/([^/?#]+)/.exec(url);
  return match?.[1];
}

function withDefinedOwnership(options: ArtifactOwnershipOptions): Partial<Pick<Artifact, "ownerId" | "conversationId" | "messageId" | "metadata">> {
  return {
    ...(options.ownerId ? { ownerId: options.ownerId } : {}),
    ...(options.conversationId ? { conversationId: options.conversationId } : {}),
    ...(options.messageId ? { messageId: options.messageId } : {}),
    ...(options.metadata ? { metadata: options.metadata } : {})
  };
}

export class OpenAIArtifactService {
  private readonly artifacts = new Map<string, Artifact>();

  register(containerId: string, fileId: string, fileName: string, options: ArtifactOwnershipOptions = {}): string {
    const id = `artifact_${randomUUID()}`;
    const safeName = safeFileName(fileName);
    const mimeType = mimeTypeForFileName(safeName);
    const expiresAt = artifactExpiresAt();
    const artifact: Artifact = {
      id,
      containerId,
      fileId,
      fileName: safeName,
      mimeType,
      ...withDefinedOwnership(options),
      expiresAt: expiresAt.getTime()
    };
    this.artifacts.set(id, artifact);
    void this.persist(artifact, expiresAt).catch((error) => {
      logger.warn("OpenAI artifact persistence failed", {
        artifactId: id,
        fileId,
        error: error instanceof Error ? error.message : String(error)
      });
    });
    return `/api/openai-artifacts/${id}`;
  }

  async assignOwnership(id: string, options: ArtifactOwnershipOptions): Promise<void> {
    const existing = await this.lookup(id);
    if (!existing) return;

    const nextMetadata = {
      ...(existing.metadata ?? {}),
      ...(options.metadata ?? {})
    };
    const nextArtifact: Artifact = {
      ...existing,
      ...(options.ownerId ? { ownerId: options.ownerId } : {}),
      ...(options.conversationId ? { conversationId: options.conversationId } : {}),
      ...(options.messageId ? { messageId: options.messageId } : {}),
      ...(Object.keys(nextMetadata).length > 0 ? { metadata: nextMetadata } : {})
    };
    this.artifacts.set(id, nextArtifact);

    const db = getDatabase();
    if (db) {
      await db.update(openAIArtifacts)
        .set({
          ...(options.ownerId ? { ownerId: options.ownerId } : {}),
          ...(options.conversationId ? { conversationId: options.conversationId } : {}),
          ...(options.messageId ? { messageId: options.messageId } : {}),
          ...(Object.keys(nextMetadata).length > 0 ? { metadata: nextMetadata } : {})
        })
        .where(eq(openAIArtifacts.id, id));
    }
  }

  async assignOwnershipToContentBlocks(blocks: ContentBlock[], options: ArtifactOwnershipOptions): Promise<ContentBlock[]> {
    const updatedBlocks: ContentBlock[] = [];
    for (const block of blocks) {
      if (!("url" in block) || typeof block.url !== "string") {
        updatedBlocks.push(block);
        continue;
      }

      const artifactId = openAIArtifactIdFromUrl(block.url);
      if (!artifactId) {
        updatedBlocks.push(block);
        continue;
      }

      await this.assignOwnership(artifactId, {
        ...options,
        metadata: {
          ...(options.metadata ?? {}),
          storage: "openai_artifact",
          openAIArtifactId: artifactId
        }
      });

      if (block.type === "audio") {
        updatedBlocks.push(block);
        continue;
      }

      if (block.type === "image" || block.type === "video" || block.type === "file") {
        updatedBlocks.push({
          ...block,
          metadata: {
            ...(isRecord(block.metadata) ? block.metadata : {}),
            ...(options.metadata ?? {}),
            storage: "openai_artifact",
            openAIArtifactId: artifactId
          }
        });
        continue;
      }

      updatedBlocks.push(block);
    }
    return updatedBlocks;
  }

  async download(id: string, ownerId?: string): Promise<DownloadedArtifact> {
    await this.cleanupExpiredNow();
    const artifact = await this.lookup(id);
    if (!artifact) throw new HttpError("Generated file not found.", 404);
    if (artifact.ownerId && !ownerId && env.AUTH_REQUIRE_OWNED_MEDIA_ACCESS) {
      throw new HttpError("Generated file not found.", 404);
    }
    if (artifact.ownerId && ownerId && artifact.ownerId !== ownerId) {
      throw new HttpError("Generated file not found.", 404);
    }

    if (artifact.storageKey) {
      const stored = await storageService.get(artifact.storageKey);
      return {
        buffer: stored.buffer,
        fileName: artifact.fileName,
        mimeType: artifact.mimeType
      };
    }

    if (!env.OPENAI_API_KEY) throw new HttpError("Generated file is unavailable.", 404);
    const downloaded = await this.downloadFromOpenAI(artifact);
    await this.storeDownloadedArtifact(artifact, downloaded.buffer).catch((error) => {
      logger.warn("OpenAI artifact lazy storage failed", {
        artifactId: artifact.id,
        error: error instanceof Error ? error.message : String(error)
      });
    });
    return downloaded;
  }

  async cleanupExpiredNow(): Promise<void> {
    if (env.OPENAI_ARTIFACT_TTL_HOURS <= 0) return;

    const db = getDatabase();
    if (db) {
      const expired = await db.select().from(openAIArtifacts).where(lte(openAIArtifacts.expiresAt, new Date()));
      for (const artifact of expired) {
        try {
          if (artifact.storageKey) await storageService.delete(artifact.storageKey);
          await db.delete(openAIArtifacts).where(eq(openAIArtifacts.id, artifact.id));
        } catch (error) {
          logger.warn("Expired OpenAI artifact cleanup will be retried", {
            artifactId: artifact.id,
            error: error instanceof Error ? error.message : String(error)
          });
        }
      }
      return;
    }

    const now = Date.now();
    for (const artifact of this.artifacts.values()) {
      if (artifact.expiresAt <= now) {
        if (artifact.storageKey) await storageService.delete(artifact.storageKey);
        this.artifacts.delete(artifact.id);
      }
    }
  }

  private async persist(artifact: Artifact, expiresAt: Date): Promise<void> {
    const db = getDatabase();
    if (db) {
      await db.insert(openAIArtifacts).values({
        id: artifact.id,
        containerId: artifact.containerId,
        fileId: artifact.fileId,
        fileName: artifact.fileName,
        mimeType: artifact.mimeType,
        ownerId: artifact.ownerId,
        conversationId: artifact.conversationId,
        messageId: artifact.messageId,
        publicUrl: `/api/openai-artifacts/${artifact.id}`,
        metadata: artifact.metadata ?? {},
        expiresAt
      }).onConflictDoNothing();
    }

    if (!env.OPENAI_API_KEY) return;
    const downloaded = await this.downloadFromOpenAI(artifact);
    await this.storeDownloadedArtifact(artifact, downloaded.buffer);
  }

  private async lookup(id: string): Promise<Artifact | undefined> {
    const db = getDatabase();
    if (db) {
      const row = await db.query.openAIArtifacts.findFirst({ where: eq(openAIArtifacts.id, id) });
      if (!row) return undefined;
      return {
        id: row.id,
        containerId: row.containerId,
        fileId: row.fileId,
        fileName: row.fileName,
        mimeType: row.mimeType,
        ownerId: row.ownerId,
        conversationId: row.conversationId,
        messageId: row.messageId,
        storageKey: row.storageKey,
        localPath: row.localPath,
        sizeBytes: row.sizeBytes,
        metadata: isRecord(row.metadata) ? row.metadata : {},
        expiresAt: row.expiresAt.getTime()
      };
    }
    return this.artifacts.get(id);
  }

  private async downloadFromOpenAI(artifact: Pick<Artifact, "containerId" | "fileId" | "fileName" | "mimeType">): Promise<DownloadedArtifact> {
    const client = new OpenAI({ apiKey: env.OPENAI_API_KEY, timeout: env.OPENAI_REQUEST_TIMEOUT_MS });
    const body = await client.containers.files.content.retrieve(artifact.fileId, {
      container_id: artifact.containerId
    });
    const mimeType = body.headers.get("content-type") ?? artifact.mimeType;
    return {
      buffer: Buffer.from(await body.arrayBuffer()),
      fileName: artifact.fileName,
      mimeType
    };
  }

  private async storeDownloadedArtifact(artifact: Artifact, buffer: Buffer): Promise<void> {
    if (artifact.storageKey) return;

    const extension = extname(artifact.fileName) || ".bin";
    const stored = await storageService.put({
      bucket: "openai-artifacts",
      fileName: `${artifact.id}${extension}`,
      buffer
    });

    try {
      const db = getDatabase();
      if (db) {
        await db.update(openAIArtifacts)
          .set({
            storageKey: stored.storageKey,
            localPath: stored.localPath,
            sizeBytes: stored.sizeBytes
          })
          .where(eq(openAIArtifacts.id, artifact.id));
      }
      artifact.storageKey = stored.storageKey;
      artifact.localPath = stored.localPath ?? null;
      artifact.sizeBytes = stored.sizeBytes;
      this.artifacts.set(artifact.id, artifact);
    } catch (error) {
      await storageService.delete(stored.storageKey).catch(() => undefined);
      throw error;
    }
  }
}

export const openAIArtifactService = new OpenAIArtifactService();
