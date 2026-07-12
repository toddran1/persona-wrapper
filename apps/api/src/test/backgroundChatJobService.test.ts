import { describe, expect, it } from "vitest";
import { BackgroundChatJobService } from "../services/backgroundChatJobService.js";

function waitForAbort(signal: AbortSignal): Promise<never> {
  return new Promise((_, reject) => {
    signal.addEventListener("abort", () => {
      reject(signal.reason instanceof Error ? signal.reason : new Error("Aborted"));
    }, { once: true });
  });
}

describe("BackgroundChatJobService", () => {
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
});
