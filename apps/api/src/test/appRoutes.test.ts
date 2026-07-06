import type { Request, Response } from "express";
import { describe, expect, it } from "vitest";
import { requireTestMode } from "../routes/chat.routes.js";
import { HttpError } from "../utils/httpError.js";

describe("app routes", () => {
  it("keeps style-transfer review endpoints unavailable outside test mode", () => {
    let capturedError: unknown;

    requireTestMode(
      { path: "/style-transfer-review" } as Request,
      {} as Response,
      (error?: unknown) => {
        capturedError = error;
      }
    );

    expect(capturedError).toBeInstanceOf(HttpError);
    expect((capturedError as HttpError).statusCode).toBe(404);
    expect((capturedError as HttpError).message).toContain("only available in test mode");
  });
});
