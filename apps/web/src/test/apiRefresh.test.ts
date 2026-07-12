import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, setAuthTokens } from "../lib/api.js";

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
    localStorage.clear();
  });

  it("refreshes an expired access token and retries the original request", async () => {
    setAuthTokens({
      accessToken: "expired-access",
      refreshToken: "valid-refresh",
      tokenType: "Bearer",
      expiresAt: "2026-07-12T00:00:00.000Z",
      refreshExpiresAt: "2026-08-12T00:00:00.000Z"
    });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ error: "Authentication token is invalid or expired." }, 401))
      .mockResolvedValueOnce(jsonResponse({
        user: { id: "user_1" },
        session: { id: "session_1" },
        tokens: {
          accessToken: "fresh-access",
          refreshToken: "fresh-refresh",
          tokenType: "Bearer",
          expiresAt: "2026-07-12T01:00:00.000Z",
          refreshExpiresAt: "2026-08-12T00:00:00.000Z"
        }
      }))
      .mockResolvedValueOnce(jsonResponse({ conversations: [] }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(api.listConversations()).resolves.toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls[1]?.[0]).toBe("http://localhost:4000/api/auth/refresh");
    expect(new Headers(fetchMock.mock.calls[2]?.[1]?.headers).get("Authorization")).toBe("Bearer fresh-access");
  });

  it("preserves the API's authentication message when no refresh token exists", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      jsonResponse({ error: "Authentication required." }, 401)
    ));

    await expect(api.exportAccountData()).rejects.toThrow("Authentication required.");
  });
});
