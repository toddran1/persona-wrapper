import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { extname, resolve } from "node:path";
import { eq, lte } from "drizzle-orm";
import { env } from "../config/env.js";
import { getDatabase } from "../db/client.js";
import { generatedAudio } from "../db/schema.js";
import { HttpError } from "../utils/httpError.js";

type GeneratedAudio = {
  token: string;
  fileName: string;
  localPath: string;
  mimeType: string;
  expiresAt: number;
};

function safeFileName(fileName: string): string {
  return fileName.replace(/[^a-zA-Z0-9._-]/g, "_").replace(/_+/g, "_").slice(0, 96) || "generated-audio.mp3";
}

export class GeneratedAudioService {
  private readonly files = new Map<string, GeneratedAudio>();
  private readonly audioDir = resolve(env.UPLOAD_DIR, "generated-audio");

  constructor() {
    mkdirSync(this.audioDir, { recursive: true });
  }

  async register(buffer: Buffer, options: { fileName: string; mimeType: string }): Promise<string> {
    await this.cleanup();
    const token = randomUUID();
    const fileName = safeFileName(options.fileName);
    const extension = extname(fileName) || ".mp3";
    const localPath = resolve(this.audioDir, `${token}${extension}`);
    const expiresAt = new Date(Date.now() + env.UPLOAD_TTL_HOURS * 60 * 60 * 1000);
    writeFileSync(localPath, buffer, { flag: "wx" });

    const db = getDatabase();
    if (db) {
      await db.insert(generatedAudio).values({
        token,
        fileName,
        localPath,
        mimeType: options.mimeType,
        expiresAt
      });
    } else {
      this.files.set(token, {
        token,
        fileName,
        localPath,
        mimeType: options.mimeType,
        expiresAt: expiresAt.getTime()
      });
    }

    return `/api/generated-audio/${token}`;
  }

  async download(token: string): Promise<{ buffer: Buffer; fileName: string; mimeType: string }> {
    await this.cleanup();
    const db = getDatabase();
    const file = db
      ? await db.query.generatedAudio.findFirst({ where: eq(generatedAudio.token, token) })
      : this.files.get(token);
    if (!file) throw new HttpError("Generated audio not found.", 404);
    if (!file.localPath) throw new HttpError("Generated audio file is unavailable.", 404);
    return {
      buffer: readFileSync(file.localPath),
      fileName: file.fileName,
      mimeType: file.mimeType
    };
  }

  private async cleanup(): Promise<void> {
    const db = getDatabase();
    if (db) {
      const expired = await db.select().from(generatedAudio).where(lte(generatedAudio.expiresAt, new Date()));
      if (expired.length > 0) {
        await db.delete(generatedAudio).where(lte(generatedAudio.expiresAt, new Date()));
        for (const file of expired) {
          if (file.localPath) rmSync(file.localPath, { force: true });
        }
      }
      return;
    }

    const now = Date.now();
    for (const file of this.files.values()) {
      if (file.expiresAt <= now) {
        this.files.delete(file.token);
        rmSync(file.localPath, { force: true });
      }
    }
  }
}

export const generatedAudioService = new GeneratedAudioService();
