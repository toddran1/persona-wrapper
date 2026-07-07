import { describe, expect, it } from "vitest";
import { UsageControlService } from "../services/usageControlService.js";

describe("UsageControlService", () => {
  it("rate limits repeated requests from the same identity", async () => {
    const service = new UsageControlService();
    for (let index = 0; index < 30; index += 1) await service.check("rate-test");
    await expect(service.check("rate-test")).rejects.toThrow("Too many requests");
  });
});
