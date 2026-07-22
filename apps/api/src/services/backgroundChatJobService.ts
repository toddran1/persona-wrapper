import { randomUUID } from "node:crypto";
import {
  chatJobFailureReasonSchema,
  chatResponseSchema,
  type ChatJobFailureReason,
  type ChatJobResponse,
  type ChatRequest,
  type ChatResponse
} from "@persona/shared";
import { and, eq, inArray, lte } from "drizzle-orm";
import { getDatabase } from "../db/client.js";
import { backgroundJobs } from "../db/schema.js";
import { logger } from "../utils/logger.js";
import { jobQueueService } from "./jobQueueService.js";
import { usageControlService } from "./usageControlService.js";

export type BackgroundChatJob = {
  id: string;
  status: ChatJobResponse["status"];
  createdAt: string;
  updatedAt: string;
  ownerId?: string;
  usageReservationId?: string;
  abortController: AbortController;
  response?: ChatResponse;
  error?: string;
  failureReason?: ChatJobFailureReason;
  providerResponseId?: string;
  providerStatus?: string;
};

type BackgroundChatExecutor = (request: ChatRequest, job: BackgroundChatJob) => Promise<ChatResponse>;

type QueuedChatJob = {
  appJobId: string;
  request: ChatRequest;
  ownerId?: string;
  usageReservationId?: string;
  provider?: ChatRequest["provider"];
  conversationId?: string;
  createdAt: string;
};

type BackgroundChatJobStartOptions = {
  ownerId?: string;
  usageReservationId?: string;
  provider?: ChatRequest["provider"];
  conversationId?: string;
  request?: ChatRequest;
};

const JOB_TTL_MS = 60 * 60 * 1000;
const CHAT_QUEUE = "background-chat";

function now(): string {
  return new Date().toISOString();
}

export class BackgroundChatJobService {
  private readonly jobs = new Map<string, BackgroundChatJob>();
  private readonly queueJobIds = new Map<string, string>();
  private executor: BackgroundChatExecutor | undefined;

  setExecutor(executor: BackgroundChatExecutor): void {
    this.executor = executor;
  }

  async startWorker(): Promise<void> {
    if (!jobQueueService.enabled) return;
    await jobQueueService.work<QueuedChatJob>(CHAT_QUEUE, async (queueJob) => {
      this.queueJobIds.set(queueJob.data.appJobId, queueJob.id);
      await this.executeQueuedJob(queueJob.data, queueJob.id, queueJob.signal);
    });
  }

  async start(
    options: BackgroundChatJobStartOptions,
    inlineExecutor?: (job: BackgroundChatJob) => Promise<ChatResponse>
  ): Promise<BackgroundChatJob> {
    await this.prune();
    const timestamp = now();
    const job: BackgroundChatJob = {
      id: `chat_job_${randomUUID()}`,
      status: "queued",
      createdAt: timestamp,
      updatedAt: timestamp,
      ...(options.ownerId ? { ownerId: options.ownerId } : {}),
      ...(options.usageReservationId ? { usageReservationId: options.usageReservationId } : {}),
      abortController: new AbortController()
    };
    this.jobs.set(job.id, job);
    await this.insertJobRecord(job, options);

    try {
      if (jobQueueService.enabled && options.request) {
        const queueJobId = await jobQueueService.send<QueuedChatJob>(CHAT_QUEUE, {
          appJobId: job.id,
          request: options.request,
          ...(options.ownerId ? { ownerId: options.ownerId } : {}),
          ...(options.usageReservationId ? { usageReservationId: options.usageReservationId } : {}),
          ...(options.provider ? { provider: options.provider } : {}),
          ...(options.conversationId ? { conversationId: options.conversationId } : {}),
          createdAt: job.createdAt
        });
        this.queueJobIds.set(job.id, queueJobId);
      } else if (inlineExecutor) {
        void this.execute(job, () => inlineExecutor(job)).catch(() => undefined);
      } else if (options.request && this.executor) {
        void this.execute(job, () => this.executor?.(options.request as ChatRequest, job) as Promise<ChatResponse>).catch(() => undefined);
      } else {
        throw new Error("No background chat executor is configured.");
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const cleanup: Promise<unknown>[] = [
        this.update(job.id, { status: "failed", error: message, failureReason: "provider_failure" })
      ];
      if (options.ownerId && options.usageReservationId) {
        cleanup.push(usageControlService.recordUsage(options.ownerId, undefined, undefined, options.usageReservationId));
      }
      await Promise.allSettled(cleanup);
      throw error;
    }

    return job;
  }

  async get(id: string, ownerId?: string): Promise<ChatJobResponse | undefined> {
    await this.prune();
    const db = getDatabase();
    if (db) {
      const persisted = await db.query.backgroundJobs.findFirst({ where: eq(backgroundJobs.id, id) });
      if (!persisted || persisted.kind !== "chat") return undefined;
      if (ownerId && persisted.ownerId && persisted.ownerId !== ownerId) return undefined;
      return {
        id: persisted.id,
        status: parseJobStatus(persisted.status),
        ...(persisted.response ? { response: chatResponseSchema.parse(persisted.response) } : {}),
        ...(persisted.error ? { error: publicJobError(persisted.error) } : {}),
        ...(persisted.failureReason ? { failureReason: chatJobFailureReasonSchema.parse(persisted.failureReason) } : {}),
        ...(persisted.providerResponseId ? { providerResponseId: persisted.providerResponseId } : {}),
        ...(persisted.providerStatus ? { providerStatus: persisted.providerStatus } : {}),
        updatedAt: persisted.updatedAt.toISOString()
      };
    }
    const job = this.jobs.get(id);
    if (!job || (ownerId && job.ownerId && job.ownerId !== ownerId)) return undefined;
    return toChatJobResponse(job);
  }

  async trackProviderResponse(id: string, providerResponseId: string, providerStatus?: string): Promise<void> {
    await this.update(id, {
      providerResponseId,
      ...(providerStatus ? { providerStatus } : {})
    });
  }

  async cancel(id: string, error = "Request cancelled.", ownerId?: string): Promise<ChatJobResponse | undefined> {
    const job = this.jobs.get(id);
    const db = getDatabase();
    if (ownerId && job?.ownerId && job.ownerId !== ownerId) return undefined;
    if (!db && job && job.status !== "queued" && job.status !== "running") return this.get(id, ownerId);
    let reservationId = job?.usageReservationId;
    let persistedStatus: string | undefined;
    if (db) {
      const persisted = await db.query.backgroundJobs.findFirst({ where: eq(backgroundJobs.id, id) });
      if (ownerId && persisted?.ownerId && persisted.ownerId !== ownerId) return undefined;
      persistedStatus = persisted?.status;
      if (persistedStatus && persistedStatus !== "queued" && persistedStatus !== "running") return this.get(id, ownerId);
      const candidate = persisted?.metadata.usageReservationId;
      if (!reservationId && typeof candidate === "string") reservationId = candidate;
    }
    const cancelled = await this.transitionActive(id, {
      status: "cancelled",
      error,
      failureReason: "manual_cancel",
      providerStatus: "cancelled"
    });
    if (!cancelled) return this.get(id, ownerId);
    job?.abortController.abort(new Error(error));
    const queueJobId = this.queueJobIds.get(id) ?? await jobQueueService.findQueueJobId(CHAT_QUEUE, id);
    if (queueJobId) {
      await jobQueueService.cancel(CHAT_QUEUE, queueJobId).catch((queueError) => {
        logger.warn("Could not cancel chat queue entry after marking the app job cancelled", {
          jobId: id,
          error: queueError instanceof Error ? queueError.message : String(queueError)
        });
      });
    }
    this.queueJobIds.delete(id);
    if (ownerId && reservationId) {
      await usageControlService.recordUsage(ownerId, undefined, undefined, reservationId).catch((usageError) => {
        logger.warn("Could not release usage reservation after background job cancellation", {
          jobId: id,
          error: usageError instanceof Error ? usageError.message : String(usageError)
        });
      });
    }
    return this.get(id, ownerId);
  }

  async cancelForOwner(ownerId: string, error = "Account deletion cancelled this request."): Promise<void> {
    const ownedJobIds = new Set([...this.jobs.values()]
      .filter((job) => job.ownerId === ownerId && (job.status === "queued" || job.status === "running"))
      .map((job) => job.id));
    const db = getDatabase();
    if (db) {
      const persisted = await db.query.backgroundJobs.findMany({ where: eq(backgroundJobs.ownerId, ownerId) });
      for (const job of persisted) {
        if (job.status === "queued" || job.status === "running") ownedJobIds.add(job.id);
      }
    }
    await Promise.all([...ownedJobIds].map((id) => this.cancel(id, error, ownerId)));
  }

  private async executeQueuedJob(payload: QueuedChatJob, queueJobId: string, queueSignal: AbortSignal): Promise<void> {
    if (!this.executor) throw new Error("Background chat worker has no executor configured.");
    const timestamp = now();
    const job: BackgroundChatJob = this.jobs.get(payload.appJobId) ?? {
      id: payload.appJobId,
      status: "queued",
      createdAt: payload.createdAt,
      updatedAt: timestamp,
      ...(payload.ownerId ? { ownerId: payload.ownerId } : {}),
      ...(payload.usageReservationId ? { usageReservationId: payload.usageReservationId } : {}),
      abortController: new AbortController()
    };
    this.jobs.set(job.id, job);
    const abortFromQueue = () => job.abortController.abort(queueSignal.reason);
    if (queueSignal.aborted) abortFromQueue();
    else queueSignal.addEventListener("abort", abortFromQueue, { once: true });
    const queueMetadata = await jobQueueService.getJobMetadata<QueuedChatJob>(CHAT_QUEUE, queueJobId).catch((error) => {
      logger.warn("Could not read background chat retry metadata", {
        jobId: job.id,
        queueJobId,
        error: error instanceof Error ? error.message : String(error)
      });
      return undefined;
    });
    // pg-boss invokes this handler again while retries remain. Do not show the
    // user a failed turn until its final attempt; otherwise a later successful
    // durable retry is blocked by the app job's terminal state.
    const terminalAttempt = !queueMetadata || queueMetadata.retryCount >= queueMetadata.retryLimit;
    try {
      await this.execute(job, () => this.executor?.(payload.request, job) as Promise<ChatResponse>, terminalAttempt);
    } catch (error) {
      if (!terminalAttempt) {
        logger.warn("Background chat job will be retried", {
          jobId: job.id,
          queueJobId,
          retryCount: queueMetadata.retryCount,
          retryLimit: queueMetadata.retryLimit,
          error: error instanceof Error ? error.message : String(error)
        });
      }
      throw error;
    } finally {
      queueSignal.removeEventListener("abort", abortFromQueue);
      this.queueJobIds.delete(job.id);
    }
  }

  private async execute(job: BackgroundChatJob, executor: () => Promise<ChatResponse>, recordTerminalFailure = true): Promise<void> {
    if (!await this.transitionActive(job.id, { status: "running" })) return;
    try {
      const response = await executor();
      if (await this.isCancelled(job.id)) return;
      await this.transitionActive(job.id, { status: "completed", response });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (await this.isCancelled(job.id)) return;
      if (!recordTerminalFailure) throw error;
      const failureReason = classifyFailureReason(message);
      const failed = await this.transitionActive(job.id, { status: "failed", error: message, failureReason });
      if (!failed) return;
      if (job.ownerId && job.usageReservationId) {
        await usageControlService.recordUsage(job.ownerId, undefined, undefined, job.usageReservationId).catch((usageError) => {
          logger.warn("Could not release usage reservation after background job failure", {
            jobId: job.id,
            error: usageError instanceof Error ? usageError.message : String(usageError)
          });
        });
      }
      logger.warn("Background chat job failed", {
        jobId: job.id,
        error: message,
        failureReason,
        ...(job.providerResponseId ? { providerResponseId: job.providerResponseId } : {})
      });
      throw error;
    }
  }

  private async isCancelled(id: string): Promise<boolean> {
    if (this.jobs.get(id)?.status === "cancelled") return true;
    const db = getDatabase();
    if (!db) return false;
    const persisted = await db.query.backgroundJobs.findFirst({
      where: eq(backgroundJobs.id, id),
      columns: { status: true }
    });
    return persisted?.status === "cancelled";
  }

  private async transitionActive(
    id: string,
    updates: Pick<BackgroundChatJob, "status"> & Partial<Pick<BackgroundChatJob, "response" | "error" | "failureReason" | "providerResponseId" | "providerStatus">>
  ): Promise<boolean> {
    const job = this.jobs.get(id);
    if (job && job.status !== "queued" && job.status !== "running") return false;

    const updatedAt = now();
    if (job) this.jobs.set(id, { ...job, ...updates, updatedAt });

    const db = getDatabase();
    if (!db) return Boolean(job);
    const [updated] = await db.update(backgroundJobs).set({
      status: updates.status,
      ...(updates.response ? { response: updates.response as unknown as Record<string, unknown> } : {}),
      ...(updates.error !== undefined ? { error: updates.error } : {}),
      ...(updates.failureReason !== undefined ? { failureReason: updates.failureReason } : {}),
      ...(updates.providerResponseId !== undefined ? { providerResponseId: updates.providerResponseId } : {}),
      ...(updates.providerStatus !== undefined ? { providerStatus: updates.providerStatus } : {}),
      updatedAt: new Date(updatedAt)
    }).where(and(
      eq(backgroundJobs.id, id),
      inArray(backgroundJobs.status, ["queued", "running"])
    )).returning({ id: backgroundJobs.id });

    if (updated) return true;
    const persisted = await db.query.backgroundJobs.findFirst({
      where: eq(backgroundJobs.id, id),
      columns: { status: true, updatedAt: true }
    });
    if (job && persisted) {
      this.jobs.set(id, {
        ...this.jobs.get(id) as BackgroundChatJob,
        status: parseJobStatus(persisted.status),
        updatedAt: persisted.updatedAt.toISOString()
      });
    }
    return false;
  }

  private async update(
    id: string,
    updates: Partial<Pick<BackgroundChatJob, "status" | "response" | "error" | "failureReason" | "providerResponseId" | "providerStatus">>
  ): Promise<void> {
    const job = this.jobs.get(id);
    const updatedAt = now();
    if (job) {
      this.jobs.set(id, {
        ...job,
        ...updates,
        updatedAt
      });
    }

    const db = getDatabase();
    if (!db) return;
    await db
      .update(backgroundJobs)
      .set({
        ...(updates.status ? { status: updates.status } : {}),
        ...(updates.response ? { response: updates.response as unknown as Record<string, unknown> } : {}),
        ...(updates.error !== undefined ? { error: updates.error } : {}),
        ...(updates.failureReason !== undefined ? { failureReason: updates.failureReason } : {}),
        ...(updates.providerResponseId !== undefined ? { providerResponseId: updates.providerResponseId } : {}),
        ...(updates.providerStatus !== undefined ? { providerStatus: updates.providerStatus } : {}),
        updatedAt: new Date(updatedAt)
      })
      .where(eq(backgroundJobs.id, id));
  }

  private async insertJobRecord(job: BackgroundChatJob, options: BackgroundChatJobStartOptions): Promise<void> {
    const db = getDatabase();
    if (!db) return;
    await db.insert(backgroundJobs).values({
      id: job.id,
      kind: "chat",
      status: job.status,
      ownerId: options.ownerId,
      conversationId: options.conversationId,
      provider: options.provider,
      request: sanitizeStoredRequest(options.request),
      metadata: options.usageReservationId ? { usageReservationId: options.usageReservationId } : {},
      createdAt: new Date(job.createdAt),
      updatedAt: new Date(job.updatedAt)
    });
  }

  private async prune(): Promise<void> {
    const cutoff = Date.now() - JOB_TTL_MS;
    for (const [id, job] of this.jobs) {
      if (["completed", "failed", "cancelled"].includes(job.status) && Date.parse(job.updatedAt) < cutoff) {
        this.jobs.delete(id);
        this.queueJobIds.delete(id);
      }
    }
    const db = getDatabase();
    if (!db) return;
    await db.delete(backgroundJobs).where(and(
      eq(backgroundJobs.kind, "chat"),
      inArray(backgroundJobs.status, ["completed", "failed", "cancelled"]),
      lte(backgroundJobs.updatedAt, new Date(cutoff))
    ));
  }
}

function sanitizeStoredRequest(request: ChatRequest | undefined): Record<string, unknown> | undefined {
  if (!request) return undefined;
  return {
    personaId: request.personaId,
    provider: request.provider,
    audio: request.audio,
    testMode: request.testMode === true,
    conversationId: request.conversationId,
    messageCharacters: request.message.length,
    attachmentCount: request.attachments?.length ?? 0,
    attachmentKinds: request.attachments?.map((attachment) => attachment.kind) ?? [],
    toolOptions: request.toolOptions
      ? {
          webSearch: request.toolOptions.webSearch === true,
          fileSearch: request.toolOptions.fileSearch === true,
          codeInterpreter: request.toolOptions.codeInterpreter === true,
          imageGeneration: request.toolOptions.imageGeneration === true,
          appFunctions: request.toolOptions.appFunctions === true,
          background: request.toolOptions.background === true,
          vectorStoreCount: request.toolOptions.vectorStoreIds?.length ?? 0
        }
      : undefined
  };
}

function parseJobStatus(status: string): ChatJobResponse["status"] {
  if (status === "queued" || status === "running" || status === "completed" || status === "failed" || status === "cancelled") {
    return status;
  }
  return "failed";
}

function toChatJobResponse(job: BackgroundChatJob): ChatJobResponse {
  return {
    id: job.id,
    status: job.status,
    ...(job.response ? { response: job.response } : {}),
    ...(job.error ? { error: publicJobError(job.error) } : {}),
    ...(job.failureReason ? { failureReason: job.failureReason } : {}),
    ...(job.providerResponseId ? { providerResponseId: job.providerResponseId } : {}),
    ...(job.providerStatus ? { providerStatus: job.providerStatus } : {}),
    updatedAt: job.updatedAt
  };
}

function publicJobError(error: string): string {
  // The stored error is kept for operator logs, but database-driver messages
  // can expose SQL, identifiers, and parameter values to the mobile client.
  if (/failed query:|openai_artifacts|foreign key|violates .*constraint|duplicate key/i.test(error)) {
    return "The response finished, but we could not save it. Please try again.";
  }
  return error;
}

function classifyFailureReason(message: string): ChatJobFailureReason {
  const normalized = message.toLowerCase();
  if (normalized.includes("openai background response timed out") || normalized.includes("background response timed out")) {
    return "openai_background_timeout";
  }
  return "provider_failure";
}

export const backgroundChatJobService = new BackgroundChatJobService();
