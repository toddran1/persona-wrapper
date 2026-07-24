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

  it("omits app credentials for S3 uploads and falls back through the API after an S3 rejection", async () => {
    const fallbackAsset = {
      id: "asset_fallback",
      kind: "image",
      fileName: "test.png",
      mimeType: "image/png",
      sizeBytes: 3,
      url: "/api/uploads/asset_fallback"
    };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({
        assetId: "asset_test",
        uploadUrl: "https://bucket.example.com/uploads/asset_test.png",
        headers: { "Content-Type": "image/png" },
        expiresAt: new Date(Date.now() + 60_000).toISOString()
      }, 201))
      .mockResolvedValueOnce(new Response(null, { status: 500 }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(jsonResponse({ assets: [fallbackAsset] }, 201));
    vi.stubGlobal("fetch", fetchMock);

    const file = new File([new Uint8Array([1, 2, 3])], "test.png", { type: "image/png" });
    await expect(api.uploadFiles([file])).resolves.toEqual([fallbackAsset]);

    expect(fetchMock.mock.calls[1]?.[0]).toBe("https://bucket.example.com/uploads/asset_test.png");
    expect(fetchMock.mock.calls[1]?.[1]?.credentials).toBe("omit");
    expect(String(fetchMock.mock.calls[2]?.[0])).toContain("/api/uploads/asset_test");
    expect(fetchMock.mock.calls[2]?.[1]?.method).toBe("DELETE");
    expect(String(fetchMock.mock.calls[3]?.[0])).toContain("/api/uploads");
    expect(fetchMock.mock.calls[3]?.[1]?.method).toBe("POST");
  });

  it("sends fallback multipart uploads one file per request", async () => {
    const firstAsset = {
      id: "asset_first",
      kind: "image",
      fileName: "first.png",
      mimeType: "image/png",
      sizeBytes: 1,
      url: "/api/uploads/asset_first"
    };
    const secondAsset = { ...firstAsset, id: "asset_second", fileName: "second.png", url: "/api/uploads/asset_second" };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ error: "Direct upload unavailable." }, 409))
      .mockResolvedValueOnce(jsonResponse({ assets: [firstAsset] }, 201))
      .mockResolvedValueOnce(jsonResponse({ assets: [secondAsset] }, 201));
    vi.stubGlobal("fetch", fetchMock);

    const files = [
      new File(["1"], "first.png", { type: "image/png" }),
      new File(["2"], "second.png", { type: "image/png" })
    ];
    await expect(api.uploadFiles(files)).resolves.toEqual([firstAsset, secondAsset]);

    const firstBody = fetchMock.mock.calls[1]?.[1]?.body as FormData;
    const secondBody = fetchMock.mock.calls[2]?.[1]?.body as FormData;
    expect(firstBody.getAll("files")).toHaveLength(1);
    expect(secondBody.getAll("files")).toHaveLength(1);
  });

  it("rejects too many attachments before starting network uploads", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const files = Array.from({ length: 11 }, (_, index) =>
      new File([String(index)], `file-${index}.txt`, { type: "text/plain" })
    );

    await expect(api.uploadFiles(files)).rejects.toThrow("up to 10 files");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does not expose raw database errors returned by contract endpoints", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      jsonResponse({ error: 'Failed query: select * from "users"' }, 500)
    ));

    await expect(api.getPersonas()).rejects.toThrow("Could not load personas.");
  });
});
