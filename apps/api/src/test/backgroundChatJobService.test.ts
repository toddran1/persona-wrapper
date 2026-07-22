import { afterEach, describe, expect, it, vi } from "vitest";
import { BackgroundChatJobService } from "../services/backgroundChatJobService.js";
import { jobQueueService } from "../services/jobQueueService.js";
import { usageControlService } from "../services/usageControlService.js";

function waitForAbort(signal: AbortSignal): Promise<never> {
  return new Promise((_, reject) => {
    signal.addEventListener("abort", () => {
      reject(signal.reason instanceof Error ? signal.reason : new Error("Aborted"));
    }, { once: true });
  });
}

describe("BackgroundChatJobService", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("marks manual cancellation separately and aborts the running executor", async () => {
    const service = new BackgroundChatJobService();
    const job = await service.start({}, async (runningJob) => waitForAbort(runningJob.abortController.signal));

    await service.trackProviderResponse(job.id, "resp_test_cancel", "in_progress");
    const cancelled = await service.cancel(job.id, "User cancelled the request.");

    expect(cancelled?.status).toBe("cancelled");
    expect(cancelled?.failureReason).toBe("manual_cancel");
    expect(cancelled?.providerResponseId).toBe("resp_test_cancel");
    expect(cancelled?.providerStatus).toBe("cancelled");
  });

  it("classifies OpenAI background timeouts separately from provider failures", async () => {
    const service = new BackgroundChatJobService();
    const job = await service.start({}, async () => {
      throw new Error("OpenAI background response timed out after 120 seconds. Response ID: resp_timeout");
    });

    await new Promise((resolve) => setTimeout(resolve, 0));
    const failed = await service.get(job.id);

    expect(failed?.status).toBe("failed");
    expect(failed?.failureReason).toBe("openai_background_timeout");
  });

  it("does not expose database query text from a failed background job", async () => {
    const service = new BackgroundChatJobService();
    const job = await service.start({}, async () => {
      throw new Error('Failed query: update "openai_artifacts" set "message_id" = $1');
    });

    await new Promise((resolve) => setTimeout(resolve, 0));
    const failed = await service.get(job.id);

    expect(failed?.error).toBe("The response finished, but we could not save it. Please try again.");
  });

  it("does not expose or cancel jobs for another owner", async () => {
    const service = new BackgroundChatJobService();
    const job = await service.start({ ownerId: "owner-a" }, async (runningJob) => waitForAbort(runningJob.abortController.signal));

    await expect(service.get(job.id, "owner-b")).resolves.toBeUndefined();
    await expect(service.cancel(job.id, "Wrong owner.", "owner-b")).resolves.toBeUndefined();

    const visible = await service.get(job.id, "owner-a");
    expect(visible?.status).toBe("running");

    const cancelled = await service.cancel(job.id, "Owner cancelled.", "owner-a");
    expect(cancelled?.status).toBe("cancelled");
  });

  it("cancels every running job owned by an account before deletion", async () => {
    const service = new BackgroundChatJobService();
    const owned = await service.start({ ownerId: "owner-delete" }, async (runningJob) => waitForAbort(runningJob.abortController.signal));
    const other = await service.start({ ownerId: "owner-keep" }, async (runningJob) => waitForAbort(runningJob.abortController.signal));

    await service.cancelForOwner("owner-delete");

    expect((await service.get(owned.id, "owner-delete"))?.status).toBe("cancelled");
    expect((await service.get(other.id, "owner-keep"))?.status).toBe("running");
    await service.cancel(other.id, "Test cleanup.", "owner-keep");
  });

  it("records a failed job when dispatch cannot start", async () => {
    const service = new BackgroundChatJobService();

    await expect(service.start({})).rejects.toThrow("No background chat executor is configured.");
  });

  it("leaves a job active for a durable retry and completes it when that retry succeeds", async () => {
    const service = new BackgroundChatJobService();
    const executor = vi
      .fn<() => Promise<any>>()
      .mockRejectedValueOnce(new Error("OpenAI temporarily unavailable."))
      .mockResolvedValueOnce({ conversationId: "conv_retry" });
    service.setExecutor(async () => executor());
    const metadata = vi.spyOn(jobQueueService, "getJobMetadata")
      .mockResolvedValueOnce({ retryCount: 0, retryLimit: 3 } as any)
      .mockResolvedValueOnce({ retryCount: 1, retryLimit: 3 } as any);
    const payload = {
      appJobId: "chat_job_retry",
      request: { personaId: "larae", provider: "openai", message: "Hey", audio: false },
      createdAt: new Date().toISOString()
    } as any;

    await expect((service as any).executeQueuedJob(payload, "queue_job_retry", new AbortController().signal))
      .rejects.toThrow("OpenAI temporarily unavailable.");
    expect((await service.get(payload.appJobId))?.status).toBe("running");

    await expect((service as any).executeQueuedJob(payload, "queue_job_retry", new AbortController().signal))
      .resolves.toBeUndefined();
    expect((await service.get(payload.appJobId))?.status).toBe("completed");
    expect(executor).toHaveBeenCalledTimes(2);
    expect(metadata).toHaveBeenCalledTimes(2);
  });

  it("keeps usage reserved during retries and releases it after the terminal failure", async () => {
    const service = new BackgroundChatJobService();
    service.setExecutor(async () => { throw new Error("Provider unavailable."); });
    vi.spyOn(jobQueueService, "getJobMetadata")
      .mockResolvedValueOnce({ retryCount: 0, retryLimit: 3 } as any)
      .mockResolvedValueOnce({ retryCount: 3, retryLimit: 3 } as any);
    const recordUsage = vi.spyOn(usageControlService, "recordUsage").mockResolvedValue();
    const payload = {
      appJobId: "chat_job_reserved_retry",
      request: { personaId: "larae", provider: "openai", message: "Hey", audio: false },
      ownerId: "owner-retry",
      usageReservationId: "usage-reservation-retry",
      createdAt: new Date().toISOString()
    } as any;

    await expect((service as any).executeQueuedJob(payload, "queue_job_reserved_retry", new AbortController().signal))
      .rejects.toThrow("Provider unavailable.");
    expect(recordUsage).not.toHaveBeenCalled();

    await expect((service as any).executeQueuedJob(payload, "queue_job_reserved_retry", new AbortController().signal))
      .rejects.toThrow("Provider unavailable.");
    expect(recordUsage).toHaveBeenCalledWith("owner-retry", undefined, undefined, "usage-reservation-retry");
  });

  it("does not prune an active job merely because it has run for an hour", async () => {
    vi.useFakeTimers();
    const service = new BackgroundChatJobService();
    const job = await service.start({}, async (runningJob) => waitForAbort(runningJob.abortController.signal));
    await Promise.resolve();
    vi.advanceTimersByTime(61 * 60 * 1000);

    expect((await service.get(job.id))?.status).toBe("running");
    await service.cancel(job.id, "Test cleanup.");
  });
});
