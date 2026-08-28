import { describe, expect, it } from "vitest";
import {
  buildRevenueCatWebCheckoutUrl,
  normalizeStoreProductId,
  planIdForRevenueCatPurchase,
  planIdForStoreProduct
} from "../services/billingCatalogService.js";

describe("billing product catalog", () => {
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
});
