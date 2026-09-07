import { describe, expect, it } from "vitest";
import { isPlanAdSupported } from "@persona/shared";

describe("isPlanAdSupported", () => {
  it("allows ads only for Bronze", () => {
    expect(isPlanAdSupported("bronze")).toBe(true);
    expect(isPlanAdSupported("silver")).toBe(false);
    expect(isPlanAdSupported("gold")).toBe(false);
  });
});
