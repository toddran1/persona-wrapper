import {
  billingProductCatalog,
  type BillingCatalogResponse,
  type PlanId
} from "@persona/shared";
import { env } from "../config/env.js";
import { customerUsageService } from "./customerUsageService.js";
import { getPlanDefinition } from "./planCatalog.js";

const catalogEntries = Object.values(billingProductCatalog);

export function normalizeStoreProductId(productId: string): string {
  return productId.trim().split(":", 1)[0] ?? productId.trim();
}

export function planIdForStoreProduct(productId: string | null | undefined): PlanId | undefined {
  if (!productId) return undefined;
  const normalized = normalizeStoreProductId(productId);
  return catalogEntries.find((product) => product.productId === normalized)?.planId;
}

export async function getBillingCatalog(userId: string): Promise<BillingCatalogResponse> {
  const access = await customerUsageService.getAccess(userId);
  return {
    enabled: env.BILLING_ENABLED,
    provider: env.BILLING_PROVIDER,
    offeringId: env.REVENUECAT_OFFERING_ID,
    products: catalogEntries.map((product) => {
      const plan = getPlanDefinition(product.planId);
      if (plan.monthlyPriceCents === null) {
        throw new Error(`Paid billing product ${product.productId} is mapped to a free plan.`);
      }
      return {
        ...product,
        displayName: plan.displayName,
        description: plan.description,
        monthlyPriceCents: plan.monthlyPriceCents
      };
    }),
    currentPlanId: access.plan.id
  };
}
