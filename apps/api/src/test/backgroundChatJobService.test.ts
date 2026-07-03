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
});
