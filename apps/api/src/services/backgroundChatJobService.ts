import { randomUUID } from "node:crypto";
import type { ChatJobFailureReason, ChatJobResponse, ChatResponse } from "@persona/shared";
import { logger } from "../utils/logger.js";

type BackgroundChatJob = {
  id: string;
  status: ChatJobResponse["status"];
  createdAt: string;
  updatedAt: string;
  abortController: AbortController;
  response?: ChatResponse;
  error?: string;
  failureReason?: ChatJobFailureReason;
  providerResponseId?: string;
  providerStatus?: string;
};

const JOB_TTL_MS = 60 * 60 * 1000;

function now(): string {
  return new Date().toISOString();
}

export class BackgroundChatJobService {
  private readonly jobs = new Map<string, BackgroundChatJob>();

  start(executor: (job: BackgroundChatJob) => Promise<ChatResponse>): BackgroundChatJob {
    this.prune();
    const timestamp = now();
    const job: BackgroundChatJob = {
      id: `chat_job_${randomUUID()}`,
      status: "queued",
      createdAt: timestamp,
      updatedAt: timestamp,
      abortController: new AbortController()
    };
    this.jobs.set(job.id, job);

    void (async () => {
      this.update(job.id, { status: "running" });
      try {
        const response = await executor(job);
        const latest = this.jobs.get(job.id);
        if (latest?.status === "cancelled") return;
        this.update(job.id, {
          status: "completed",
          response
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const latest = this.jobs.get(job.id);
        if (latest?.status === "cancelled") return;
        const failureReason = classifyFailureReason(message);
        this.update(job.id, {
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

  get(id: string): ChatJobResponse | undefined {
    this.prune();
    const job = this.jobs.get(id);
    if (!job) return undefined;

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

  trackProviderResponse(id: string, providerResponseId: string, providerStatus?: string): void {
    this.update(id, {
      providerResponseId,
      ...(providerStatus ? { providerStatus } : {})
    });
  }

  cancel(id: string, error = "Request cancelled."): ChatJobResponse | undefined {
    const job = this.jobs.get(id);
    job?.abortController.abort(new Error(error));
    this.update(id, {
      status: "cancelled",
      error,
      failureReason: "manual_cancel",
      providerStatus: "cancelled"
    });
    return this.get(id);
  }

  private update(
    id: string,
    updates: Partial<Pick<BackgroundChatJob, "status" | "response" | "error" | "failureReason" | "providerResponseId" | "providerStatus">>
  ): void {
    const job = this.jobs.get(id);
    if (!job) return;
    this.jobs.set(id, {
      ...job,
      ...updates,
      updatedAt: now()
    });
  }

  private prune(): void {
    const cutoff = Date.now() - JOB_TTL_MS;
    for (const [id, job] of this.jobs) {
      if (Date.parse(job.updatedAt) < cutoff) {
        this.jobs.delete(id);
      }
    }
  }
}

function classifyFailureReason(message: string): ChatJobFailureReason {
  const normalized = message.toLowerCase();
  if (normalized.includes("openai background response timed out") || normalized.includes("background response timed out")) {
    return "openai_background_timeout";
  }
  return "provider_failure";
}

export const backgroundChatJobService = new BackgroundChatJobService();
