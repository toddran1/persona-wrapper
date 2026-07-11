import type { NextFunction, Request, Response } from "express";
import { describe, expect, it, vi } from "vitest";
import { env } from "../config/env.js";
import { authRateLimit } from "../middleware/authRateLimit.js";
import { contentDisposition } from "../utils/httpHeaders.js";

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
        setHeader: vi.fn(),
        status: vi.fn().mockReturnThis(),
        json: vi.fn()
      } as unknown as Response;
      authRateLimit(request, response, next as unknown as NextFunction);
      if (index === env.AUTH_RATE_LIMIT_REQUESTS) {
        expect(response.status).toHaveBeenCalledWith(429);
        expect(response.json).toHaveBeenCalledWith({ error: "Too many authentication attempts. Please try again later." });
      }
    }

    expect(next).toHaveBeenCalledTimes(env.AUTH_RATE_LIMIT_REQUESTS);
  });
});
