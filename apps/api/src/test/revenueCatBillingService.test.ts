import { describe, expect, it } from "vitest";
import { parseRevenueCatWebhookEvent } from "../services/revenueCatBillingService.js";

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
});
