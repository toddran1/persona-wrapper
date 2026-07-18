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
});
