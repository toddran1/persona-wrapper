import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { type Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
  S3ServiceException
} from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { env } from "../config/env.js";
import { HttpError } from "../utils/httpError.js";

export type StorageBucket = "uploads" | "generated-media" | "generated-audio" | "openai-artifacts";

export type StoredObject = {
  storageKey: string;
  localPath?: string;
  sizeBytes: number;
};

export type StorageDownload = {
  buffer: Buffer;
  localPath?: string;
};

export type StorageStreamDownload = {
  stream: Readable;
  sizeBytes?: number;
  localPath?: string;
};

export type PresignedStorageUpload = {
  uploadUrl: string;
  headers: Record<string, string>;
  expiresAt: string;
};

export type StoredObjectMetadata = {
  sizeBytes: number;
  mimeType?: string;
};

type PutObjectInput = {
  bucket: StorageBucket;
  fileName: string;
  buffer: Buffer;
};

type PutStreamInput = {
  bucket: StorageBucket;
  fileName: string;
  stream: Readable;
  mimeType?: string;
  signal?: AbortSignal;
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
  putStream(input: PutStreamInput): Promise<StoredObject>;
  get(storageKey: string): Promise<StorageDownload>;
  getStream(storageKey: string): Promise<StorageStreamDownload>;
  delete(storageKey: string): Promise<void>;
  cleanupOlderThan(bucket: StorageBucket, cutoffMs: number): Promise<void>;
  healthCheck(): Promise<StorageHealth>;
  presignPut?(storageKey: string, mimeType: string): Promise<PresignedStorageUpload>;
  head?(storageKey: string): Promise<StoredObjectMetadata>;
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
  if (
    (bucket !== "uploads" && bucket !== "generated-media" && bucket !== "generated-audio" && bucket !== "openai-artifacts") ||
    rest.length !== 1
  ) {
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

  async putStream(input: PutStreamInput): Promise<StoredObject> {
    const fileName = safeFileName(input.fileName);
    const storageKey = keyFor(input.bucket, fileName);
    const localPath = this.localPathFor(input.bucket, fileName);
    await mkdir(dirname(localPath), { recursive: true });
    let sizeBytes = 0;
    const counter = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        sizeBytes += chunk.byteLength;
        callback(null, chunk);
      }
    });
    try {
      await pipeline(input.stream, counter, createWriteStream(localPath, { flags: "wx" }), { signal: input.signal });
    } catch (error) {
      await rm(localPath, { force: true }).catch(() => undefined);
      throw error;
    }
    return { storageKey, localPath, sizeBytes };
  }

  async getStream(storageKey: string): Promise<StorageStreamDownload> {
    const { bucket, fileName } = parseStorageKey(storageKey);
    const localPath = this.localPathFor(bucket, fileName);
    if (!this.isInsideBucket(bucket, localPath)) throw new HttpError("Stored object not found.", 404);
    try {
      const details = await stat(localPath);
      return { stream: createReadStream(localPath), sizeBytes: details.size, localPath };
    } catch {
      throw new HttpError("Stored object not found.", 404);
    }
  }

  async head(storageKey: string): Promise<StoredObjectMetadata> {
    const { bucket, fileName } = parseStorageKey(storageKey);
    const localPath = this.localPathFor(bucket, fileName);
    if (!this.isInsideBucket(bucket, localPath)) throw new HttpError("Stored object not found.", 404);
    try {
      return { sizeBytes: (await stat(localPath)).size };
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
    if (bucket === "openai-artifacts") {
      return resolve(env.UPLOAD_DIR, "openai-artifacts");
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

  async putStream(input: PutStreamInput): Promise<StoredObject> {
    const fileName = safeFileName(input.fileName);
    const storageKey = keyFor(input.bucket, fileName);
    const upload = new Upload({
      client: this.client,
      params: {
        Bucket: this.bucket,
        Key: this.objectKey(storageKey),
        Body: input.stream,
        ...(input.mimeType ? { ContentType: input.mimeType } : {}),
        Metadata: { storage_bucket: input.bucket }
      },
      queueSize: 4,
      partSize: 8 * 1024 * 1024,
      leavePartsOnError: false
    });
    const abort = () => void upload.abort();
    input.signal?.addEventListener("abort", abort, { once: true });
    try {
      await upload.done();
    } finally {
      input.signal?.removeEventListener("abort", abort);
    }
    const metadata = await this.head(storageKey);
    return { storageKey, sizeBytes: metadata.sizeBytes };
  }

  async getStream(storageKey: string): Promise<StorageStreamDownload> {
    parseStorageKey(storageKey);
    try {
      const output = await this.client.send(new GetObjectCommand({
        Bucket: this.bucket,
        Key: this.objectKey(storageKey)
      }));
      if (!output.Body || typeof (output.Body as { pipe?: unknown }).pipe !== "function") {
        throw new HttpError("Stored object not found.", 404);
      }
      return { stream: output.Body as Readable, ...(output.ContentLength !== undefined ? { sizeBytes: output.ContentLength } : {}) };
    } catch (error) {
      if (error instanceof HttpError) throw error;
      if (isS3NotFound(error)) throw new HttpError("Stored object not found.", 404);
      throw error;
    }
  }

  async presignPut(storageKey: string, mimeType: string): Promise<PresignedStorageUpload> {
    parseStorageKey(storageKey);
    const expiresIn = env.DATA_TRANSFER_PRESIGNED_UPLOAD_TTL_SECONDS;
    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: this.objectKey(storageKey),
      ContentType: mimeType
    });
    return {
      uploadUrl: await getSignedUrl(this.client, command, { expiresIn }),
      headers: { "Content-Type": mimeType },
      expiresAt: new Date(Date.now() + expiresIn * 1000).toISOString()
    };
  }

  async head(storageKey: string): Promise<StoredObjectMetadata> {
    parseStorageKey(storageKey);
    try {
      const output = await this.client.send(new HeadObjectCommand({
        Bucket: this.bucket,
        Key: this.objectKey(storageKey)
      }));
      return {
        sizeBytes: output.ContentLength ?? 0,
        ...(output.ContentType ? { mimeType: output.ContentType } : {})
      };
    } catch (error) {
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

  putStream(input: PutStreamInput): Promise<StoredObject> {
    return this.driver.putStream(input);
  }

  get(storageKey: string): Promise<StorageDownload> {
    return this.driver.get(storageKey);
  }

  getStream(storageKey: string): Promise<StorageStreamDownload> {
    return this.driver.getStream(storageKey);
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

  supportsPresignedUploads(): boolean {
    return Boolean(this.driver.presignPut && this.driver.head);
  }

  presignPut(storageKey: string, mimeType: string): Promise<PresignedStorageUpload> {
    if (!this.driver.presignPut) throw new HttpError("Direct uploads are not available for this storage driver.", 409);
    return this.driver.presignPut(storageKey, mimeType);
  }

  head(storageKey: string): Promise<StoredObjectMetadata> {
    if (!this.driver.head) throw new HttpError("Direct uploads are not available for this storage driver.", 409);
    return this.driver.head(storageKey);
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
