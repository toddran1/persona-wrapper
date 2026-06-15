import { randomUUID } from "node:crypto";
import { mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { basename, extname, resolve } from "node:path";
import OpenAI, { toFile } from "openai";
import type { UploadedAsset } from "@persona/shared";
import { env } from "../config/env.js";
import { HttpError } from "../utils/httpError.js";

const IMAGE_MIME_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);
const FILE_MIME_TYPES = new Set([
  "application/pdf",
  "text/plain",
  "text/markdown",
  "text/csv",
  "application/json",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation"
]);

type StoredAsset = UploadedAsset & {
  ownerId: string;
  localPath: string;
};

type StoredVectorStore = {
  id: string;
  ownerId: string;
  expiresAt: string;
};

export class UploadService {
  private readonly assets = new Map<string, StoredAsset>();
  private readonly vectorStores = new Map<string, StoredVectorStore>();
  private readonly uploadDir = resolve(env.UPLOAD_DIR);

  constructor() {
    mkdirSync(this.uploadDir, { recursive: true });
    this.cleanupOrphanedDiskFiles();
    setInterval(() => void this.cleanupExpiredRemote(), 15 * 60 * 1000).unref();
  }

  async save(ownerId: string, file: Express.Multer.File): Promise<UploadedAsset> {
    this.cleanupExpired();
    if (!ownerId.trim()) throw new HttpError("An upload owner ID is required.", 400);
    if (!IMAGE_MIME_TYPES.has(file.mimetype) && !FILE_MIME_TYPES.has(file.mimetype)) {
      throw new HttpError(`Unsupported upload type: ${file.mimetype}`, 415);
    }
    validateFileContents(file);

    const id = `asset_${randomUUID()}`;
    const safeExtension = extname(basename(file.originalname)).slice(0, 12);
    const localPath = resolve(this.uploadDir, `${id}${safeExtension}`);
    writeFileSync(localPath, file.buffer, { flag: "wx" });
    const expiresAt = new Date(Date.now() + env.UPLOAD_TTL_HOURS * 60 * 60 * 1000).toISOString();
    let openaiFileId: string | undefined;

    try {
      if (env.OPENAI_API_KEY) {
        const client = new OpenAI({ apiKey: env.OPENAI_API_KEY, timeout: env.OPENAI_REQUEST_TIMEOUT_MS });
        const uploaded = await client.files.create({
          file: await toFile(file.buffer, basename(file.originalname), { type: file.mimetype }),
          purpose: "user_data",
          expires_after: {
            anchor: "created_at",
            seconds: Math.max(3600, Math.min(2592000, env.UPLOAD_TTL_HOURS * 3600))
          }
        });
        openaiFileId = uploaded.id;
      }
    } catch (error) {
      rmSync(localPath, { force: true });
      throw error;
    }

    const asset: StoredAsset = {
      id,
      ownerId,
      kind: IMAGE_MIME_TYPES.has(file.mimetype) ? "image" : "file",
      fileName: basename(file.originalname),
      mimeType: file.mimetype,
      sizeBytes: file.size,
      url: `/api/uploads/${id}`,
      ...(openaiFileId ? { openaiFileId } : {}),
      expiresAt,
      localPath
    };
    this.assets.set(id, asset);
    return this.publicAsset(asset);
  }

  get(ownerId: string, id: string): StoredAsset {
    this.cleanupExpired();
    const asset = this.assets.get(id);
    if (!asset || asset.ownerId !== ownerId) throw new HttpError("Upload not found.", 404);
    return asset;
  }

  list(ownerId: string): UploadedAsset[] {
    this.cleanupExpired();
    return [...this.assets.values()].filter((asset) => asset.ownerId === ownerId).map((asset) => this.publicAsset(asset));
  }

  resolveAssets(ownerId: string, assetIds: string[]): UploadedAsset[] {
    return assetIds.map((id) => this.publicAsset(this.get(ownerId, id)));
  }

  validateVectorStores(ownerId: string, vectorStoreIds: string[]): void {
    this.cleanupExpired();
    for (const id of vectorStoreIds) {
      const vectorStore = this.vectorStores.get(id);
      if (!vectorStore || vectorStore.ownerId !== ownerId) throw new HttpError("Vector store not found.", 404);
    }
  }

  async remove(ownerId: string, id: string): Promise<void> {
    const asset = this.get(ownerId, id);
    this.assets.delete(id);
    rmSync(asset.localPath, { force: true });
    if (asset.openaiFileId && env.OPENAI_API_KEY) {
      const client = new OpenAI({ apiKey: env.OPENAI_API_KEY });
      await client.files.delete(asset.openaiFileId).catch(() => undefined);
    }
  }

  async removeVectorStore(ownerId: string, id: string): Promise<void> {
    const vectorStore = this.vectorStores.get(id);
    if (!vectorStore || vectorStore.ownerId !== ownerId) throw new HttpError("Vector store not found.", 404);
    this.vectorStores.delete(id);
    if (env.OPENAI_API_KEY) {
      const client = new OpenAI({ apiKey: env.OPENAI_API_KEY, timeout: env.OPENAI_REQUEST_TIMEOUT_MS });
      await client.vectorStores.delete(id).catch(() => undefined);
    }
  }

  async createVectorStore(ownerId: string, assetIds: string[], name?: string): Promise<{ id: string; expiresAt: string }> {
    if (!env.OPENAI_API_KEY) throw new HttpError("OpenAI is not configured.", 503);
    const files = assetIds.map((id) => this.get(ownerId, id));
    const fileIds = files.flatMap((file) => file.openaiFileId ? [file.openaiFileId] : []);
    if (fileIds.length !== files.length) throw new HttpError("All vector-store files must be uploaded to OpenAI.", 400);

    const client = new OpenAI({ apiKey: env.OPENAI_API_KEY, timeout: env.OPENAI_REQUEST_TIMEOUT_MS });
    const vectorStore = await client.vectorStores.create({
      name: name?.trim() || `persona-documents-${new Date().toISOString()}`,
      file_ids: fileIds,
      expires_after: { anchor: "last_active_at", days: 1 },
      metadata: { owner_id: ownerId }
    });
    const expiresAt = new Date((vectorStore.expires_at ?? Math.floor(Date.now() / 1000) + 86400) * 1000).toISOString();
    this.vectorStores.set(vectorStore.id, { id: vectorStore.id, ownerId, expiresAt });
    return { id: vectorStore.id, expiresAt };
  }

  private publicAsset(asset: StoredAsset): UploadedAsset {
    const { ownerId: _ownerId, localPath: _localPath, ...publicAsset } = asset;
    return publicAsset;
  }

  private cleanupExpired(deleteRemote = true): void {
    const now = Date.now();
    const client = env.OPENAI_API_KEY ? new OpenAI({ apiKey: env.OPENAI_API_KEY, timeout: env.OPENAI_REQUEST_TIMEOUT_MS }) : undefined;
    for (const asset of this.assets.values()) {
      if (new Date(asset.expiresAt ?? 0).getTime() > now) continue;
      this.assets.delete(asset.id);
      rmSync(asset.localPath, { force: true });
      if (deleteRemote && client && asset.openaiFileId) void client.files.delete(asset.openaiFileId).catch(() => undefined);
    }
    for (const vectorStore of this.vectorStores.values()) {
      if (new Date(vectorStore.expiresAt).getTime() <= now) {
        this.vectorStores.delete(vectorStore.id);
        if (deleteRemote && client) void client.vectorStores.delete(vectorStore.id).catch(() => undefined);
      }
    }
  }

  private async cleanupExpiredRemote(): Promise<void> {
    const now = Date.now();
    const expiredAssets = [...this.assets.values()].filter((asset) => new Date(asset.expiresAt ?? 0).getTime() <= now);
    const expiredVectorStores = [...this.vectorStores.values()].filter((store) => new Date(store.expiresAt).getTime() <= now);
    this.cleanupExpired(false);
    if (!env.OPENAI_API_KEY) return;
    const client = new OpenAI({ apiKey: env.OPENAI_API_KEY, timeout: env.OPENAI_REQUEST_TIMEOUT_MS });
    await Promise.all([
      ...expiredAssets.flatMap((asset) => asset.openaiFileId ? [client.files.delete(asset.openaiFileId).catch(() => undefined)] : []),
      ...expiredVectorStores.map((store) => client.vectorStores.delete(store.id).catch(() => undefined))
    ]);
  }

  private cleanupOrphanedDiskFiles(): void {
    const cutoff = Date.now() - env.UPLOAD_TTL_HOURS * 60 * 60 * 1000;
    for (const fileName of readdirSync(this.uploadDir)) {
      const filePath = resolve(this.uploadDir, fileName);
      try {
        if (statSync(filePath).mtimeMs <= cutoff) rmSync(filePath, { force: true });
      } catch {
        // A concurrent cleanup or upload may have changed the file.
      }
    }
  }
}

function validateFileContents(file: Express.Multer.File): void {
  const buffer = file.buffer;
  const startsWith = (...bytes: number[]) => bytes.every((byte, index) => buffer[index] === byte);
  const valid =
    file.mimetype === "image/png" ? startsWith(0x89, 0x50, 0x4e, 0x47) :
    file.mimetype === "image/jpeg" ? startsWith(0xff, 0xd8, 0xff) :
    file.mimetype === "image/gif" ? buffer.subarray(0, 6).toString("ascii").startsWith("GIF8") :
    file.mimetype === "image/webp" ? buffer.subarray(0, 4).toString("ascii") === "RIFF" && buffer.subarray(8, 12).toString("ascii") === "WEBP" :
    file.mimetype === "application/pdf" ? buffer.subarray(0, 5).toString("ascii") === "%PDF-" :
    file.mimetype.startsWith("application/vnd.openxmlformats") ? startsWith(0x50, 0x4b) :
    file.mimetype === "application/json" ? isJson(buffer) :
    file.mimetype.startsWith("text/") ? !buffer.includes(0) :
    true;
  if (!valid) throw new HttpError(`File contents do not match declared type: ${file.mimetype}`, 415);
}

function isJson(buffer: Buffer): boolean {
  try {
    JSON.parse(buffer.toString("utf8"));
    return true;
  } catch {
    return false;
  }
}

export const uploadService = new UploadService();
