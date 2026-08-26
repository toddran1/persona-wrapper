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
      product_id: "ftb_silver_monthly",
      new_product_id: null,
      app_id: null,
      store: null,
      original_transaction_id: null,
      transaction_id: "transaction_1",
      event_timestamp_ms: null,
      expiration_at_ms: null
    });

    expect(event.id).toBe("event_1");
    expect(event.original_app_user_id).toBeNull();
    expect(event.aliases).toBeNull();
  });

  it("still rejects malformed required event identity", () => {
    expect(() => parseRevenueCatWebhookEvent({
      id: "",
      type: "INITIAL_PURCHASE",
      app_user_id: "user_1"
    })).toThrow();
  });
});
