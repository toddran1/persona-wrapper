import { describe, expect, it } from "vitest";
import {
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
});
