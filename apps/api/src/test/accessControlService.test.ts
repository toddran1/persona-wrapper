import { describe, expect, it } from "vitest";
import { selectEffectivePlanAssignment } from "../services/accessControlService.js";

describe("access control plan assignments", () => {
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
