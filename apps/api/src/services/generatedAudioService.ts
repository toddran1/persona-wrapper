import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { extname } from "node:path";
import { eq, lte } from "drizzle-orm";
import { env } from "../config/env.js";
import { getDatabase } from "../db/client.js";
import { generatedAudio } from "../db/schema.js";
import { HttpError } from "../utils/httpError.js";
import { logger } from "../utils/logger.js";
import { storageService } from "./storageService.js";

type GeneratedAudio = {
  token: string;
  ownerId?: string | null;
  fileName: string;
  localPath?: string | null;
  storageKey?: string | null;
  mimeType: string;
  expiresAt: number;
};

function safeFileName(fileName: string): string {
  return fileName.replace(/[^a-zA-Z0-9._-]/g, "_").replace(/_+/g, "_").slice(0, 96) || "generated-audio.mp3";
}

export class GeneratedAudioService {
  private readonly files = new Map<string, GeneratedAudio>();

  async register(
    buffer: Buffer,
    options: { fileName: string; mimeType: string; ownerId?: string; conversationId?: string; messageId?: string }
  ): Promise<string> {
    await this.cleanup();
    const token = randomUUID();
    const fileName = safeFileName(options.fileName);
    const extension = extname(fileName) || ".mp3";
    const stored = await storageService.put({
      bucket: "generated-audio",
      fileName: `${token}${extension}`,
      buffer
    });
    const expiresAt = generatedAudioExpiresAt();
    const publicUrl = `/api/generated-audio/${token}`;

    const db = getDatabase();
    try {
      if (db) {
        await db.insert(generatedAudio).values({
        token,
        ...(options.ownerId ? { ownerId: options.ownerId } : {}),
        ...(options.conversationId ? { conversationId: options.conversationId } : {}),
        ...(options.messageId ? { messageId: options.messageId } : {}),
        fileName,
        localPath: stored.localPath,
        storageKey: stored.storageKey,
        publicUrl,
        mimeType: options.mimeType,
        expiresAt
        });
      } else {
        this.files.set(token, {
        token,
        ...(options.ownerId ? { ownerId: options.ownerId } : {}),
        fileName,
        ...(stored.localPath ? { localPath: stored.localPath } : {}),
        storageKey: stored.storageKey,
        mimeType: options.mimeType,
        expiresAt: expiresAt.getTime()
        });
      }
    } catch (error) {
      await storageService.delete(stored.storageKey).catch((cleanupError) => {
        logger.warn("Failed to clean up untracked generated audio", {
          token,
          error: cleanupError instanceof Error ? cleanupError.message : String(cleanupError)
        });
      });
      throw error;
    }

    return publicUrl;
  }

  async download(token: string, ownerId?: string): Promise<{ buffer: Buffer; fileName: string; mimeType: string }> {
    await this.cleanup();
    const db = getDatabase();
    const file = db
      ? await db.query.generatedAudio.findFirst({ where: eq(generatedAudio.token, token) })
      : this.files.get(token);
    if (!file) throw new HttpError("Generated audio not found.", 404);
    if (file.ownerId && !ownerId && env.AUTH_REQUIRE_OWNED_MEDIA_ACCESS) throw new HttpError("Generated audio not found.", 404);
    if (file.ownerId && ownerId && file.ownerId !== ownerId) throw new HttpError("Generated audio not found.", 404);
    if (file.storageKey) {
      const stored = await storageService.get(file.storageKey);
      return {
        buffer: stored.buffer,
        fileName: file.fileName,
        mimeType: file.mimeType
      };
    }
    if (!file.localPath || !existsSync(file.localPath)) throw new HttpError("Generated audio file is unavailable.", 404);
    return {
      buffer: readFileSync(file.localPath),
      fileName: file.fileName,
      mimeType: file.mimeType
    };
  }

  async cleanupExpiredNow(): Promise<void> {
    await this.cleanup();
  }

  private async cleanup(): Promise<void> {
    if (env.GENERATED_AUDIO_TTL_HOURS <= 0) {
      return;
    }

    const db = getDatabase();
    if (db) {
      const expired = await db.select().from(generatedAudio).where(lte(generatedAudio.expiresAt, new Date()));
      for (const file of expired) {
        try {
          if (file.storageKey) await storageService.delete(file.storageKey);
          else if (file.localPath) rmSync(file.localPath, { force: true });
          await db.delete(generatedAudio).where(eq(generatedAudio.token, file.token));
        } catch (error) {
          logger.warn("Expired generated audio cleanup will be retried", {
            token: file.token,
            error: error instanceof Error ? error.message : String(error)
          });
        }
      }
      return;
    }

    const now = Date.now();
    for (const file of this.files.values()) {
      if (file.expiresAt <= now) {
        if (file.storageKey) await storageService.delete(file.storageKey);
        else if (file.localPath) rmSync(file.localPath, { force: true });
        this.files.delete(file.token);
      }
    }
  }
}

function generatedAudioExpiresAt(): Date {
  if (env.GENERATED_AUDIO_TTL_HOURS <= 0) {
    return new Date("9999-12-31T23:59:59.000Z");
  }
  return new Date(Date.now() + env.GENERATED_AUDIO_TTL_HOURS * 60 * 60 * 1000);
}

export const generatedAudioService = new GeneratedAudioService();
