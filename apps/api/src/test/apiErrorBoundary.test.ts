import type { NextFunction, Request, Response } from "express";
import { describe, expect, it, vi } from "vitest";
import { apiErrorHandler, notFoundHandler } from "../app.js";

function mockResponse(requestId = "request-test") {
  const state: { status?: number; body?: unknown } = {};
  const response = {
    locals: { requestId },
    headersSent: false,
    status: vi.fn((status: number) => {
      state.status = status;
      return response;
    }),
    json: vi.fn((body: unknown) => {
      state.body = body;
      return response;
    })
  } as unknown as Response;
  return { response, state };
}

describe("API error boundary", () => {
  it("returns a structured 404 with a request id", () => {
    const { response, state } = mockResponse();
    notFoundHandler({} as Request, response);

    expect(state.status).toBe(404);
    expect(state.body).toEqual({ error: "Route not found.", code: "NOT_FOUND", requestId: "request-test" });
  });

  it("normalizes malformed JSON errors", () => {
    const { response, state } = mockResponse();
    const malformedJsonError = Object.assign(new SyntaxError("Unexpected token"), { status: 400 });
    apiErrorHandler(
      malformedJsonError,
      { method: "POST", path: "/api/auth/login" } as Request,
      response,
      vi.fn() as unknown as NextFunction
    );

    expect(state.status).toBe(400);
    expect(state.body).toEqual({ error: "Malformed request body.", code: "BAD_REQUEST", requestId: "request-test" });
  });

  it("delegates errors after response headers have been sent", () => {
    const { response } = mockResponse();
    Object.defineProperty(response, "headersSent", { value: true });
    const next = vi.fn();
    const error = new Error("stream failed");
    apiErrorHandler(error, {} as Request, response, next as unknown as NextFunction);
    expect(next).toHaveBeenCalledWith(error);
  });
});
