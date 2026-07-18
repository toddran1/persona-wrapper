import { randomUUID } from "node:crypto";
import { basename } from "node:path";
import type { ContentBlock } from "@persona/shared";
import { eq, lte } from "drizzle-orm";
import { env } from "../config/env.js";
import { getDatabase } from "../db/client.js";
import { generatedMedia } from "../db/schema.js";
import { HttpError } from "../utils/httpError.js";
import { logger } from "../utils/logger.js";
import { storageService } from "./storageService.js";

type StoredGeneratedMedia = {
  buffer: Buffer;
  fileName: string;
  mimeType: string;
};

type GeneratedMediaRecord = {
  id: string;
  ownerId?: string | null;
  conversationId?: string | null;
  messageId?: string | null;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  localPath?: string | null;
  storageKey?: string | null;
  publicUrl?: string | null;
  expiresAt: Date | number;
  metadata?: Record<string, unknown>;
};

type PersistGeneratedMediaOptions = {
  ownerId?: string;
  conversationId?: string;
  messageId?: string;
  metadata?: Record<string, unknown>;
};

const MIME_EXTENSIONS: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
  "video/mp4": "mp4",
  "audio/mpeg": "mp3",
  "audio/wav": "wav",
  "application/pdf": "pdf"
};

function parseDataUrl(value: string): { mimeType: string; buffer: Buffer } | undefined {
  const match = /^data:([^;,]+);base64,([a-zA-Z0-9+/=\s]+)$/.exec(value);
  if (!match?.[1] || !match[2]) return undefined;
  return {
    mimeType: match[1],
    buffer: Buffer.from(match[2].replace(/\s/g, ""), "base64")
  };
}

function extensionForMimeType(mimeType: string): string {
  return MIME_EXTENSIONS[mimeType] ?? "bin";
}

function mimeTypeForFileName(fileName: string): string {
  const extension = fileName.split(".").pop()?.toLowerCase();
  if (extension === "png") return "image/png";
  if (extension === "jpg" || extension === "jpeg") return "image/jpeg";
  if (extension === "webp") return "image/webp";
  if (extension === "gif") return "image/gif";
  if (extension === "mp4") return "video/mp4";
  if (extension === "mp3") return "audio/mpeg";
  if (extension === "wav") return "audio/wav";
  if (extension === "pdf") return "application/pdf";
  return "application/octet-stream";
}

function generatedMediaExpiresAt(): Date {
  if (env.GENERATED_MEDIA_TTL_HOURS <= 0) {
    return new Date("9999-12-31T23:59:59.000Z");
  }
  return new Date(Date.now() + env.GENERATED_MEDIA_TTL_HOURS * 60 * 60 * 1000);
}

export class GeneratedMediaService {
  private readonly files = new Map<string, GeneratedMediaRecord>();

  async persistDataUrl(
    dataUrl: string,
    options: PersistGeneratedMediaOptions = {}
  ): Promise<{ id: string; url: string; mimeType: string; sizeBytes: number; storageKey: string }> {
    const parsed = parseDataUrl(dataUrl);
    if (!parsed) throw new HttpError("Generated media data URL is invalid.", 400);

    await this.cleanupExpired();
    const id = `media_${randomUUID()}`;
    const extension = extensionForMimeType(parsed.mimeType);
    const fileName = `${id}.${extension}`;
    const stored = await storageService.put({
      bucket: "generated-media",
      fileName,
      buffer: parsed.buffer
    });
    const expiresAt = generatedMediaExpiresAt();
    const publicUrl = `/api/generated-media/${id}`;
    const record: GeneratedMediaRecord = {
      id,
      ...(options.ownerId ? { ownerId: options.ownerId } : {}),
      ...(options.conversationId ? { conversationId: options.conversationId } : {}),
      ...(options.messageId ? { messageId: options.messageId } : {}),
      fileName,
      mimeType: parsed.mimeType,
      sizeBytes: parsed.buffer.byteLength,
      ...(stored.localPath ? { localPath: stored.localPath } : {}),
      storageKey: stored.storageKey,
      publicUrl,
      expiresAt,
      metadata: options.metadata ?? {}
    };

    const db = getDatabase();
    try {
      if (db) {
        await db.insert(generatedMedia).values({
        id,
        ...(options.ownerId ? { ownerId: options.ownerId } : {}),
        ...(options.conversationId ? { conversationId: options.conversationId } : {}),
        ...(options.messageId ? { messageId: options.messageId } : {}),
        fileName,
        mimeType: parsed.mimeType,
        sizeBytes: parsed.buffer.byteLength,
        ...(stored.localPath ? { localPath: stored.localPath } : {}),
        storageKey: stored.storageKey,
        publicUrl,
        expiresAt,
        metadata: options.metadata ?? {}
        });
      } else {
        this.files.set(id, record);
      }
    } catch (error) {
      await storageService.delete(stored.storageKey).catch((cleanupError) => {
        logger.warn("Failed to clean up untracked generated media", {
          mediaId: id,
          error: cleanupError instanceof Error ? cleanupError.message : String(cleanupError)
        });
      });
      throw error;
    }

    return {
      id,
      url: publicUrl,
      mimeType: parsed.mimeType,
      sizeBytes: parsed.buffer.byteLength,
      storageKey: stored.storageKey
    };
  }

  async normalizeContentBlocks(blocks: ContentBlock[], options: PersistGeneratedMediaOptions = {}): Promise<ContentBlock[]> {
    return Promise.all(
      blocks.map(async (block) => {
        if ((block.type !== "image" && block.type !== "video" && block.type !== "file") || !block.url.startsWith("data:")) {
          return block;
        }

        const persisted = await this.persistDataUrl(block.url, {
          ...options,
          metadata: {
            ...(options.metadata ?? {}),
            originalBlockType: block.type
          }
        }).catch((error) => {
          logger.warn("Generated media persistence failed", {
            blockType: block.type,
            ownerId: options.ownerId,
            conversationId: options.conversationId,
            messageId: options.messageId,
            error: error instanceof Error ? error.message : String(error)
          });
          return undefined;
        });
        if (!persisted) return block;

        return {
          ...block,
          url: persisted.url,
          mimeType: block.mimeType ?? persisted.mimeType,
          metadata: {
            ...(block.metadata ?? {}),
            ...(options.metadata ?? {}),
            storage: "generated_media",
            generatedMediaId: persisted.id,
            storageKey: persisted.storageKey,
            sizeBytes: persisted.sizeBytes
          }
        };
      })
    );
  }

  async download(idOrFileName: string, ownerId?: string): Promise<StoredGeneratedMedia> {
    await this.cleanupExpired();
    const db = getDatabase();
    const record = db
      ? await db.query.generatedMedia.findFirst({ where: eq(generatedMedia.id, idOrFileName) })
      : this.files.get(idOrFileName);

    if (record?.storageKey) {
      if (record.ownerId && !ownerId && env.AUTH_REQUIRE_OWNED_MEDIA_ACCESS) {
        throw new HttpError("Generated media not found.", 404);
      }
      if (record.ownerId && ownerId && record.ownerId !== ownerId) {
        throw new HttpError("Generated media not found.", 404);
      }
      const stored = await storageService.get(record.storageKey);
      return {
        buffer: stored.buffer,
        fileName: record.fileName,
        mimeType: record.mimeType
      };
    }

    return this.downloadLegacyFileName(idOrFileName);
  }

  async cleanupExpiredNow(): Promise<void> {
    await this.cleanupExpired();
  }

  private async downloadLegacyFileName(fileName: string): Promise<StoredGeneratedMedia> {
    const safeName = basename(fileName);
    if (safeName !== fileName || !safeName) throw new HttpError("Generated media not found.", 404);
    const stored = await storageService.get(`generated-media/${safeName}`);
    return {
      buffer: stored.buffer,
      fileName: safeName,
      mimeType: mimeTypeForFileName(safeName)
    };
  }

  private async cleanupExpired(): Promise<void> {
    if (env.GENERATED_MEDIA_TTL_HOURS <= 0) {
      return;
    }

    const db = getDatabase();
    if (db) {
      const expired = await db.select().from(generatedMedia).where(lte(generatedMedia.expiresAt, new Date()));
      for (const file of expired) {
        try {
          if (file.storageKey) await storageService.delete(file.storageKey);
          await db.delete(generatedMedia).where(eq(generatedMedia.id, file.id));
        } catch (error) {
          logger.warn("Expired generated media cleanup will be retried", {
            mediaId: file.id,
            error: error instanceof Error ? error.message : String(error)
          });
        }
      }
      return;
    }

    const now = Date.now();
    for (const file of this.files.values()) {
      const expiresAt = file.expiresAt instanceof Date ? file.expiresAt.getTime() : file.expiresAt;
      if (expiresAt <= now) {
        if (file.storageKey) await storageService.delete(file.storageKey);
        this.files.delete(file.id);
      }
    }
  }
}

export const generatedMediaService = new GeneratedMediaService();
