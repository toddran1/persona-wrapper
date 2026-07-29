import { describe, expect, it } from "vitest";
import { env } from "../config/env.js";
import { UsageControlService } from "../services/usageControlService.js";

describe("UsageControlService", () => {
  it("rate limits repeated requests from the same identity", async () => {
    const service = new UsageControlService();
    for (let index = 0; index < 30; index += 1) await service.check("rate-test");
    await expect(service.check("rate-test")).rejects.toThrow("Too many requests");
  });

  it("prevents account rotation from bypassing the device request limit", async () => {
    const originalLimit = env.CHAT_DEVICE_RATE_LIMIT_REQUESTS;
    env.CHAT_DEVICE_RATE_LIMIT_REQUESTS = 2;
    const service = new UsageControlService();
    try {
      await service.check("account-one", { deviceKey: "device:shared" });
      await service.check("account-two", { deviceKey: "device:shared" });
      await expect(service.check("account-three", { deviceKey: "device:shared" }))
        .rejects.toThrow("Too many requests");
    } finally {
      env.CHAT_DEVICE_RATE_LIMIT_REQUESTS = originalLimit;
    }
  });

  it("limits aggregate traffic across accounts sharing an IP signal", async () => {
    const originalLimit = env.CHAT_IP_RATE_LIMIT_REQUESTS;
    env.CHAT_IP_RATE_LIMIT_REQUESTS = 2;
    const service = new UsageControlService();
    try {
      await service.check("ip-account-one", { ipKey: "ip:shared" });
      await service.check("ip-account-two", { ipKey: "ip:shared" });
      await expect(service.check("ip-account-three", { ipKey: "ip:shared" }))
        .rejects.toThrow("Too many requests");
    } finally {
      env.CHAT_IP_RATE_LIMIT_REQUESTS = originalLimit;
    }
  });
});
