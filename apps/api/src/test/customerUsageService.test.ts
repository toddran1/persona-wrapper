import { describe, expect, it } from "vitest";
import { CustomerUsageService } from "../services/customerUsageService.js";
import { getPlanDefinition, planIncludesPersona } from "../services/planCatalog.js";

describe("customer usage plans", () => {
  it("defaults unassigned users to Bronze and exposes the intended media allowances", async () => {
    const service = new CustomerUsageService();
    const summary = await service.summary("user_without_assignment");

    expect(summary.plan.id).toBe("bronze");
    expect(summary.plan.adsEnabled).toBe(true);
    expect(summary.totalUsage).toMatchObject({
      limitMicroUsd: 1_000_000,
      usedMicroUsd: 0,
      reservedMicroUsd: 0,
      remainingMicroUsd: 1_000_000,
      percentRemaining: 100
    });
    expect(summary.meters).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: "credits", label: "Image credits", limit: 12, used: 0, reserved: 0 }),
      expect.objectContaining({ key: "audio_seconds", limit: 300, used: 0, reserved: 0 })
    ]));
  });

  it("reserves, settles, and releases usage idempotently without a database", async () => {
    const service = new CustomerUsageService();
    const operationId = await service.reserve("user_metered", {
      total_usage_microusd: 180_000,
      credits: 2,
      image_outputs: 1,
      audio_seconds: 60
    }, { idempotencyKey: "request_metered" });
    expect(await service.reserve("user_metered", {
      total_usage_microusd: 180_000,
      credits: 2,
      image_outputs: 1
    }, { idempotencyKey: "request_metered" })).toBe(operationId);
    expect(await service.reserve("different_user", {
      total_usage_microusd: 180_000,
      credits: 2,
      image_outputs: 1
    }, { idempotencyKey: "request_metered" })).not.toBe(operationId);

    let summary = await service.summary("user_metered");
    expect(summary.totalUsage).toMatchObject({
      usedMicroUsd: 0,
      reservedMicroUsd: 180_000,
      remainingMicroUsd: 820_000,
      percentRemaining: 82
    });
    expect(summary.meters.find((meter) => meter.key === "credits")?.reserved).toBe(2);
    expect(summary.meters.find((meter) => meter.key === "audio_seconds")?.reserved).toBe(60);

    await service.settle(operationId, {
      total_usage_microusd: 125_000,
      credits: 2,
      image_outputs: 1,
      audio_seconds: 42
    });
    summary = await service.summary("user_metered");
    expect(summary.totalUsage).toMatchObject({
      usedMicroUsd: 125_000,
      reservedMicroUsd: 0,
      remainingMicroUsd: 875_000,
      percentRemaining: 87
    });
    expect(summary.meters.find((meter) => meter.key === "credits")).toMatchObject({ used: 2, reserved: 0 });
    expect(summary.meters.find((meter) => meter.key === "audio_seconds")).toMatchObject({ used: 42, reserved: 0 });

    const releasedOperationId = await service.reserve("user_metered", {
      total_usage_microusd: 40_000,
      credits: 2,
      image_outputs: 1
    }, { idempotencyKey: "request_released" });
    await service.release(releasedOperationId);
    summary = await service.summary("user_metered");
    expect(summary.totalUsage).toMatchObject({ usedMicroUsd: 125_000, reservedMicroUsd: 0 });
    expect(summary.meters.find((meter) => meter.key === "credits")).toMatchObject({ used: 2, reserved: 0 });
  });

  it("keeps persona entitlement rules in the versioned plan catalog", () => {
    expect(planIncludesPersona(getPlanDefinition("bronze"), "larae")).toBe(true);
    expect(planIncludesPersona(getPlanDefinition("bronze"), "future-gold-persona")).toBe(false);
    expect(getPlanDefinition("gold").maxConcurrentMediaJobs).toBeGreaterThan(
      getPlanDefinition("bronze").maxConcurrentMediaJobs
    );
    expect(getPlanDefinition("bronze").monthlyProviderCostBudget).toEqual({
      targetMicroUsd: 500_000,
      ceilingMicroUsd: 1_000_000
    });
    expect(getPlanDefinition("silver").monthlyPriceCents).toBe(599);
    expect(getPlanDefinition("gold").monthlyPriceCents).toBe(999);
  });
});
