import { randomUUID } from "node:crypto";
import {
  chatJobFailureReasonSchema,
  chatResponseSchema,
  type ChatJobFailureReason,
  type ChatJobResponse,
  type ChatRequest,
  type ChatResponse
} from "@persona/shared";
import { eq, lte } from "drizzle-orm";
import { getDatabase } from "../db/client.js";
import { backgroundJobs } from "../db/schema.js";
import { logger } from "../utils/logger.js";

type BackgroundChatJob = {
  id: string;
  status: ChatJobResponse["status"];
  createdAt: string;
  updatedAt: string;
  ownerId?: string;
  abortController: AbortController;
  response?: ChatResponse;
  error?: string;
  failureReason?: ChatJobFailureReason;
  providerResponseId?: string;
  providerStatus?: string;
};

type BackgroundChatJobStartOptions = {
  ownerId?: string;
  provider?: ChatRequest["provider"];
  conversationId?: string;
  request?: ChatRequest;
};

const JOB_TTL_MS = 60 * 60 * 1000;

function now(): string {
  return new Date().toISOString();
}

export class BackgroundChatJobService {
  private readonly jobs = new Map<string, BackgroundChatJob>();

  async start(
    options: BackgroundChatJobStartOptions,
    executor: (job: BackgroundChatJob) => Promise<ChatResponse>
  ): Promise<BackgroundChatJob> {
    await this.prune();
    const timestamp = now();
    const job: BackgroundChatJob = {
      id: `chat_job_${randomUUID()}`,
      status: "queued",
      createdAt: timestamp,
      updatedAt: timestamp,
      ...(options.ownerId ? { ownerId: options.ownerId } : {}),
      abortController: new AbortController()
    };
    this.jobs.set(job.id, job);
    await this.insertJobRecord(job, options);

    void (async () => {
      await this.update(job.id, { status: "running" });
      try {
        const response = await executor(job);
        const latest = this.jobs.get(job.id);
        if (latest?.status === "cancelled") return;
        await this.update(job.id, {
          status: "completed",
          response
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const latest = this.jobs.get(job.id);
        if (latest?.status === "cancelled") return;
        const failureReason = classifyFailureReason(message);
        await this.update(job.id, {
          status: "failed",
          error: message,
          failureReason
        });
        logger.warn("Background chat job failed", {
          jobId: job.id,
          error: message,
          failureReason
        });
      }
    })();

    return job;
  }

  async get(id: string, ownerId?: string): Promise<ChatJobResponse | undefined> {
    await this.prune();
    const job = this.jobs.get(id);
    if (job) {
      if (ownerId && job.ownerId && job.ownerId !== ownerId) return undefined;
      return toChatJobResponse(job);
    }

    const db = getDatabase();
    if (!db) return undefined;
    const persisted = await db.query.backgroundJobs.findFirst({
      where: eq(backgroundJobs.id, id)
    });
    if (!persisted) return undefined;
    if (ownerId && persisted.ownerId && persisted.ownerId !== ownerId) return undefined;
    return {
      id: persisted.id,
      status: parseJobStatus(persisted.status),
      ...(persisted.response ? { response: chatResponseSchema.parse(persisted.response) } : {}),
      ...(persisted.error ? { error: persisted.error } : {}),
      ...(persisted.failureReason ? { failureReason: chatJobFailureReasonSchema.parse(persisted.failureReason) } : {}),
      ...(persisted.providerResponseId ? { providerResponseId: persisted.providerResponseId } : {}),
      ...(persisted.providerStatus ? { providerStatus: persisted.providerStatus } : {}),
      updatedAt: persisted.updatedAt.toISOString()
    };
  }

  async trackProviderResponse(id: string, providerResponseId: string, providerStatus?: string): Promise<void> {
    await this.update(id, {
      providerResponseId,
      ...(providerStatus ? { providerStatus } : {})
    });
  }

  async cancel(id: string, error = "Request cancelled.", ownerId?: string): Promise<ChatJobResponse | undefined> {
    const job = this.jobs.get(id);
    if (ownerId && job?.ownerId && job.ownerId !== ownerId) return undefined;
    job?.abortController.abort(new Error(error));
    await this.update(id, {
      status: "cancelled",
      error,
      failureReason: "manual_cancel",
      providerStatus: "cancelled"
    });
    return this.get(id, ownerId);
  }

  async cancelForOwner(ownerId: string, error = "Account deletion cancelled this request."): Promise<void> {
    const ownedJobIds = [...this.jobs.values()]
      .filter((job) => job.ownerId === ownerId && (job.status === "queued" || job.status === "running"))
      .map((job) => job.id);
    await Promise.all(ownedJobIds.map((id) => this.cancel(id, error, ownerId)));
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
      createdAt: new Date(job.createdAt),
      updatedAt: new Date(job.updatedAt)
    });
  }

  private async prune(): Promise<void> {
    const cutoff = Date.now() - JOB_TTL_MS;
    for (const [id, job] of this.jobs) {
      if (Date.parse(job.updatedAt) < cutoff) {
        this.jobs.delete(id);
      }
    }
    const db = getDatabase();
    if (!db) return;
    await db.delete(backgroundJobs).where(lte(backgroundJobs.updatedAt, new Date(cutoff)));
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
    ...(job.error ? { error: job.error } : {}),
    ...(job.failureReason ? { failureReason: job.failureReason } : {}),
    ...(job.providerResponseId ? { providerResponseId: job.providerResponseId } : {}),
    ...(job.providerStatus ? { providerStatus: job.providerStatus } : {}),
    updatedAt: job.updatedAt
  };
}

function classifyFailureReason(message: string): ChatJobFailureReason {
  const normalized = message.toLowerCase();
  if (normalized.includes("openai background response timed out") || normalized.includes("background response timed out")) {
    return "openai_background_timeout";
  }
  return "provider_failure";
}

export const backgroundChatJobService = new BackgroundChatJobService();
