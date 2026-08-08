import type { NextFunction, Request, Response } from "express";
import { describe, expect, it, vi } from "vitest";
import { env } from "../config/env.js";
import { authRateLimit, signupAbuseRateLimit } from "../middleware/authRateLimit.js";
import { authCookieAttributes } from "../utils/authCookieConfig.js";
import { contentDisposition } from "../utils/httpHeaders.js";
import { requestAbuseSignals } from "../utils/requestAbuseSignals.js";
import { optionalRequestOwnerId } from "../utils/requestIdentity.js";

describe("security hardening", () => {
  it("removes path and control characters from download filenames", () => {
    expect(contentDisposition("attachment", "../unsafe\r\nname\".txt"))
      .toBe('attachment; filename="unsafe__name_.txt"');
  });

  it("throttles repeated authentication attempts", () => {
    const next = vi.fn();
    const request = {
      ip: "203.0.113.42",
      path: `/login-${crypto.randomUUID()}`,
      socket: {}
    } as Request;

    for (let index = 0; index <= env.AUTH_RATE_LIMIT_REQUESTS; index += 1) {
      const response = {
        locals: { requestId: "request-rate-limit" },
        setHeader: vi.fn(),
        status: vi.fn().mockReturnThis(),
        json: vi.fn()
      } as unknown as Response;
      authRateLimit(request, response, next as unknown as NextFunction);
      if (index === env.AUTH_RATE_LIMIT_REQUESTS) {
        expect(response.status).toHaveBeenCalledWith(429);
        expect(response.json).toHaveBeenCalledWith({
          error: "Too many authentication attempts. Please try again later.",
          message: "Too many authentication attempts. Please try again later.",
          code: "RATE_LIMITED",
          requestId: "request-rate-limit"
        });
      }
    }

    expect(next).toHaveBeenCalledTimes(env.AUTH_RATE_LIMIT_REQUESTS);
  });

  it("uses cross-site compatible cookies in production", () => {
    expect(authCookieAttributes("production")).toEqual({ sameSite: "none", secure: true });
    expect(authCookieAttributes("development")).toEqual({ sameSite: "lax", secure: false });
  });

  it("does not accept the legacy owner header when authentication is required", () => {
    const originalAuthRequired = env.AUTH_REQUIRED;
    env.AUTH_REQUIRED = true;
    const request = {
      auth: undefined,
      header: vi.fn().mockReturnValue("known-user-id")
    } as unknown as Request;

    try {
      expect(() => optionalRequestOwnerId(request)).toThrow("Authentication required.");
      expect(request.header).not.toHaveBeenCalled();
    } finally {
      env.AUTH_REQUIRED = originalAuthRequired;
    }
  });

  it("hashes device and IP abuse signals before using them as counter keys", () => {
    const request = {
      ip: "203.0.113.99",
      socket: {},
      header: (name: string) => name === "x-device-id" ? "device-installation-123" : undefined
    } as unknown as Request;

    const signals = requestAbuseSignals(request);
    expect(signals.deviceKey).toMatch(/^device:[a-f0-9]{64}$/);
    expect(signals.ipKey).toMatch(/^ip:[a-f0-9]{64}$/);
    expect(signals.deviceKey).not.toContain("device-installation-123");
    expect(signals.ipKey).not.toContain("203.0.113.99");
  });

  it("limits free-account rotation by pseudonymous device signal", () => {
    const originalDeviceLimit = env.AUTH_SIGNUP_DEVICE_LIMIT;
    const originalIpLimit = env.AUTH_SIGNUP_IP_LIMIT;
    env.AUTH_SIGNUP_DEVICE_LIMIT = 2;
    env.AUTH_SIGNUP_IP_LIMIT = 20;
    const next = vi.fn();
    const deviceId = `signup-device-${crypto.randomUUID()}`;
    const request = {
      ip: `203.0.113.${Math.floor(Math.random() * 100) + 100}`,
      socket: {},
      header: (name: string) => name === "x-device-id" ? deviceId : undefined
    } as unknown as Request;

    try {
      for (let index = 0; index < 3; index += 1) {
        const response = {
          locals: { requestId: "request-signup-limit" },
          setHeader: vi.fn(),
          status: vi.fn().mockReturnThis(),
          json: vi.fn()
        } as unknown as Response;
        signupAbuseRateLimit(request, response, next as unknown as NextFunction);
        if (index === 2) {
          expect(response.status).toHaveBeenCalledWith(429);
          expect(response.json).toHaveBeenCalledWith({
            error: "Too many accounts were created or attempted from this device or network. Please try again later.",
            message: "Too many accounts were created or attempted from this device or network. Please try again later.",
            code: "RATE_LIMITED",
            requestId: "request-signup-limit"
          });
        }
      }
      expect(next).toHaveBeenCalledTimes(2);
    } finally {
      env.AUTH_SIGNUP_DEVICE_LIMIT = originalDeviceLimit;
      env.AUTH_SIGNUP_IP_LIMIT = originalIpLimit;
    }
  });
});
