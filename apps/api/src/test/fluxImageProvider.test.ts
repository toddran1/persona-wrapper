import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { env } from "../config/env.js";
import { FluxImageProvider } from "../providers/image/FluxImageProvider.js";
import { createImageProvider } from "../providers/image/providerFactory.js";

const originalApiKey = env.BFL_API_KEY;
const originalTimeout = env.BFL_IMAGE_REQUEST_TIMEOUT_MS;
const originalPollInterval = env.BFL_IMAGE_POLL_INTERVAL_MS;

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    arrayBuffer: async () => new TextEncoder().encode("png-bytes").buffer
  } as Response;
}

function successFetch(fetchImpl: ReturnType<typeof vi.fn>): void {
  fetchImpl
    .mockResolvedValueOnce(jsonResponse({
      id: "task_1",
      polling_url: "https://api.bfl.ai/v1/get_result?id=task_1",
      cost: 3,
      input_mp: 0,
      output_mp: 1
    }))
    .mockResolvedValueOnce(jsonResponse({ id: "task_1", status: "Pending" }))
    .mockResolvedValueOnce(jsonResponse({ id: "task_1", status: "Ready", result: { sample: "https://delivery.bfl.ai/sample.png" } }))
    .mockResolvedValueOnce(jsonResponse({}, 200));
}

beforeEach(() => {
  env.BFL_API_KEY = "bfl-test-key";
  env.BFL_IMAGE_REQUEST_TIMEOUT_MS = 300000;
  env.BFL_IMAGE_POLL_INTERVAL_MS = 1;
});

afterEach(() => {
  env.BFL_API_KEY = originalApiKey;
  env.BFL_IMAGE_REQUEST_TIMEOUT_MS = originalTimeout;
  env.BFL_IMAGE_POLL_INTERVAL_MS = originalPollInterval;
});

describe("FluxImageProvider", () => {
  it("generates a text-to-image via submit, poll, and download", async () => {
    const fetchImpl = vi.fn();
    successFetch(fetchImpl);

    const output = await new FluxImageProvider(fetchImpl as unknown as typeof fetch).generate({
      prompt: "A neon rooftop portrait",
      referenceImages: [],
      width: 1024,
      height: 1024
    });

    const [url, request] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.bfl.ai/v1/flux-2-pro");
    expect((request.headers as Record<string, string>)["x-key"]).toBe("bfl-test-key");
    const body = JSON.parse(String(request.body)) as Record<string, unknown>;
    expect(body.prompt).toBe("A neon rooftop portrait");
    expect(body.safety_tolerance).toBe(5);
    expect(body.disable_pup).toBe(true);
    expect(body.output_format).toBe("png");
    expect(body.input_image).toBeUndefined();

    expect(output.provider).toBe("flux");
    expect(output.images).toHaveLength(1);
    expect(output.images[0]?.dataBase64).toBe(Buffer.from("png-bytes").toString("base64"));
    expect(output.images[0]?.mimeType).toBe("image/png");
    expect(output.metadata).toMatchObject({ taskId: "task_1", edited: false, providerCostCredits: 3 });
  });

  it("sends reference images as input_image fields for edits", async () => {
    const fetchImpl = vi.fn();
    successFetch(fetchImpl);

    const output = await new FluxImageProvider(fetchImpl as unknown as typeof fetch).generate({
      prompt: "Put the outfit from image 1 on image 2",
      referenceImages: [
        { dataBase64: "aW1hZ2Ux", mimeType: "image/png" },
        { dataBase64: "aW1hZ2Uy", mimeType: "image/jpeg" }
      ],
      width: 1024,
      height: 1024
    });

    const [, request] = fetchImpl.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(String(request.body)) as Record<string, unknown>;
    expect(body.input_image).toBe("aW1hZ2Ux");
    expect(body.input_image_2).toBe("aW1hZ2Uy");
    expect(output.metadata.edited).toBe(true);
  });

  it("sends and records the seed when one is provided", async () => {
    const fetchImpl = vi.fn();
    successFetch(fetchImpl);

    const output = await new FluxImageProvider(fetchImpl as unknown as typeof fetch).generate({
      prompt: "seeded",
      referenceImages: [],
      width: 1024,
      height: 1024,
      seed: 42
    });

    const [, request] = fetchImpl.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(String(request.body)) as Record<string, unknown>;
    expect(body.seed).toBe(42);
    expect(output.metadata.seed).toBe(42);
  });

  it("leaves the seed unset when none is provided", async () => {
    const fetchImpl = vi.fn();
    successFetch(fetchImpl);

    const output = await new FluxImageProvider(fetchImpl as unknown as typeof fetch).generate({
      prompt: "unseeded",
      referenceImages: [],
      width: 1024,
      height: 1024
    });

    const [, request] = fetchImpl.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(String(request.body)) as Record<string, unknown>;
    expect(body.seed).toBeUndefined();
    expect(output.metadata.seed).toBeUndefined();
  });

  it("tolerates transient poll failures before succeeding", async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ id: "task_1", polling_url: "https://api.bfl.ai/v1/get_result?id=task_1" }))
      .mockResolvedValueOnce(jsonResponse({ error: "upstream" }, 500))
      .mockResolvedValueOnce(jsonResponse({ id: "task_1", status: "Pending" }))
      .mockResolvedValueOnce(jsonResponse({ id: "task_1", status: "Ready", result: { sample: "https://delivery.bfl.ai/sample.png" } }))
      .mockResolvedValueOnce(jsonResponse({}, 200));

    const output = await new FluxImageProvider(fetchImpl as unknown as typeof fetch).generate({
      prompt: "flaky polls",
      referenceImages: [],
      width: 1024,
      height: 1024
    });

    expect(output.images).toHaveLength(1);
  });

  it("fails after repeated poll failures", async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ id: "task_1", polling_url: "https://api.bfl.ai/v1/get_result?id=task_1" }))
      .mockResolvedValue(jsonResponse({ error: "upstream" }, 500));

    await expect(new FluxImageProvider(fetchImpl as unknown as typeof fetch).generate({
      prompt: "downstream outage",
      referenceImages: [],
      width: 1024,
      height: 1024
    })).rejects.toMatchObject({ statusCode: 502 });
  });

  it("maps moderation outcomes to a public-safe error", async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ id: "task_1", polling_url: "https://api.bfl.ai/v1/get_result?id=task_1" }))
      .mockResolvedValueOnce(jsonResponse({
        id: "task_1",
        status: "Content Moderated",
        details: { "Moderation Reasons": ["Sexual Content"] }
      }));

    const failure = await new FluxImageProvider(fetchImpl as unknown as typeof fetch).generate({
      prompt: "flagged prompt",
      referenceImages: [],
      width: 1024,
      height: 1024
    }).catch((error: unknown) => error);

    expect(failure).toMatchObject({ statusCode: 422 });
    expect((failure as Error).message).not.toContain("Sexual Content");
  });

  it("fails cleanly when the server is not configured for FLUX", async () => {
    env.BFL_API_KEY = undefined;

    await expect(new FluxImageProvider(vi.fn() as unknown as typeof fetch).generate({
      prompt: "anything",
      referenceImages: [],
      width: 1024,
      height: 1024
    })).rejects.toMatchObject({ statusCode: 503 });
  });

  it("retries rate-limited submissions before succeeding", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(jsonResponse({ error: "slow down" }, 429));
    successFetch(fetchImpl);

    const output = await new FluxImageProvider(fetchImpl as unknown as typeof fetch).generate({
      prompt: "retry me",
      referenceImages: [],
      width: 1024,
      height: 1024
    });

    expect(output.images).toHaveLength(1);
  });

  it("times out polling with a public-safe 504", async () => {
    env.BFL_IMAGE_REQUEST_TIMEOUT_MS = 5;
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ id: "task_1", polling_url: "https://api.bfl.ai/v1/get_result?id=task_1" }))
      .mockResolvedValue(jsonResponse({ id: "task_1", status: "Pending" }));

    await expect(new FluxImageProvider(fetchImpl as unknown as typeof fetch).generate({
      prompt: "slow image",
      referenceImages: [],
      width: 1024,
      height: 1024
    })).rejects.toMatchObject({ statusCode: 504 });
  });

  it("rejects malformed submission responses as a 502", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(jsonResponse({ unexpected: true }));

    await expect(new FluxImageProvider(fetchImpl as unknown as typeof fetch).generate({
      prompt: "broken",
      referenceImages: [],
      width: 1024,
      height: 1024
    })).rejects.toMatchObject({ statusCode: 502 });
  });
});

describe("image providerFactory", () => {
  it("builds the FLUX provider and keeps OpenAI on its native path", () => {
    expect(createImageProvider("flux").providerId).toBe("flux");
    expect(() => createImageProvider("openai")).toThrow(/natively/);
  });
});
