import { describe, expect, it } from "vitest";
import {
  buildRevenueCatWebCheckoutUrl,
  normalizeStoreProductId,
  planIdForStoreProduct
} from "../services/billingCatalogService.js";

describe("billing product catalog", () => {
  it("maps the shared store products to application plans", () => {
    expect(planIdForStoreProduct("ftb_silver_monthly")).toBe("silver");
    expect(planIdForStoreProduct("ftb_gold_monthly")).toBe("gold");
  });

  it("accepts Google Play base-plan product identifiers", () => {
    expect(normalizeStoreProductId("ftb_gold_monthly:monthly")).toBe("ftb_gold_monthly");
    expect(planIdForStoreProduct("ftb_gold_monthly:monthly")).toBe("gold");
    expect(planIdForStoreProduct("  ftb_silver_monthly:monthly  ")).toBe("silver");
  });

  it("does not grant access for unknown or blank products", () => {
    expect(planIdForStoreProduct("ftb_platinum_monthly")).toBeUndefined();
    expect(planIdForStoreProduct(" ")).toBeUndefined();
    expect(planIdForStoreProduct(undefined)).toBeUndefined();
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
