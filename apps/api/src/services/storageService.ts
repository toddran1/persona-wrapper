import { mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import {
  DeleteObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
  S3ServiceException
} from "@aws-sdk/client-s3";
import { env } from "../config/env.js";
import { HttpError } from "../utils/httpError.js";

export type StorageBucket = "uploads" | "generated-media" | "generated-audio";

export type StoredObject = {
  storageKey: string;
  localPath?: string;
  sizeBytes: number;
};

export type StorageDownload = {
  buffer: Buffer;
  localPath?: string;
};

type PutObjectInput = {
  bucket: StorageBucket;
  fileName: string;
  buffer: Buffer;
};

type StorageHealth = {
  ok: boolean;
  driver: typeof env.STORAGE_DRIVER;
  root?: string;
  bucket?: string;
  prefix?: string;
  message?: string;
};

type ParsedStorageKey = {
  bucket: StorageBucket;
  fileName: string;
};

interface StorageDriver {
  put(input: PutObjectInput): Promise<StoredObject>;
  get(storageKey: string): Promise<StorageDownload>;
  delete(storageKey: string): Promise<void>;
  cleanupOlderThan(bucket: StorageBucket, cutoffMs: number): Promise<void>;
  healthCheck(): Promise<StorageHealth>;
}

function safeFileName(fileName: string): string {
  const cleaned = fileName.replace(/[^a-zA-Z0-9._-]/g, "_").replace(/_+/g, "_").slice(0, 140);
  if (!cleaned || cleaned === "." || cleaned === "..") {
    throw new HttpError("Invalid storage file name.", 400);
  }
  return cleaned;
}

function keyFor(bucket: StorageBucket, fileName: string): string {
  return `${bucket}/${safeFileName(fileName)}`;
}

function parseStorageKey(storageKey: string): ParsedStorageKey {
  const [bucket, ...rest] = storageKey.split("/");
  const fileName = rest.join("/");
  if ((bucket !== "uploads" && bucket !== "generated-media" && bucket !== "generated-audio") || rest.length !== 1) {
    throw new HttpError("Stored object not found.", 404);
  }
  return { bucket, fileName: safeFileName(fileName) };
}

class LocalStorageDriver implements StorageDriver {
  async put(input: PutObjectInput): Promise<StoredObject> {
    const fileName = safeFileName(input.fileName);
    const storageKey = keyFor(input.bucket, fileName);
    const localPath = this.localPathFor(input.bucket, fileName);
    await mkdir(dirname(localPath), { recursive: true });
    await writeFile(localPath, input.buffer, { flag: "wx" });
    return {
      storageKey,
      localPath,
      sizeBytes: input.buffer.byteLength
    };
  }

  async get(storageKey: string): Promise<StorageDownload> {
    const { bucket, fileName } = parseStorageKey(storageKey);
    const localPath = this.localPathFor(bucket, fileName);
    if (!this.isInsideBucket(bucket, localPath)) {
      throw new HttpError("Stored object not found.", 404);
    }
    try {
      return {
        buffer: await readFile(localPath),
        localPath
      };
    } catch {
      throw new HttpError("Stored object not found.", 404);
    }
  }

  async delete(storageKey: string): Promise<void> {
    const { bucket, fileName } = parseStorageKey(storageKey);
    const localPath = this.localPathFor(bucket, fileName);
    if (!this.isInsideBucket(bucket, localPath)) return;
    await rm(localPath, { force: true });
  }

  async cleanupOlderThan(bucket: StorageBucket, cutoffMs: number): Promise<void> {
    const directory = this.bucketRoot(bucket);
    await mkdir(directory, { recursive: true });
    for (const fileName of await readdir(directory)) {
      const localPath = this.localPathFor(bucket, fileName);
      try {
        if ((await stat(localPath)).mtimeMs <= cutoffMs) {
          await rm(localPath, { force: true });
        }
      } catch {
        // A concurrent cleanup or write may have changed the file.
      }
    }
  }

  async healthCheck(): Promise<StorageHealth> {
    const root = this.root();
    const probeName = `.health-${process.pid}-${Date.now()}.txt`;
    let storageKey: string | undefined;
    try {
      const stored = await this.put({
        bucket: "uploads",
        fileName: probeName,
        buffer: Buffer.from("ok")
      });
      storageKey = stored.storageKey;
      const downloaded = await this.get(stored.storageKey);
      if (downloaded.buffer.toString("utf8") !== "ok") {
        return { ok: false, driver: env.STORAGE_DRIVER, root, message: "Storage probe read mismatch." };
      }
      return { ok: true, driver: env.STORAGE_DRIVER, root };
    } catch (error) {
      return {
        ok: false,
        driver: env.STORAGE_DRIVER,
        root,
        message: error instanceof Error ? error.message : String(error)
      };
    } finally {
      if (storageKey) await this.delete(storageKey).catch(() => undefined);
    }
  }

  private localPathFor(bucket: StorageBucket, fileName: string): string {
    return resolve(this.bucketRoot(bucket), safeFileName(fileName));
  }

  private bucketRoot(bucket: StorageBucket): string {
    if (env.STORAGE_LOCAL_ROOT) {
      return resolve(env.STORAGE_LOCAL_ROOT, bucket);
    }
    if (bucket === "generated-media") {
      return resolve(env.GENERATED_MEDIA_DIR ?? env.UPLOAD_DIR, env.GENERATED_MEDIA_DIR ? "" : "generated-media");
    }
    if (bucket === "generated-audio") {
      return resolve(env.GENERATED_AUDIO_DIR ?? env.UPLOAD_DIR, env.GENERATED_AUDIO_DIR ? "" : "generated-audio");
    }
    return resolve(env.UPLOAD_DIR);
  }

  private root(): string {
    return resolve(env.STORAGE_LOCAL_ROOT ?? env.UPLOAD_DIR);
  }

  private isInsideBucket(bucket: StorageBucket, localPath: string): boolean {
    const bucketRoot = this.bucketRoot(bucket);
    const relativePath = relative(bucketRoot, localPath);
    return Boolean(relativePath) && !relativePath.startsWith("..") && !isAbsolute(relativePath);
  }
}

class S3StorageDriver implements StorageDriver {
  private readonly client: S3Client;
  private readonly bucket: string;
  private readonly prefix: string;

  constructor() {
    if (!env.STORAGE_S3_BUCKET || !env.STORAGE_S3_REGION) {
      throw new Error("S3 storage requires STORAGE_S3_BUCKET and STORAGE_S3_REGION.");
    }
    this.bucket = env.STORAGE_S3_BUCKET;
    this.prefix = normalizePrefix(env.STORAGE_S3_PREFIX);
    this.client = new S3Client({
      region: env.STORAGE_S3_REGION,
      ...(env.STORAGE_S3_ENDPOINT ? { endpoint: env.STORAGE_S3_ENDPOINT } : {}),
      forcePathStyle: env.STORAGE_S3_FORCE_PATH_STYLE,
      maxAttempts: 3
    });
  }

  async put(input: PutObjectInput): Promise<StoredObject> {
    const fileName = safeFileName(input.fileName);
    const storageKey = keyFor(input.bucket, fileName);
    const objectKey = this.objectKey(storageKey);
    await this.client.send(new PutObjectCommand({
      Bucket: this.bucket,
      Key: objectKey,
      Body: input.buffer,
      ContentLength: input.buffer.byteLength,
      Metadata: {
        storage_bucket: input.bucket
      }
    }));
    return {
      storageKey,
      sizeBytes: input.buffer.byteLength
    };
  }

  async get(storageKey: string): Promise<StorageDownload> {
    parseStorageKey(storageKey);
    try {
      const output = await this.client.send(new GetObjectCommand({
        Bucket: this.bucket,
        Key: this.objectKey(storageKey)
      }));
      const bytes = await output.Body?.transformToByteArray();
      if (!bytes) throw new HttpError("Stored object not found.", 404);
      return { buffer: Buffer.from(bytes) };
    } catch (error) {
      if (error instanceof HttpError) throw error;
      if (isS3NotFound(error)) throw new HttpError("Stored object not found.", 404);
      throw error;
    }
  }

  async delete(storageKey: string): Promise<void> {
    parseStorageKey(storageKey);
    await this.client.send(new DeleteObjectCommand({
      Bucket: this.bucket,
      Key: this.objectKey(storageKey)
    })).catch((error) => {
      if (!isS3NotFound(error)) throw error;
    });
  }

  async cleanupOlderThan(bucket: StorageBucket, cutoffMs: number): Promise<void> {
    const prefix = this.objectKey(`${bucket}/`);
    let continuationToken: string | undefined;
    do {
      const page = await this.client.send(new ListObjectsV2Command({
        Bucket: this.bucket,
        Prefix: prefix,
        ContinuationToken: continuationToken
      }));
      for (const object of page.Contents ?? []) {
        if (!object.Key || !object.LastModified || object.LastModified.getTime() > cutoffMs) continue;
        await this.client.send(new DeleteObjectCommand({
          Bucket: this.bucket,
          Key: object.Key
        })).catch((error) => {
          if (!isS3NotFound(error)) throw error;
        });
      }
      continuationToken = page.NextContinuationToken;
    } while (continuationToken);
  }

  async healthCheck(): Promise<StorageHealth> {
    const probeName = `.health-${process.pid}-${Date.now()}.txt`;
    let storageKey: string | undefined;
    try {
      const stored = await this.put({
        bucket: "uploads",
        fileName: probeName,
        buffer: Buffer.from("ok")
      });
      storageKey = stored.storageKey;
      const downloaded = await this.get(stored.storageKey);
      if (downloaded.buffer.toString("utf8") !== "ok") {
        return this.health(false, "Storage probe read mismatch.");
      }
      return this.health(true);
    } catch (error) {
      return this.health(false, error instanceof Error ? error.message : String(error));
    } finally {
      if (storageKey) await this.delete(storageKey).catch(() => undefined);
    }
  }

  private health(ok: boolean, message?: string): StorageHealth {
    return {
      ok,
      driver: env.STORAGE_DRIVER,
      bucket: this.bucket,
      ...(this.prefix ? { prefix: this.prefix } : {}),
      ...(message ? { message } : {})
    };
  }

  private objectKey(storageKey: string): string {
    const parsed = storageKey.endsWith("/") ? undefined : parseStorageKey(storageKey);
    const logicalKey = parsed ? keyFor(parsed.bucket, parsed.fileName) : storageKey;
    return this.prefix ? `${this.prefix}/${logicalKey}` : logicalKey;
  }
}

export class StorageService implements StorageDriver {
  private readonly driver: StorageDriver = env.STORAGE_DRIVER === "s3" ? new S3StorageDriver() : new LocalStorageDriver();

  put(input: PutObjectInput): Promise<StoredObject> {
    return this.driver.put(input);
  }

  get(storageKey: string): Promise<StorageDownload> {
    return this.driver.get(storageKey);
  }

  delete(storageKey: string): Promise<void> {
    return this.driver.delete(storageKey);
  }

  cleanupOlderThan(bucket: StorageBucket, cutoffMs: number): Promise<void> {
    return this.driver.cleanupOlderThan(bucket, cutoffMs);
  }

  healthCheck(): Promise<StorageHealth> {
    return this.driver.healthCheck();
  }
}

function normalizePrefix(prefix: string | undefined): string {
  return (prefix ?? "").replace(/^\/+|\/+$/g, "");
}

function isS3NotFound(error: unknown): boolean {
  if (error instanceof S3ServiceException) {
    return error.name === "NoSuchKey" || error.name === "NotFound" || error.$metadata.httpStatusCode === 404;
  }
  return false;
}

export const storageService = new StorageService();
