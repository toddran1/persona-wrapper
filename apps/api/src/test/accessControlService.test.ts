import { describe, expect, it } from "vitest";
import { selectEffectivePlanAssignment, subscriptionUsagePeriod } from "../services/accessControlService.js";

describe("access control plan assignments", () => {
  it("resolves subscription periods from current and legacy RevenueCat records", () => {
    const start = new Date("2026-08-29T12:00:00.000Z");
    const end = new Date("2026-09-29T12:00:00.000Z");
    const fallbackStart = new Date("2026-08-30T00:00:00.000Z");

    expect(subscriptionUsagePeriod({
      startsAt: null,
      endsAt: end,
      metadata: { event: { purchased_at_ms: start.getTime() } },
      fallbackStart
    })).toEqual({ start, end });
    expect(subscriptionUsagePeriod({ startsAt: start, endsAt: end, fallbackStart })).toEqual({ start, end });
  });

  it("selects the highest active plan rather than allowing a later override to downgrade access", () => {
    const selected = selectEffectivePlanAssignment([
      {
        id: "paid_gold",
        planId: "gold",
        planVersion: 1,
        source: "subscription",
        effectiveAt: new Date("2026-01-01T00:00:00.000Z"),
        expiresAt: null,
        createdAt: new Date("2026-01-01T00:00:00.000Z")
      },
      {
        id: "later_silver_promotion",
        planId: "silver",
        planVersion: 1,
        source: "promotion",
        effectiveAt: new Date("2026-07-01T00:00:00.000Z"),
        expiresAt: null,
        createdAt: new Date("2026-07-01T00:00:00.000Z")
      }
    ]);

    expect(selected?.id).toBe("paid_gold");
  });

  it("uses override source priority and then recency for equivalent plans", () => {
    const selected = selectEffectivePlanAssignment([
      {
        id: "recent_promotion",
        planId: "silver",
        planVersion: 1,
        source: "promotion",
        effectiveAt: new Date("2026-07-20T00:00:00.000Z"),
        expiresAt: null,
        createdAt: new Date("2026-07-20T00:00:00.000Z")
      },
      {
        id: "support_grant",
        planId: "silver",
        planVersion: 1,
        source: "customer_support",
        effectiveAt: new Date("2026-07-01T00:00:00.000Z"),
        expiresAt: null,
        createdAt: new Date("2026-07-01T00:00:00.000Z")
      }
    ]);

    expect(selected?.id).toBe("support_grant");
  });

  it("ignores assignments for unknown catalog plans", () => {
    expect(selectEffectivePlanAssignment([{
      id: "unknown",
      planId: "platinum",
      planVersion: 1,
      source: "promotion",
      effectiveAt: new Date(),
      expiresAt: null,
      createdAt: new Date()
    }])).toBeUndefined();
  });
});
