import { describe, expect, it } from "vitest";
import {
  billingSubscriptionState,
  buildRevenueCatWebCheckoutUrl,
  normalizeStoreProductId,
  planIdForRevenueCatPurchase,
  planIdForStoreProduct
} from "../services/billingCatalogService.js";

describe("billing product catalog", () => {
  const periodEnd = new Date("2026-09-01T00:00:00.000Z");
  const subscription = (overrides: Partial<NonNullable<Parameters<typeof billingSubscriptionState>[0]>> = {}) => ({
    status: "renewal",
    planId: "silver",
    store: "RC_BILLING",
    currentPeriodEndsAt: periodEnd,
    pendingPlanId: null,
    cancelReason: null,
    expirationReason: null,
    gracePeriodEndsAt: null,
    ...overrides
  });

  it("maps the shared store products to application plans", () => {
    expect(planIdForStoreProduct("com.forthebaddiez.silver.monthly")).toBe("silver");
    expect(planIdForStoreProduct("com.forthebaddiez.gold.monthly")).toBe("gold");
  });

  it("accepts Google Play base-plan product identifiers", () => {
    expect(normalizeStoreProductId("com.forthebaddiez.gold:gold-monthly")).toBe("com.forthebaddiez.gold");
    expect(planIdForStoreProduct("com.forthebaddiez.gold:gold-monthly")).toBe("gold");
    expect(planIdForStoreProduct("  com.forthebaddiez.silver:silver-monthly  ")).toBe("silver");
  });

  it("keeps legacy product aliases valid for existing receipts", () => {
    expect(planIdForStoreProduct("ftb_silver_monthly")).toBe("silver");
    expect(planIdForStoreProduct("ftb_gold_monthly:monthly")).toBe("gold");
  });

  it("does not grant access for unknown or blank products", () => {
    expect(planIdForStoreProduct("ftb_platinum_monthly")).toBeUndefined();
    expect(planIdForStoreProduct(" ")).toBeUndefined();
    expect(planIdForStoreProduct(undefined)).toBeUndefined();
  });

  it("maps RevenueCat Web Billing purchases from their stable entitlement", () => {
    expect(planIdForRevenueCatPurchase("stripe_price_from_revenuecat", ["silver"])).toBe("silver");
    expect(planIdForRevenueCatPurchase(undefined, ["gold"])).toBe("gold");
    expect(planIdForRevenueCatPurchase("unknown", ["silver", "gold"])).toBeUndefined();
  });

  it("prefers an explicit product mapping over a temporarily overlapping entitlement list", () => {
    expect(planIdForRevenueCatPurchase("com.forthebaddiez.gold.monthly", ["silver", "gold"])).toBe("gold");
  });

  it("builds an identified RevenueCat web checkout without leaking user data", () => {
    expect(buildRevenueCatWebCheckoutUrl(
      "https://pay.rev.cat/sandbox-token",
      "user/with spaces",
      "silver_monthly"
    )).toBe(
      "https://pay.rev.cat/sandbox-token/user%2Fwith%20spaces?package_id=silver_monthly&skip_purchase_success=true"
    );
    expect(buildRevenueCatWebCheckoutUrl(undefined, "user_1")).toBeUndefined();
  });

  it("rejects checkout links outside RevenueCat's secure purchase-link host", () => {
    expect(() => buildRevenueCatWebCheckoutUrl("http://pay.rev.cat/test", "user_1", "silver_monthly"))
      .toThrow(/HTTPS pay\.rev\.cat/);
    expect(() => buildRevenueCatWebCheckoutUrl("https://example.com/test", "user_1", "silver_monthly"))
      .toThrow(/HTTPS pay\.rev\.cat/);
  });

  it("reports a canceled subscription until its paid access ends", () => {
    expect(billingSubscriptionState(
      subscription({ status: "cancellation", cancelReason: "UNSUBSCRIBE" }),
      new Date("2026-08-28T00:00:00.000Z")
    )).toEqual({
      state: "canceled",
      planId: "silver",
      store: "revenuecat_web",
      currentPeriodEndsAt: periodEnd.toISOString(),
      pendingPlanId: null,
      gracePeriodEndsAt: null,
      cancellationReason: "user",
      endedReason: null
    });
    expect(billingSubscriptionState(
      subscription(),
      new Date("2026-08-28T00:00:00.000Z")
    )).toMatchObject({ state: "active", store: "revenuecat_web" });
  });

  it("separates payment failures and scheduled changes from cancellations", () => {
    expect(billingSubscriptionState(
      subscription({
        status: "cancellation",
        cancelReason: "BILLING_ERROR",
        gracePeriodEndsAt: new Date("2026-09-04T00:00:00.000Z")
      }),
      new Date("2026-08-28T00:00:00.000Z")
    )).toMatchObject({
      state: "payment_issue",
      gracePeriodEndsAt: "2026-09-04T00:00:00.000Z",
      cancellationReason: null,
      endedReason: null
    });
    expect(billingSubscriptionState(
      subscription({ status: "product_change", planId: "gold", pendingPlanId: "silver", store: "PLAY_STORE" }),
      new Date("2026-08-28T00:00:00.000Z")
    )).toMatchObject({
      state: "change_scheduled",
      planId: "gold",
      pendingPlanId: "silver",
      store: "play_store"
    });
  });

  it("shows recently ended access briefly and then removes stale lifecycle history", () => {
    expect(billingSubscriptionState(
      subscription({ status: "expired", store: "APP_STORE", expirationReason: "BILLING_ERROR" }),
      new Date("2026-09-02T00:00:00.000Z")
    )).toMatchObject({ state: "ended", store: "app_store", endedReason: "payment_issue" });
    expect(billingSubscriptionState(
      subscription({ status: "expired" }),
      new Date("2026-10-02T00:00:00.001Z")
    )).toBeNull();
  });
});
