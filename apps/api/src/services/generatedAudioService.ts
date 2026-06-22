import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { extname, resolve } from "node:path";
import { env } from "../config/env.js";
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

  register(buffer: Buffer, options: { fileName: string; mimeType: string }): string {
    this.cleanup();
    const token = randomUUID();
    const fileName = safeFileName(options.fileName);
    const extension = extname(fileName) || ".mp3";
    const localPath = resolve(this.audioDir, `${token}${extension}`);
    writeFileSync(localPath, buffer, { flag: "wx" });

    this.files.set(token, {
      token,
      fileName,
      localPath,
      mimeType: options.mimeType,
      expiresAt: Date.now() + env.UPLOAD_TTL_HOURS * 60 * 60 * 1000
    });

    return `/api/generated-audio/${token}`;
  }

  download(token: string): { buffer: Buffer; fileName: string; mimeType: string } {
    this.cleanup();
    const file = this.files.get(token);
    if (!file) throw new HttpError("Generated audio not found.", 404);
    return {
      buffer: readFileSync(file.localPath),
      fileName: file.fileName,
      mimeType: file.mimeType
    };
  }

  private cleanup(): void {
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
