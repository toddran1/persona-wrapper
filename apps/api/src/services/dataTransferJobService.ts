import { createHash, randomUUID } from "node:crypto";
import { PassThrough, type Readable, Transform } from "node:stream";
import archiver from "archiver";
import unzipper from "unzipper";
import type { DataExportJobRequest, DataImportPresignRequest, DataImportResult, DataTransferJob } from "@persona/shared";
import { and, eq, inArray } from "drizzle-orm";
import { getDatabase } from "../db/client.js";
import { backgroundJobs, generatedAudio, generatedMedia, openAIArtifacts, uploads } from "../db/schema.js";
import { env } from "../config/env.js";
import { HttpError } from "../utils/httpError.js";
import { logger } from "../utils/logger.js";
import { ConversationStore } from "./conversationStore.js";
import { DataTransferService } from "./dataTransferService.js";
import { jobQueueService } from "./jobQueueService.js";
import { storageService } from "./storageService.js";

const QUEUE = "data-transfer";
const ZIP_ENTRY_LIMIT = 25_000;
const CONVERSATIONS_PER_SHARD = 250;

type TransferRequest = {
  kind: "import" | "export";
  scope?: DataExportJobRequest["scope"];
  conversationIds?: string[];
  storageKey?: string;
  fileName?: string;
  sizeBytes?: number;
  declaredSha256?: string;
};

type ExportMediaRow = { kind: string; id: string; fileName: string; mimeType: string; storageKey: string };
type StagedImportMedia = { id: string; sourceKeys: string[]; fileName: string; mimeType: string; sizeBytes: number; storageKey: string; sha256: string };
type ExportMedia = ExportMediaRow & { path: string; sizeBytes: number };

type LocalJob = DataTransferJob & { ownerId: string; request: TransferRequest; abortController: AbortController; resultStorageKey?: string };

function sha256(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}

function expiresAt(): string {
  return new Date(Date.now() + env.DATA_TRANSFER_JOB_TTL_HOURS * 60 * 60 * 1000).toISOString();
}

function safeImportName(name: string): string {
  const safe = name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 160) || "data-import.zip";
  return /\.(zip|json|jsonl)$/i.test(safe) ? safe : `${safe}.zip`;
}

function parseArchiveJson(text: string, label: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    throw new HttpError(`${label} contains invalid JSON.`, 400);
  }
}

function archiveSizeError(): HttpError {
  return new HttpError("Expanded import archive is too large.", 413);
}

async function readStreamBuffer(stream: Readable, maxBytes: number, onBytes?: (bytes: number) => void): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let sizeBytes = 0;
  for await (const chunk of stream) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    sizeBytes += buffer.byteLength;
    if (sizeBytes > maxBytes) {
      stream.destroy();
      throw archiveSizeError();
    }
    onBytes?.(buffer.byteLength);
    chunks.push(buffer);
  }
  return Buffer.concat(chunks, sizeBytes);
}

export class DataTransferJobService {
  private readonly jobs = new Map<string, LocalJob>();
  private readonly queueIds = new Map<string, string>();
  private readonly transfer = new DataTransferService(new ConversationStore());

  async startWorker(): Promise<void> {
    if (!jobQueueService.enabled) return;
    await jobQueueService.work<{ appJobId: string }>(QUEUE, async (queueJob) => {
      await this.execute(queueJob.data.appJobId, queueJob.signal);
    });
  }

  async startExport(ownerId: string, request: DataExportJobRequest): Promise<DataTransferJob> {
    const job = await this.createJob(ownerId, { kind: "export", scope: request.scope, ...(request.conversationIds ? { conversationIds: request.conversationIds } : {}) }, "queued");
    try {
      await this.dispatch(job.id);
    } catch (error) {
      await this.update(job.id, { status: "failed", phase: "Queue unavailable", error: error instanceof Error ? error.message : "Could not queue data export." });
      throw error;
    }
    return this.publicJob(job);
  }

  async presignImport(ownerId: string, request: DataImportPresignRequest) {
    if (request.sizeBytes > env.DATA_TRANSFER_ARCHIVE_MAX_BYTES) throw new HttpError("Import archive is too large.", 413);
    if (!/\.(zip|json|jsonl)$/i.test(request.fileName)) throw new HttpError("Import files must be ZIP, JSON, or JSONL archives.", 400);
    if (!storageService.supportsPresignedUploads()) throw new HttpError("Direct import uploads are unavailable for this storage driver.", 409);
    const job = await this.createJob(ownerId, {
      kind: "import",
      fileName: safeImportName(request.fileName),
      sizeBytes: request.sizeBytes,
      ...(request.sha256 ? { declaredSha256: request.sha256 } : {})
    }, "awaiting_upload");
    const storageKey = `uploads/data-transfer-${job.id}-source-${safeImportName(request.fileName)}`;
    job.request.storageKey = storageKey;
    await this.persistRequest(job);
    try {
      const presigned = await storageService.presignPut(storageKey, request.mimeType);
      return { jobId: job.id, assetId: job.id, ...presigned };
    } catch (error) {
      await this.update(job.id, { status: "failed", phase: "Upload preparation failed", error: error instanceof Error ? error.message : "Could not prepare import upload." });
      throw error;
    }
  }

  async completeImport(ownerId: string, jobId: string): Promise<DataTransferJob> {
    const job = await this.requireOwned(jobId, ownerId);
    if (job.kind !== "import" || job.status !== "awaiting_upload" || !job.request.storageKey) {
      throw new HttpError("Import job is not awaiting an upload.", 409);
    }
    const object = await storageService.head(job.request.storageKey);
    if (object.sizeBytes !== job.request.sizeBytes) throw new HttpError("Uploaded archive size does not match the request.", 400);
    await this.update(jobId, { status: "queued", phase: "Queued", progress: 0 });
    try {
      await this.dispatch(jobId);
    } catch (error) {
      await this.update(jobId, { status: "failed", phase: "Queue unavailable", error: error instanceof Error ? error.message : "Could not queue data import." });
      throw error;
    }
    return this.get(jobId, ownerId) as Promise<DataTransferJob>;
  }

  async startImportBuffer(ownerId: string, file: { fileName: string; mimeType: string; buffer: Buffer }): Promise<DataTransferJob> {
    if (file.buffer.byteLength > env.DATA_TRANSFER_ARCHIVE_MAX_BYTES) throw new HttpError("Import archive is too large.", 413);
    if (!/\.(zip|json|jsonl)$/i.test(file.fileName)) throw new HttpError("Import files must be ZIP, JSON, or JSONL archives.", 400);
    const job = await this.createJob(ownerId, {
      kind: "import",
      fileName: safeImportName(file.fileName),
      sizeBytes: file.buffer.byteLength
    }, "queued");
    try {
      const stored = await storageService.put({ bucket: "uploads", fileName: `data-transfer-${job.id}-${safeImportName(file.fileName)}`, buffer: file.buffer });
      job.request.storageKey = stored.storageKey;
      await this.persistRequest(job);
      await this.dispatch(job.id);
      return this.publicJob(job);
    } catch (error) {
      await this.update(job.id, { status: "failed", phase: "Upload failed", error: error instanceof Error ? error.message : "Could not store import archive." });
      throw error;
    }
  }

  async get(jobId: string, ownerId: string): Promise<DataTransferJob | undefined> {
    const db = getDatabase();
    if (db) {
      const row = await db.query.backgroundJobs.findFirst({ where: and(eq(backgroundJobs.id, jobId), eq(backgroundJobs.ownerId, ownerId)) });
      return row && row.kind === "data_transfer" ? this.rowToPublic(row) : undefined;
    }
    const local = this.jobs.get(jobId);
    return local?.ownerId === ownerId ? this.publicJob(local) : undefined;
  }

  async cancelForOwner(ownerId: string, error = "Account deletion cancelled this data transfer."): Promise<void> {
    const ids = new Set([...this.jobs.values()]
      .filter((job) => job.ownerId === ownerId && ["awaiting_upload", "queued", "running"].includes(job.status))
      .map((job) => job.id));
    const db = getDatabase();
    if (db) {
      const rows = await db.query.backgroundJobs.findMany({ where: and(eq(backgroundJobs.ownerId, ownerId), eq(backgroundJobs.kind, "data_transfer"), inArray(backgroundJobs.status, ["awaiting_upload", "queued", "running"])) });
      rows.forEach((row) => ids.add(row.id));
    }
    await Promise.allSettled([...ids].map((id) => this.cancel(id, ownerId, error)));
  }

  async cancel(jobId: string, ownerId: string, error = "Data transfer cancelled."): Promise<DataTransferJob | undefined> {
    const job = await this.requireOwned(jobId, ownerId);
    if (!["awaiting_upload", "queued", "running"].includes(job.status)) return this.publicJob(job);
    job.abortController.abort(new Error(error));
    const cancelled = await this.update(jobId, { status: "cancelled", phase: "Cancelled", error });
    if (!cancelled) return this.get(jobId, ownerId);
    const queueId = this.queueIds.get(jobId) ?? await jobQueueService.findQueueJobId(QUEUE, jobId);
    if (queueId) {
      await jobQueueService.cancel(QUEUE, queueId).catch((queueError) => {
        logger.warn("Could not cancel data transfer queue entry after marking the app job cancelled", {
          jobId,
          error: queueError instanceof Error ? queueError.message : String(queueError)
        });
      });
    }
    this.queueIds.delete(jobId);
    if (job.kind === "import" && job.request.storageKey) await storageService.delete(job.request.storageKey).catch(() => undefined);
    return this.get(jobId, ownerId);
  }

  async download(jobId: string, ownerId: string) {
    const job = await this.requireOwned(jobId, ownerId);
    if (job.kind !== "export" || job.status !== "completed" || !job.resultStorageKey || !job.fileName) {
      throw new HttpError("Export archive is not ready.", 409);
    }
    const stored = await storageService.getStream(job.resultStorageKey);
    return { stream: stored.stream, sizeBytes: stored.sizeBytes, fileName: job.fileName, mimeType: "application/zip" };
  }

  async cleanupExpiredNow(now = new Date()): Promise<void> {
    const cutoff = now.getTime();
    const db = getDatabase();
    if (db) {
      const rows = await db.query.backgroundJobs.findMany({ where: eq(backgroundJobs.kind, "data_transfer") });
      for (const row of rows) {
        const expiry = typeof row.metadata.expiresAt === "string"
          ? Date.parse(row.metadata.expiresAt)
          : row.updatedAt.getTime() + env.DATA_TRANSFER_JOB_TTL_HOURS * 60 * 60 * 1000;
        if (expiry > cutoff || row.status === "running" || row.status === "queued") continue;
        const keys = [row.request?.storageKey, row.metadata.resultStorageKey].filter((key): key is string => typeof key === "string");
        const cleanup = await Promise.allSettled(keys.map((key) => storageService.delete(key)));
        if (cleanup.some((result) => result.status === "rejected")) continue;
        await db.delete(backgroundJobs).where(eq(backgroundJobs.id, row.id));
        this.jobs.delete(row.id);
      }
      return;
    }
    for (const [id, job] of this.jobs) {
      const expiry = job.expiresAt ? Date.parse(job.expiresAt) : Date.parse(job.updatedAt) + env.DATA_TRANSFER_JOB_TTL_HOURS * 60 * 60 * 1000;
      if (expiry <= cutoff && job.status !== "running" && job.status !== "queued") {
        await Promise.allSettled([job.request.storageKey, job.resultStorageKey].filter((key): key is string => Boolean(key)).map((key) => storageService.delete(key)));
        this.jobs.delete(id);
      }
    }
  }

  private async dispatch(jobId: string): Promise<void> {
    if (jobQueueService.enabled) {
      const queueId = await jobQueueService.send(QUEUE, { appJobId: jobId });
      this.queueIds.set(jobId, queueId);
      return;
    }
    void this.execute(jobId).catch(() => undefined);
  }

  private async execute(jobId: string, queueSignal?: AbortSignal): Promise<void> {
    const job = await this.load(jobId);
    if (!job || !["queued", "running", "failed"].includes(job.status)) return;
    const abortFromQueue = () => job.abortController.abort(queueSignal?.reason);
    if (queueSignal?.aborted) abortFromQueue();
    else queueSignal?.addEventListener("abort", abortFromQueue, { once: true });
    try {
      if (!await this.update(jobId, { status: "running", phase: job.kind === "export" ? "Reading conversations" : "Reading archive", progress: 1 })) return;
      if (job.kind === "export") await this.executeExport(job);
      else await this.executeImport(job);
    } catch (error) {
      if (job.abortController.signal.aborted) {
        await this.update(jobId, { status: "cancelled", phase: "Cancelled", error: "Data transfer cancelled." });
        return;
      }
      const message = error instanceof Error ? error.message : String(error);
      await this.update(jobId, { status: "failed", phase: "Failed", error: message });
      logger.warn("Data transfer job failed", { jobId, kind: job.kind, error: message });
      throw error;
    } finally {
      queueSignal?.removeEventListener("abort", abortFromQueue);
      this.queueIds.delete(jobId);
    }
  }

  private async executeExport(job: LocalJob): Promise<void> {
    const archive = job.request.scope === "conversations"
      ? await this.transfer.exportConversations(job.ownerId, job.request.conversationIds)
      : await this.transfer.exportAccount(job.ownerId);
    if (job.abortController.signal.aborted) throw job.abortController.signal.reason;
    await this.update(job.id, { phase: "Building archive", progress: 25, processedItems: 0, totalItems: archive.conversations.length });
    const conversationFiles: string[] = [];
    let expandedBytes = 0;
    const conversationShards: Array<{ name: string; contents: string }> = [];
    for (let offset = 0; offset < archive.conversations.length; offset += CONVERSATIONS_PER_SHARD) {
      await this.assertActive(job);
      const name = `conversations-${String(offset / CONVERSATIONS_PER_SHARD).padStart(3, "0")}.json`;
      const contents = JSON.stringify(archive.conversations.slice(offset, offset + CONVERSATIONS_PER_SHARD));
      expandedBytes += Buffer.byteLength(contents);
      if (expandedBytes > env.DATA_TRANSFER_ARCHIVE_MAX_BYTES) throw new HttpError("Generated export exceeds the configured archive size limit.", 413);
      conversationShards.push({ name, contents });
      conversationFiles.push(name);
      await this.update(job.id, { progress: Math.min(55, 25 + Math.round((offset + CONVERSATIONS_PER_SHARD) / Math.max(1, archive.conversations.length) * 30)), processedItems: Math.min(offset + CONVERSATIONS_PER_SHARD, archive.conversations.length) });
    }
    const accountContents = JSON.stringify(archive.account ?? null);
    expandedBytes += Buffer.byteLength(accountContents);
    const mediaArchive = await this.collectExportMedia(job, expandedBytes);
    expandedBytes = mediaArchive.sizeBytes;
    const manifest = {
      format: "for-the-baddiez-export",
      version: 2,
      exportedAt: archive.exportedAt,
      scope: archive.scope,
      conversationFiles,
      conversationCount: archive.conversations.length,
      media: mediaArchive.manifest,
      ...(mediaArchive.omitted.length ? { omittedMedia: mediaArchive.omitted } : {})
    };
    const manifestContents = JSON.stringify(manifest, null, 2);
    expandedBytes += Buffer.byteLength(manifestContents);
    if (expandedBytes > env.DATA_TRANSFER_ARCHIVE_MAX_BYTES) throw new HttpError("Generated export exceeds the configured archive size limit.", 413);
    await this.update(job.id, { phase: "Compressing archive", progress: 80 });
    const fileName = `for-the-baddiez-${archive.scope}-${new Date().toISOString().slice(0, 10)}.zip`;
    const output = new PassThrough();
    const zip = archiver("zip", { zlib: { level: 6 } });
    const activeSources = new Set<Readable>();
    const destroyActiveSources = (reason: Error) => {
      for (const source of activeSources) source.destroy(reason);
      activeSources.clear();
    };
    const abort = () => {
      const reason = job.abortController.signal.reason instanceof Error ? job.abortController.signal.reason : new Error("Data transfer cancelled.");
      destroyActiveSources(reason);
      zip.abort();
      output.destroy(reason);
    };
    job.abortController.signal.addEventListener("abort", abort, { once: true });
    zip.on("error", (error) => output.destroy(error));
    zip.pipe(output);
    const upload = storageService.putStream({ bucket: "uploads", fileName: `data-transfer-${job.id}.zip`, stream: output, mimeType: "application/zip", signal: job.abortController.signal });
    // Attach a rejection handler immediately. Source reads can continue for a
    // while after the destination fails, and Node would otherwise report the
    // upload rejection as unhandled before this function reaches `await`.
    void upload.catch(() => undefined);
    try {
      zip.append(manifestContents, { name: "manifest.json" });
      zip.append(accountContents, { name: "account.json" });
      conversationShards.forEach((shard) => zip.append(shard.contents, { name: shard.name }));
      for (let index = 0; index < mediaArchive.media.length; index += 1) {
        await this.assertActive(job);
        const media = mediaArchive.media[index]!;
        const source = await storageService.getStream(media.storageKey);
        activeSources.add(source.stream);
        const sourceSettled = () => activeSources.delete(source.stream);
        source.stream.once("close", sourceSettled);
        source.stream.once("end", sourceSettled);
        source.stream.once("error", sourceSettled);
        zip.append(source.stream, { name: media.path });
        await this.update(job.id, { phase: "Adding media", progress: Math.min(95, 80 + Math.round((index + 1) / Math.max(1, mediaArchive.media.length) * 15)) });
      }
      await zip.finalize();
      const stored = await upload;
      await this.assertActive(job);
      const completed = await this.update(job.id, { status: "completed", phase: "Ready to download", progress: 100, fileName, sizeBytes: stored.sizeBytes, resultStorageKey: stored.storageKey, expiresAt: expiresAt() });
      if (!completed) await storageService.delete(stored.storageKey).catch(() => undefined);
    } catch (error) {
      // Archiver and the destination upload are connected by a live stream.
      // If reading a source object or finalizing the ZIP fails, close both ends
      // and wait for the upload to settle so no multipart request is orphaned.
      const exportError = error instanceof Error ? error : new Error("Data export failed.");
      destroyActiveSources(exportError);
      zip.abort();
      if (!output.destroyed) {
        output.destroy(exportError);
      }
      await upload.catch(() => undefined);
      throw error;
    } finally {
      job.abortController.signal.removeEventListener("abort", abort);
    }
  }

  private async collectExportMedia(job: LocalJob, initialBytes: number): Promise<{ media: ExportMedia[]; manifest: Array<Record<string, unknown>>; omitted: Array<Record<string, unknown>>; sizeBytes: number }> {
    const db = getDatabase();
    if (!db) return { media: [], manifest: [], omitted: [], sizeBytes: initialBytes };
    const [uploadRows, mediaRows, audioRows, artifactRows] = await Promise.all([
      db.select().from(uploads).where(eq(uploads.ownerId, job.ownerId)),
      db.select().from(generatedMedia).where(eq(generatedMedia.ownerId, job.ownerId)),
      db.select().from(generatedAudio).where(eq(generatedAudio.ownerId, job.ownerId)),
      db.select().from(openAIArtifacts).where(eq(openAIArtifacts.ownerId, job.ownerId))
    ]);
    const selectedIds = job.request.scope === "conversations" ? new Set(job.request.conversationIds ?? []) : undefined;
    const candidates: Array<Omit<ExportMediaRow, "storageKey"> & { storageKey: string | null }> = [
      ...uploadRows.filter((row) => !selectedIds || (typeof row.metadata.conversationId === "string" && selectedIds.has(row.metadata.conversationId))).map((row) => ({ kind: "upload", id: row.id, fileName: row.fileName, mimeType: row.mimeType, storageKey: row.storageKey })),
      ...mediaRows.filter((row) => !selectedIds || (row.conversationId ? selectedIds.has(row.conversationId) : false)).map((row) => ({ kind: "generated_media", id: row.id, fileName: row.fileName, mimeType: row.mimeType, storageKey: row.storageKey })),
      ...audioRows.filter((row) => !selectedIds || (row.conversationId ? selectedIds.has(row.conversationId) : false)).map((row) => ({ kind: "generated_audio", id: row.token, fileName: row.fileName, mimeType: row.mimeType, storageKey: row.storageKey })),
      ...artifactRows.filter((row) => !selectedIds || (row.conversationId ? selectedIds.has(row.conversationId) : false)).map((row) => ({ kind: "openai_artifact", id: row.id, fileName: row.fileName, mimeType: row.mimeType, storageKey: row.storageKey }))
    ];
    const rows: ExportMediaRow[] = candidates.filter((row): row is ExportMediaRow => Boolean(row.storageKey));
    const media: ExportMedia[] = [];
    const manifest: Array<Record<string, unknown>> = [];
    const omitted: Array<Record<string, unknown>> = [];
    let sizeBytes = initialBytes;
    for (let index = 0; index < rows.length; index += 1) {
      await this.assertActive(job);
      const row = rows[index]!;
      let stored;
      try {
        stored = await storageService.head(row.storageKey);
      } catch (error) {
        if (error instanceof HttpError && error.statusCode === 404) {
          omitted.push({ kind: row.kind, sourceId: row.id, fileName: row.fileName, reason: "stored_object_missing" });
          logger.warn("Omitting missing media from data export", { jobId: job.id, kind: row.kind, sourceId: row.id });
          continue;
        }
        throw error;
      }
      sizeBytes += stored.sizeBytes;
      if (sizeBytes > env.DATA_TRANSFER_ARCHIVE_MAX_BYTES) throw new HttpError("Generated export exceeds the configured archive size limit.", 413);
      const path = `media/${row.kind}/${row.id}/${row.fileName.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
      media.push({ ...row, path, sizeBytes: stored.sizeBytes });
      manifest.push({ kind: row.kind, sourceId: row.id, path, fileName: row.fileName, mimeType: row.mimeType, sizeBytes: stored.sizeBytes });
      await this.update(job.id, { phase: "Preparing media", progress: Math.min(78, 55 + Math.round((index + 1) / Math.max(1, rows.length) * 23)) });
    }
    return { media, manifest, omitted, sizeBytes };
  }

  private async executeImport(job: LocalJob): Promise<void> {
    if (!job.request.storageKey) throw new HttpError("Import archive is missing.", 404);
    const stored = await storageService.getStream(job.request.storageKey);
    if (stored.sizeBytes !== undefined && stored.sizeBytes > env.DATA_TRANSFER_ARCHIVE_MAX_BYTES) throw new HttpError("Import archive is too large.", 413);
    const archive = job.request.fileName?.toLowerCase().endsWith(".zip")
      ? await this.readZipArchive(stored.stream, job)
      : await this.readBufferedArchive(stored.stream, job);
    const digest = archive.digest;
    const stagedMedia = archive.media;
    const committedMediaIds = new Set<string>();
    let databaseImportCommitted = false;
    try {
      if (job.request.declaredSha256 && digest !== job.request.declaredSha256.toLowerCase()) {
        throw new HttpError("Import archive checksum does not match.", 400);
      }
      const duplicate = await this.findCompletedImport(job.ownerId, digest, job.id);
      if (duplicate) {
        await Promise.allSettled(stagedMedia.map((media) => storageService.delete(media.storageKey)));
        await this.update(job.id, { status: "completed", phase: "Duplicate archive skipped", progress: 100, source: duplicate.source, result: { source: duplicate.source ?? "for-the-baddiez", importedConversations: 0, skippedConversations: (duplicate.result?.importedConversations ?? 0) + (duplicate.result?.skippedConversations ?? 0), conversations: [] }, archiveSha256: digest, expiresAt: expiresAt() });
        return;
      }
      const result = await this.transfer.importArchiveAtomically(job.ownerId, archive.value, {
        signal: job.abortController.signal,
        media: stagedMedia,
        onMediaCommitted: (ids) => ids.forEach((id) => committedMediaIds.add(id)),
        onProgress: async (processed, total) => {
          await this.assertActive(job);
          await this.update(job.id, { phase: "Importing conversations", progress: 50 + Math.round(processed / Math.max(1, total) * 45), processedItems: processed, totalItems: total });
        }
      });
      databaseImportCommitted = true;
      await Promise.allSettled(stagedMedia.filter((media) => !committedMediaIds.has(media.id)).map((media) => storageService.delete(media.storageKey)));
      await this.update(job.id, { status: "completed", phase: "Import complete", progress: 100, source: result.source, result, archiveSha256: digest, expiresAt: expiresAt() });
    } catch (error) {
      await Promise.allSettled(stagedMedia
        .filter((media) => !databaseImportCommitted || !committedMediaIds.has(media.id))
        .map((media) => storageService.delete(media.storageKey)));
      throw error;
    }
  }

  private async readBufferedArchive(stream: Readable, job: LocalJob): Promise<{ value: unknown; media: StagedImportMedia[]; digest: string }> {
    const buffer = await readStreamBuffer(stream, env.DATA_TRANSFER_JSON_MAX_BYTES);
    const digest = sha256(buffer);
    const lowerName = job.request.fileName?.toLowerCase();
    if (lowerName?.endsWith(".json")) return { value: parseArchiveJson(buffer.toString("utf8"), "Import file"), media: [], digest };
    if (lowerName?.endsWith(".jsonl")) {
      const values = buffer.toString("utf8").split(/\r?\n/).map((line) => line.trim()).filter(Boolean).map((line, index) => parseArchiveJson(line, `JSONL line ${index + 1}`));
      if (values.length === 0) throw new HttpError("Import JSONL file is empty.", 400);
      return { value: values, media: [], digest };
    }
    throw new HttpError("Import files must be ZIP, JSON, or JSONL archives.", 400);
  }

  private async readZipArchive(stream: Readable, job: LocalJob): Promise<{ value: unknown; media: StagedImportMedia[]; digest: string }> {
    const archiveHash = createHash("sha256");
    const sourceHash = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        archiveHash.update(chunk);
        callback(null, chunk);
      }
    });
    const parser = stream.pipe(sourceHash).pipe(unzipper.Parse({ forceStream: true }));
    let entryCount = 0;
    let expandedBytes = 0;
    let manifest: { format?: string; version?: number; exportedAt?: string; scope?: "account" | "conversations"; media?: Array<{ sourceId?: string; path?: string; fileName?: string; mimeType?: string }> } | undefined;
    let exportValue: unknown;
    let account: unknown;
    const merged: unknown[] = [];
    const media: StagedImportMedia[] = [];
    const addExpandedBytes = (bytes: number): void => {
      expandedBytes += bytes;
      if (expandedBytes > env.DATA_TRANSFER_ARCHIVE_MAX_BYTES) throw archiveSizeError();
    };
    try {
      for await (const rawEntry of parser) {
        await this.assertActive(job);
        const entry = rawEntry as Readable & { path: string; type?: string; autodrain?: () => void };
        if (entry.type === "Directory") {
          entry.autodrain?.();
          continue;
        }
        entryCount += 1;
        if (entryCount > ZIP_ENTRY_LIMIT) throw new HttpError("Import ZIP contains too many files.", 400);
        const path = entry.path.replace(/\\/g, "/");
        if (path === "manifest.json") {
          const contents = await readStreamBuffer(entry, env.DATA_TRANSFER_JSON_MAX_BYTES, addExpandedBytes);
          manifest = parseArchiveJson(contents.toString("utf8"), "Import manifest") as typeof manifest;
          continue;
        }
        if (path === "account.json") {
          const contents = await readStreamBuffer(entry, env.DATA_TRANSFER_JSON_MAX_BYTES, addExpandedBytes);
          account = parseArchiveJson(contents.toString("utf8"), "Account file");
          continue;
        }
        if (path === "export.json") {
          const contents = await readStreamBuffer(entry, env.DATA_TRANSFER_JSON_MAX_BYTES, addExpandedBytes);
          exportValue = parseArchiveJson(contents.toString("utf8"), "Export JSON");
          continue;
        }
        if (path.startsWith("media/") || /^file_[a-zA-Z0-9]+\.dat$/.test(path)) {
          const metadata = Array.isArray(manifest?.media) ? manifest.media.find((item) => item?.path === path) : undefined;
          media.push(await this.stageZipMediaEntry(entry, path, metadata, job, addExpandedBytes));
          continue;
        }
        if (/(^|\/)conversations(?:-\d+)?\.json$/i.test(path)) {
          const contents = await readStreamBuffer(entry, env.DATA_TRANSFER_JSON_MAX_BYTES, addExpandedBytes);
          const parsed = parseArchiveJson(contents.toString("utf8"), `Conversation file ${path}`);
          if (Array.isArray(parsed)) merged.push(...parsed);
          else if (parsed && typeof parsed === "object" && Array.isArray((parsed as { conversations?: unknown[] }).conversations)) merged.push(...(parsed as { conversations: unknown[] }).conversations);
          await this.update(job.id, { phase: "Reading conversation files", progress: Math.min(45, 5 + entryCount) });
          continue;
        }
        // Unknown ZIP entries still have to count toward the expanded-size
        // ceiling. Autodraining without accounting lets a compression bomb hide
        // in an otherwise ignored file.
        for await (const chunk of entry) {
          if (job.abortController.signal.aborted) throw job.abortController.signal.reason;
          const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
          addExpandedBytes(buffer.byteLength);
        }
      }
    } catch (error) {
      await Promise.allSettled(media.map((item) => storageService.delete(item.storageKey)));
      if (error instanceof HttpError || job.abortController.signal.aborted) throw error;
      throw new HttpError("Import ZIP is invalid or corrupted.", 400);
    }
    const digest = archiveHash.digest("hex");
    if (exportValue !== undefined) return { value: exportValue, media, digest };
    if (merged.length === 0) throw new HttpError("ZIP does not contain a supported conversations JSON file.", 400);
    if (manifest?.format === "for-the-baddiez-export" && manifest.version === 2) {
      return {
        value: {
          format: "for-the-baddiez-export",
          version: 1,
          exportedAt: manifest.exportedAt ?? new Date().toISOString(),
          scope: manifest.scope ?? "account",
          ...(account ? { account } : {}),
          conversations: merged
        },
        media,
        digest
      };
    }
    return { value: merged, media, digest };
  }

  private async stageZipMediaEntry(
    entry: Readable,
    path: string,
    metadata: { sourceId?: string; fileName?: string; mimeType?: string } | undefined,
    job: LocalJob,
    addExpandedBytes: (bytes: number) => void
  ): Promise<StagedImportMedia> {
    const fileName = (metadata?.fileName ?? path.split("/").pop() ?? "imported-file.dat").replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 500) || "imported-file.dat";
    const mimeType = typeof metadata?.mimeType === "string" && metadata.mimeType.length <= 200 ? metadata.mimeType : mimeTypeForName(path);
    const digest = createHash("sha256");
    let sizeBytes = 0;
    const accounting = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        sizeBytes += chunk.byteLength;
        digest.update(chunk);
        try {
          addExpandedBytes(chunk.byteLength);
          callback(null, chunk);
        } catch (error) {
          callback(error as Error);
        }
      }
    });
    entry.pipe(accounting);
    const id = `asset_${randomUUID()}`;
    const stored = await storageService.putStream({ bucket: "uploads", fileName: `${id}-${fileName}`, stream: accounting, mimeType, signal: job.abortController.signal });
    return {
      id,
      sourceKeys: [...new Set([fileName, ...(typeof metadata?.sourceId === "string" && metadata.sourceId.length <= 500 ? [metadata.sourceId] : [])])],
      fileName,
      mimeType,
      sizeBytes: stored.sizeBytes || sizeBytes,
      storageKey: stored.storageKey,
      sha256: digest.digest("hex")
    };
  }

  private async findCompletedImport(ownerId: string, digest: string, excludeId: string): Promise<DataTransferJob | undefined> {
    const db = getDatabase();
    if (!db) return undefined;
    const rows = await db.query.backgroundJobs.findMany({ where: and(eq(backgroundJobs.ownerId, ownerId), eq(backgroundJobs.kind, "data_transfer"), eq(backgroundJobs.status, "completed")) });
    const match = rows.find((row) => row.id !== excludeId && row.metadata.archiveSha256 === digest && row.request?.kind === "import");
    return match ? this.rowToPublic(match) : undefined;
  }

  private async createJob(ownerId: string, request: TransferRequest, status: DataTransferJob["status"]): Promise<LocalJob> {
    const timestamp = new Date().toISOString();
    const job: LocalJob = { id: `data_job_${randomUUID()}`, kind: request.kind, status, phase: status === "awaiting_upload" ? "Awaiting upload" : "Queued", progress: 0, processedItems: 0, totalItems: 0, ownerId, request, abortController: new AbortController(), createdAt: timestamp, updatedAt: timestamp };
    this.jobs.set(job.id, job);
    const db = getDatabase();
    if (db) await db.insert(backgroundJobs).values({ id: job.id, kind: "data_transfer", status, ownerId, request, metadata: { phase: job.phase, progress: 0, processedItems: 0, totalItems: 0 }, createdAt: new Date(timestamp), updatedAt: new Date(timestamp) });
    return job;
  }

  private async load(id: string): Promise<LocalJob | undefined> {
    const db = getDatabase();
    const local = this.jobs.get(id);
    if (!db) return local;
    const row = await db.query.backgroundJobs.findFirst({ where: eq(backgroundJobs.id, id) });
    if (!row || row.kind !== "data_transfer" || !row.ownerId) return undefined;
    const publicJob = this.rowToPublic(row);
    const job: LocalJob = { ...publicJob, ownerId: row.ownerId, request: row.request as TransferRequest, abortController: local?.abortController ?? new AbortController(), ...(typeof row.metadata.resultStorageKey === "string" ? { resultStorageKey: row.metadata.resultStorageKey } : {}) };
    this.jobs.set(id, job);
    return job;
  }

  private async requireOwned(id: string, ownerId: string): Promise<LocalJob> {
    const job = await this.load(id);
    if (!job || job.ownerId !== ownerId) throw new HttpError("Data transfer job not found.", 404);
    return job;
  }

  private async assertActive(job: LocalJob): Promise<void> {
    if (job.abortController.signal.aborted) throw job.abortController.signal.reason;
    const db = getDatabase();
    if (!db) return;
    const row = await db.query.backgroundJobs.findFirst({ where: eq(backgroundJobs.id, job.id), columns: { status: true } });
    if (!row || row.status === "cancelled") {
      const reason = new Error("Data transfer cancelled.");
      job.abortController.abort(reason);
      throw reason;
    }
  }

  private async persistRequest(job: LocalJob): Promise<void> {
    const db = getDatabase();
    if (db) await db.update(backgroundJobs).set({ request: job.request, updatedAt: new Date() }).where(eq(backgroundJobs.id, job.id));
  }

  private async update(id: string, updates: Partial<DataTransferJob> & { resultStorageKey?: string; archiveSha256?: string }): Promise<boolean> {
    const job = await this.load(id);
    if (!job) return false;
    const updatedAt = new Date().toISOString();
    const { archiveSha256: _archiveSha256, ...jobUpdates } = updates;
    const next = { ...job, ...jobUpdates, updatedAt, ...(updates.resultStorageKey ? { resultStorageKey: updates.resultStorageKey } : {}) };
    const db = getDatabase();
    if (!db) {
      Object.assign(job, next);
      return true;
    }
    const terminal = updates.status === "completed" || updates.status === "failed" || updates.status === "cancelled";
    if (!terminal && ["completed", "failed", "cancelled"].includes(job.status) && !(job.status === "failed" && updates.status === "running")) return false;
    const allowedStatuses = updates.status === "running"
      ? ["queued", "running", "failed"]
      : ["awaiting_upload", "queued", "running"];
    const [updated] = await db.update(backgroundJobs).set({
      ...(updates.status ? { status: updates.status } : {}),
      ...(updates.error !== undefined ? { error: updates.error } : {}),
      ...(updates.result ? { response: updates.result as unknown as Record<string, unknown> } : {}),
      metadata: {
        phase: next.phase,
        progress: next.progress,
        processedItems: next.processedItems,
        totalItems: next.totalItems,
        ...(next.source ? { source: next.source } : {}),
        ...(next.fileName ? { fileName: next.fileName } : {}),
        ...(next.sizeBytes !== undefined ? { sizeBytes: next.sizeBytes } : {}),
        ...(next.expiresAt ? { expiresAt: next.expiresAt } : {}),
        ...(next.resultStorageKey ? { resultStorageKey: next.resultStorageKey } : {}),
        ...(updates.archiveSha256 ? { archiveSha256: updates.archiveSha256 } : {})
      },
      updatedAt: new Date(updatedAt)
    }).where(and(eq(backgroundJobs.id, id), inArray(backgroundJobs.status, allowedStatuses))).returning({ id: backgroundJobs.id });
    if (updated) Object.assign(job, next);
    return Boolean(updated);
  }

  private publicJob(job: LocalJob): DataTransferJob {
    const { ownerId: _owner, request: _request, abortController: _abort, resultStorageKey: _key, ...value } = job;
    return {
      ...value,
      ...(job.kind === "export" && job.status === "completed" ? { downloadUrl: `/api/data/jobs/${job.id}/download` } : {})
    };
  }

  private rowToPublic(row: typeof backgroundJobs.$inferSelect): DataTransferJob {
    const metadata = row.metadata;
    const kind = row.request?.kind === "import" ? "import" : "export";
    return {
      id: row.id,
      kind,
      status: (["awaiting_upload", "queued", "running", "completed", "failed", "cancelled"] as const).includes(row.status as never) ? row.status as DataTransferJob["status"] : "failed",
      phase: typeof metadata.phase === "string" ? metadata.phase : row.status,
      progress: typeof metadata.progress === "number" ? metadata.progress : 0,
      processedItems: typeof metadata.processedItems === "number" ? metadata.processedItems : 0,
      totalItems: typeof metadata.totalItems === "number" ? metadata.totalItems : 0,
      ...(metadata.source === "for-the-baddiez" || metadata.source === "chatgpt" || metadata.source === "claude" ? { source: metadata.source } : {}),
      ...(row.response ? { result: row.response as DataImportResult } : {}),
      ...(kind === "export" && row.status === "completed" ? { downloadUrl: `/api/data/jobs/${row.id}/download` } : {}),
      ...(typeof metadata.fileName === "string" ? { fileName: metadata.fileName } : {}),
      ...(typeof metadata.sizeBytes === "number" ? { sizeBytes: metadata.sizeBytes } : {}),
      ...(row.error ? { error: row.error } : {}),
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      ...(typeof metadata.expiresAt === "string" ? { expiresAt: metadata.expiresAt } : {})
    };
  }
}

export const dataTransferJobService = new DataTransferJobService();

function mimeTypeForName(fileName: string): string {
  const extension = fileName.split(".").pop()?.toLowerCase();
  if (extension === "png") return "image/png";
  if (extension === "jpg" || extension === "jpeg") return "image/jpeg";
  if (extension === "webp") return "image/webp";
  if (extension === "gif") return "image/gif";
  if (extension === "mp3") return "audio/mpeg";
  if (extension === "wav") return "audio/wav";
  if (extension === "mp4") return "video/mp4";
  if (extension === "pdf") return "application/pdf";
  return "application/octet-stream";
}
