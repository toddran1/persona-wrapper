import { describe, expect, it } from "vitest";
import { UsageControlService } from "../services/usageControlService.js";

describe("UsageControlService", () => {
  it("rate limits repeated requests from the same identity", () => {
    const service = new UsageControlService();
    for (let index = 0; index < 30; index += 1) service.check("rate-test");
    expect(() => service.check("rate-test")).toThrow("Too many requests");
  });
});
