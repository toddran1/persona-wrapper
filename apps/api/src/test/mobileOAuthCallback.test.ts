import type { Request, Response } from "express";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getOAuthCallback } from "../controllers/auth.controller.js";
import { authService } from "../services/authService.js";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("mobile OAuth callback", () => {
  it("returns a native handoff document after an Android callback completes", async () => {
    vi.spyOn(authService, "completeOAuthCallback").mockResolvedValue({
      user: {
        id: "user_mobile",
        status: "active",
        displayName: "Mobile user",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      },
      session: {
        id: "session_mobile",
        userId: "user_mobile",
        clientType: "android",
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
        refreshExpiresAt: new Date(Date.now() + 120_000).toISOString(),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      },
      tokens: {
        accessToken: "access-token",
        refreshToken: "refresh-token",
        tokenType: "Bearer",
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
        refreshExpiresAt: new Date(Date.now() + 120_000).toISOString()
      },
      oauthReturnUrl: "personawrapper://auth/callback"
    });
    vi.spyOn(authService, "createOAuthExchangeCode").mockResolvedValue("exchange-code");

    const state = {
      body: "",
      contentType: "",
      headers: {} as Record<string, string>,
      statusCode: 0
    };
    const response = {
      headersSent: false,
      status(code: number) {
        state.statusCode = code;
        return response;
      },
      set(headers: Record<string, string>) {
        state.headers = headers;
        return response;
      },
      type(contentType: string) {
        state.contentType = contentType;
        return response;
      },
      send(body: string) {
        state.body = body;
        return response;
      },
      redirect: vi.fn()
    } as unknown as Response;

    await getOAuthCallback({
      params: { provider: "facebook" },
      query: { code: "provider-code", state: "oauth-state" },
      header: () => undefined,
      ip: "203.0.113.10"
    } as unknown as Request, response);

    expect(state.statusCode).toBe(200);
    expect(state.contentType).toBe("html");
    expect(state.headers["Cache-Control"]).toContain("no-store");
    expect(state.body).toContain("intent://auth/callback?code=exchange-code&amp;provider=facebook#Intent;scheme=personawrapper;package=com.personawrapper.mobile;end");
    expect(state.body).toContain('window.location.replace("intent://auth/callback?code=exchange-code&provider=facebook#Intent;scheme=personawrapper;package=com.personawrapper.mobile;end")');
    expect(response.redirect).not.toHaveBeenCalled();
  });
});
