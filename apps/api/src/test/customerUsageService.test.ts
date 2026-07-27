import { describe, expect, it } from "vitest";
import { CustomerUsageService } from "../services/customerUsageService.js";
import { getPlanDefinition, planIncludesPersona } from "../services/planCatalog.js";

describe("customer usage plans", () => {
  it("defaults unassigned users to Bronze and exposes the intended media allowances", async () => {
    const service = new CustomerUsageService();
    const summary = await service.summary("user_without_assignment");

    expect(summary.plan.id).toBe("bronze");
    expect(summary.plan.adsEnabled).toBe(true);
    expect(summary.meters).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: "image_outputs", limit: 3, used: 0, reserved: 0 }),
      expect.objectContaining({ key: "audio_seconds", limit: 300, used: 0, reserved: 0 })
    ]));
  });

  it("reserves, settles, and releases usage idempotently without a database", async () => {
    const service = new CustomerUsageService();
    const operationId = await service.reserve("user_metered", {
      image_outputs: 1,
      audio_seconds: 60
    }, { idempotencyKey: "request_metered" });
    expect(await service.reserve("user_metered", {
      image_outputs: 1
    }, { idempotencyKey: "request_metered" })).toBe(operationId);
    expect(await service.reserve("different_user", {
      image_outputs: 1
    }, { idempotencyKey: "request_metered" })).not.toBe(operationId);

    let summary = await service.summary("user_metered");
    expect(summary.meters.find((meter) => meter.key === "image_outputs")?.reserved).toBe(1);
    expect(summary.meters.find((meter) => meter.key === "audio_seconds")?.reserved).toBe(60);

    await service.settle(operationId, { image_outputs: 1, audio_seconds: 42 });
    summary = await service.summary("user_metered");
    expect(summary.meters.find((meter) => meter.key === "image_outputs")).toMatchObject({ used: 1, reserved: 0 });
    expect(summary.meters.find((meter) => meter.key === "audio_seconds")).toMatchObject({ used: 42, reserved: 0 });

    const releasedOperationId = await service.reserve("user_metered", {
      image_outputs: 1
    }, { idempotencyKey: "request_released" });
    await service.release(releasedOperationId);
    summary = await service.summary("user_metered");
    expect(summary.meters.find((meter) => meter.key === "image_outputs")).toMatchObject({ used: 1, reserved: 0 });
  });

  it("keeps persona entitlement rules in the versioned plan catalog", () => {
    expect(planIncludesPersona(getPlanDefinition("bronze"), "larae")).toBe(true);
    expect(planIncludesPersona(getPlanDefinition("bronze"), "future-gold-persona")).toBe(false);
    expect(getPlanDefinition("gold").maxConcurrentMediaJobs).toBeGreaterThan(
      getPlanDefinition("bronze").maxConcurrentMediaJobs
    );
  });
});
