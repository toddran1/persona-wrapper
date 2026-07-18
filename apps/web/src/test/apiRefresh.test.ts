import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../lib/api.js";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}

describe("web API authentication refresh", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
    localStorage.clear();
  });

  it("uses the Better Auth cookie session for API requests", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse({ conversations: [] }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(api.listConversations()).resolves.toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[1]?.credentials).toBe("include");
    expect(new Headers(fetchMock.mock.calls[0]?.[1]?.headers).has("Authorization")).toBe(false);
  });

  it("preserves the API's authentication message when no refresh token exists", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      jsonResponse({ error: "Authentication required." }, 401)
    ));

    await expect(api.exportAccountData()).rejects.toThrow("Authentication required.");
  });

  it("times out stalled API requests instead of leaving the UI pending", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn((_url: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
    })));

    const request = api.getPersonas();
    const assertion = expect(request).rejects.toThrow("The app server took too long to respond. Please try again.");
    await vi.advanceTimersByTimeAsync(130_000);

    await assertion;
  });

  it("preserves caller cancellation for chat requests", async () => {
    const controller = new AbortController();
    vi.stubGlobal("fetch", vi.fn((_url: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
    })));

    const request = api.sendChat({
      personaId: "larae",
      message: "hello",
      provider: "openai_persona",
      audio: false
    }, controller.signal);
    controller.abort();

    await expect(request).rejects.toMatchObject({ name: "AbortError" });
  });

  it("preserves actionable chat limit errors from the API", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      jsonResponse({ error: "Daily chat limit reached. Try again tomorrow." }, 429)
    ));

    await expect(api.sendChat({
      personaId: "larae",
      message: "hello",
      provider: "openai_persona",
      audio: false
    })).rejects.toThrow("Daily chat limit reached. Try again tomorrow.");
  });

  it("omits app credentials for S3 uploads and rolls back failed batches", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({
        assetId: "asset_test",
        uploadUrl: "https://bucket.example.com/uploads/asset_test.png",
        headers: { "Content-Type": "image/png" },
        expiresAt: new Date(Date.now() + 60_000).toISOString()
      }, 201))
      .mockResolvedValueOnce(new Response(null, { status: 500 }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);

    const file = new File([new Uint8Array([1, 2, 3])], "test.png", { type: "image/png" });
    await expect(api.uploadFiles([file])).rejects.toThrow("storage service rejected");

    expect(fetchMock.mock.calls[1]?.[0]).toBe("https://bucket.example.com/uploads/asset_test.png");
    expect(fetchMock.mock.calls[1]?.[1]?.credentials).toBe("omit");
    expect(String(fetchMock.mock.calls[2]?.[0])).toContain("/api/uploads/asset_test");
    expect(fetchMock.mock.calls[2]?.[1]?.method).toBe("DELETE");
  });
});
