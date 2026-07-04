import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { extname } from "node:path";
import { eq, lte } from "drizzle-orm";
import { env } from "../config/env.js";
import { getDatabase } from "../db/client.js";
import { generatedAudio } from "../db/schema.js";
import { HttpError } from "../utils/httpError.js";
import { storageService } from "./storageService.js";

type GeneratedAudio = {
  token: string;
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
        fileName,
        ...(stored.localPath ? { localPath: stored.localPath } : {}),
        storageKey: stored.storageKey,
        mimeType: options.mimeType,
        expiresAt: expiresAt.getTime()
      });
    }

    return publicUrl;
  }

  async download(token: string): Promise<{ buffer: Buffer; fileName: string; mimeType: string }> {
    await this.cleanup();
    const db = getDatabase();
    const file = db
      ? await db.query.generatedAudio.findFirst({ where: eq(generatedAudio.token, token) })
      : this.files.get(token);
    if (!file) throw new HttpError("Generated audio not found.", 404);
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

  private async cleanup(): Promise<void> {
    if (env.GENERATED_AUDIO_TTL_HOURS <= 0) {
      return;
    }

    const db = getDatabase();
    if (db) {
      const expired = await db.select().from(generatedAudio).where(lte(generatedAudio.expiresAt, new Date()));
      if (expired.length > 0) {
        await db.delete(generatedAudio).where(lte(generatedAudio.expiresAt, new Date()));
        for (const file of expired) {
          if (file.storageKey) await storageService.delete(file.storageKey).catch(() => undefined);
          else if (file.localPath) rmSync(file.localPath, { force: true });
        }
      }
      return;
    }

    const now = Date.now();
    for (const file of this.files.values()) {
      if (file.expiresAt <= now) {
        this.files.delete(file.token);
        if (file.storageKey) await storageService.delete(file.storageKey).catch(() => undefined);
        else if (file.localPath) rmSync(file.localPath, { force: true });
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
