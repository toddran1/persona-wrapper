import { describe, expect, it } from "vitest";
import { errorMessageForLog, isRoutineClientDisconnect } from "../utils/errorReporting.js";

describe("error reporting", () => {
  it("does not place SQL parameters or user content into operational logs", () => {
    const error = Object.assign(new Error(
      'Failed query: insert into "generated_audio" values ($1)\nparams: private narration text'
    ), { code: "23503" });

    expect(errorMessageForLog(error)).toBe("Database operation failed (23503).");
  });

  it("redacts common credentials and bounds unexpected provider messages", () => {
    expect(errorMessageForLog(new Error("Authorization: Bearer secret.token-value")))
      .toBe("Authorization: Bearer [REDACTED]");
    expect(errorMessageForLog(new Error("x".repeat(2_000)))).toHaveLength(1_000);
  });

  it("recognizes routine client disconnects without hiding malformed HTTP errors", () => {
    expect(isRoutineClientDisconnect(Object.assign(new Error("read ECONNRESET"), { code: "ECONNRESET" }))).toBe(true);
    expect(isRoutineClientDisconnect(new Error("Parse Error: Invalid header value char"))).toBe(false);
  });
});
