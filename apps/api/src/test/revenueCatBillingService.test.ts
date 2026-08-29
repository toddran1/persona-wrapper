import { describe, expect, it } from "vitest";
import {
  parseRevenueCatWebhookEvent,
  revenueCatAccessOutcome,
  shouldApplyRevenueCatEvent
} from "../services/revenueCatBillingService.js";

describe("RevenueCat webhook parsing", () => {
  it("accepts nullable optional fields from RevenueCat deliveries", () => {
    const event = parseRevenueCatWebhookEvent({
      id: "event_1",
      type: "INITIAL_PURCHASE",
      app_user_id: "user_1",
      original_app_user_id: null,
      aliases: null,
      product_id: "com.forthebaddiez.silver:silver-monthly",
      new_product_id: null,
      entitlement_ids: ["silver"],
      app_id: null,
      store: null,
      original_transaction_id: null,
      transaction_id: "transaction_1",
      event_timestamp_ms: null,
      expiration_at_ms: null,
      cancel_reason: "BILLING_ERROR",
      grace_period_expiration_at_ms: 1_788_499_200_000,
      expiration_reason: null
    });

    expect(event.id).toBe("event_1");
    expect(event.original_app_user_id).toBeNull();
    expect(event.aliases).toBeNull();
    expect(event.entitlement_ids).toEqual(["silver"]);
    expect(event.cancel_reason).toBe("BILLING_ERROR");
    expect(event.grace_period_expiration_at_ms).toBe(1_788_499_200_000);
  });

  it("still rejects malformed required event identity", () => {
    expect(() => parseRevenueCatWebhookEvent({
      id: "",
      type: "INITIAL_PURCHASE",
      app_user_id: "user_1"
    })).toThrow();
  });

  it("does not let equal-timestamp billing events undo an expiration", () => {
    const eventAt = new Date("2026-09-01T00:00:00.000Z");
    expect(shouldApplyRevenueCatEvent(
      { lastEventAt: eventAt, status: "expired" },
      eventAt,
      { type: "BILLING_ISSUE", cancel_reason: null }
    )).toBe(false);
    expect(shouldApplyRevenueCatEvent(
      { lastEventAt: eventAt, status: "billing_issue" },
      eventAt,
      { type: "EXPIRATION", cancel_reason: null }
    )).toBe(true);
    expect(shouldApplyRevenueCatEvent(
      { lastEventAt: eventAt, status: "product_change" },
      eventAt,
      { type: "RENEWAL", cancel_reason: null }
    )).toBe(true);
  });

  it("extends access through grace and revokes support refunds immediately", () => {
    const eventAt = new Date("2026-09-01T00:00:00.000Z");
    const periodEnd = new Date("2026-09-01T00:00:00.000Z");
    const graceEndMs = new Date("2026-09-04T00:00:00.000Z").getTime();
    expect(revenueCatAccessOutcome({
      type: "BILLING_ISSUE",
      cancel_reason: null,
      expiration_reason: null,
      grace_period_expiration_at_ms: graceEndMs
    }, eventAt, periodEnd)).toMatchObject({
      accessEnded: false,
      accessEndsAt: new Date(graceEndMs),
      gracePeriodEndsAt: new Date(graceEndMs),
      status: "billing_issue"
    });
    expect(revenueCatAccessOutcome({
      type: "CANCELLATION",
      cancel_reason: "CUSTOMER_SUPPORT",
      expiration_reason: null,
      grace_period_expiration_at_ms: null
    }, eventAt, new Date("2026-10-01T00:00:00.000Z"))).toMatchObject({
      accessEnded: true,
      accessEndsAt: eventAt,
      expirationReason: "CUSTOMER_SUPPORT",
      status: "refunded"
    });
  });

  it("keeps voluntary cancellations active through expiration and revokes only on expiration", () => {
    const cancellationAt = new Date("2026-08-20T00:00:00.000Z");
    const periodEnd = new Date("2026-09-01T00:00:00.000Z");
    expect(revenueCatAccessOutcome({
      type: "CANCELLATION",
      cancel_reason: "UNSUBSCRIBE",
      expiration_reason: null,
      grace_period_expiration_at_ms: null
    }, cancellationAt, periodEnd)).toMatchObject({
      accessEnded: false,
      accessEndsAt: periodEnd,
      status: "cancellation"
    });
    expect(revenueCatAccessOutcome({
      type: "EXPIRATION",
      cancel_reason: null,
      expiration_reason: "UNSUBSCRIBE",
      grace_period_expiration_at_ms: null
    }, periodEnd, periodEnd)).toMatchObject({
      accessEnded: true,
      accessEndsAt: periodEnd,
      expirationReason: "UNSUBSCRIBE",
      status: "expired"
    });
  });
});
