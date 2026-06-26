import { randomUUID } from "node:crypto";
import type { ChatJobResponse, ChatResponse } from "@persona/shared";
import { logger } from "../utils/logger.js";

type BackgroundChatJob = {
  id: string;
  status: ChatJobResponse["status"];
  createdAt: string;
  updatedAt: string;
  response?: ChatResponse;
  error?: string;
};

const JOB_TTL_MS = 60 * 60 * 1000;

function now(): string {
  return new Date().toISOString();
}

export class BackgroundChatJobService {
  private readonly jobs = new Map<string, BackgroundChatJob>();

  start(executor: () => Promise<ChatResponse>): BackgroundChatJob {
    this.prune();
    const timestamp = now();
    const job: BackgroundChatJob = {
      id: `chat_job_${randomUUID()}`,
      status: "queued",
      createdAt: timestamp,
      updatedAt: timestamp
    };
    this.jobs.set(job.id, job);

    void (async () => {
      this.update(job.id, { status: "running" });
      try {
        const response = await executor();
        this.update(job.id, {
          status: "completed",
          response
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.update(job.id, {
          status: "failed",
          error: message
        });
        logger.warn("Background chat job failed", {
          jobId: job.id,
          error: message
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
      updatedAt: job.updatedAt
    };
  }

  private update(id: string, updates: Partial<Pick<BackgroundChatJob, "status" | "response" | "error">>): void {
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

export const backgroundChatJobService = new BackgroundChatJobService();
