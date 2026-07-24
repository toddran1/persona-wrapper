import { describe, expect, it } from "vitest";
import { hasDatabaseErrorCode } from "../utils/databaseError.js";

describe("hasDatabaseErrorCode", () => {
  it("recognizes direct and wrapped database errors", () => {
    expect(hasDatabaseErrorCode({ code: "23505" }, "23505")).toBe(true);
    expect(hasDatabaseErrorCode(new Error("query failed", { cause: { code: "23505" } }), "23505")).toBe(true);
  });

  it("stops safely for unrelated and cyclic causes", () => {
    const cyclic: { cause?: unknown } = {};
    cyclic.cause = cyclic;

    expect(hasDatabaseErrorCode({ code: "23503" }, "23505")).toBe(false);
    expect(hasDatabaseErrorCode(cyclic, "23505")).toBe(false);
  });
});
