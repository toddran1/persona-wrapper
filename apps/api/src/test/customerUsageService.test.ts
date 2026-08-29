import { describe, expect, it, vi } from "vitest";
import { calculateRolloverQuantity, CustomerUsageService } from "../services/customerUsageService.js";
import { getPlanDefinition, planIncludesPersona } from "../services/planCatalog.js";

describe("customer usage plans", () => {
  it("defaults unassigned users to Bronze and exposes the intended media allowances", async () => {
    const service = new CustomerUsageService();
    const summary = await service.summary("user_without_assignment");

    expect(summary.plan.id).toBe("bronze");
    expect(summary.plan.adsEnabled).toBe(true);
    expect(summary.totalUsage).toMatchObject({
      limitMicroUsd: 3_000_000,
      baseLimitMicroUsd: 3_000_000,
      rolloverMicroUsd: 0,
      usedMicroUsd: 0,
      reservedMicroUsd: 0,
      remainingMicroUsd: 3_000_000,
      percentRemaining: 100
    });
    expect(summary.meters).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: "credits", label: "Image credits", limit: 24, baseLimit: 24, rollover: 0, used: 0, reserved: 0 }),
      expect.objectContaining({ key: "audio_seconds", limit: 1_200, baseLimit: 1_200, rollover: 0, used: 0, reserved: 0 })
    ]));
  });

  it("rolls only unused base allowance forward for one cycle", () => {
    expect(calculateRolloverQuantity({
      currentBaseLimit: 90,
      previousBaseLimit: 90,
      previousRollover: 20,
      previousUsed: 50,
      previousReserved: 0
    })).toBe(60);
    expect(calculateRolloverQuantity({
      currentBaseLimit: 90,
      previousBaseLimit: 90,
      previousRollover: 90,
      previousUsed: 0,
      previousReserved: 0
    })).toBe(90);
    expect(calculateRolloverQuantity({
      currentBaseLimit: 90,
      previousBaseLimit: 90,
      previousRollover: 900,
      previousUsed: 90,
      previousReserved: 0
    })).toBe(90);
    expect(calculateRolloverQuantity({
      currentBaseLimit: 90,
      previousBaseLimit: 180,
      previousRollover: 0,
      previousUsed: 0,
      previousReserved: 0
    })).toBe(90);
    expect(calculateRolloverQuantity({
      currentBaseLimit: 90,
      previousBaseLimit: 90,
      previousRollover: 10,
      previousUsed: 100,
      previousReserved: 10
    })).toBe(0);
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
      remainingMicroUsd: 2_820_000,
      percentRemaining: 94
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
      remainingMicroUsd: 2_875_000,
      percentRemaining: 95
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

  it("retries a failed settlement on the next drain instead of losing the usage", async () => {
    const service = new CustomerUsageService();
    const operationId = await service.reserve("user_settle_retry", {
      total_usage_microusd: 50_000
    }, { idempotencyKey: "request_settle_retry" });
    const settle = vi.spyOn(service, "settle").mockRejectedValueOnce(new Error("database unavailable"));

    await expect(service.settleWithRetry(operationId, { total_usage_microusd: 40_000 })).rejects.toThrow("database unavailable");
    let summary = await service.summary("user_settle_retry");
    expect(summary.totalUsage).toMatchObject({ usedMicroUsd: 0, reservedMicroUsd: 50_000 });

    // Inside the backoff window the drain leaves the settlement queued.
    await service.drainPendingSettlements();
    summary = await service.summary("user_settle_retry");
    expect(summary.totalUsage).toMatchObject({ usedMicroUsd: 0, reservedMicroUsd: 50_000 });

    // After the backoff window the drain settles the delivered response.
    await service.drainPendingSettlements(new Date(Date.now() + 10 * 60 * 1000));
    summary = await service.summary("user_settle_retry");
    expect(summary.totalUsage).toMatchObject({ usedMicroUsd: 40_000, reservedMicroUsd: 0 });
    expect(settle).toHaveBeenCalledTimes(2);
    settle.mockRestore();
  });

  it("stops retrying a settlement after repeated failures", async () => {
    const service = new CustomerUsageService();
    const operationId = await service.reserve("user_settle_giveup", {
      total_usage_microusd: 50_000
    }, { idempotencyKey: "request_settle_giveup" });
    const settle = vi.spyOn(service, "settle").mockRejectedValue(new Error("database unavailable"));

    await expect(service.settleWithRetry(operationId, { total_usage_microusd: 40_000 })).rejects.toThrow("database unavailable");
    for (let attempt = 1; attempt <= 12; attempt += 1) {
      await service.drainPendingSettlements(new Date(Date.now() + attempt * 60 * 60 * 1000));
    }
    settle.mockClear();
    await service.drainPendingSettlements(new Date(Date.now() + 24 * 60 * 60 * 1000));
    expect(settle).not.toHaveBeenCalled();
    settle.mockRestore();
  });

  it("keeps persona entitlement rules in the versioned plan catalog", () => {
    expect(getPlanDefinition("bronze").version).toBe(1);
    expect(getPlanDefinition("silver").version).toBe(1);
    expect(getPlanDefinition("gold").version).toBe(1);
    expect(planIncludesPersona(getPlanDefinition("bronze"), "larae")).toBe(true);
    expect(planIncludesPersona(getPlanDefinition("bronze"), "future-gold-persona")).toBe(false);
    expect(planIncludesPersona(getPlanDefinition("gold"), "future-gold-persona")).toBe(true);
    expect(getPlanDefinition("gold").maxConcurrentMediaJobs).toBeGreaterThan(
      getPlanDefinition("bronze").maxConcurrentMediaJobs
    );
    expect(getPlanDefinition("bronze").monthlyProviderCostBudget).toEqual({
      targetMicroUsd: 1_250_000,
      ceilingMicroUsd: 3_000_000
    });
    expect(getPlanDefinition("silver").monthlyPriceCents).toBe(799);
    expect(getPlanDefinition("gold").monthlyPriceCents).toBe(1199);
    expect(getPlanDefinition("bronze").imageQuality).toBe("medium");
    expect(getPlanDefinition("silver").imageQuality).toBe("medium");
    expect(getPlanDefinition("gold").imageQuality).toBe("auto");
  });
});
