import {
  billingProductCatalog,
  type BillingCatalogResponse,
  type PlanId
} from "@persona/shared";
import { env } from "../config/env.js";
import { customerUsageService } from "./customerUsageService.js";
import { getPlanDefinition } from "./planCatalog.js";

const catalogEntries = Object.values(billingProductCatalog);

function webPackageId(planId: PlanId): string | undefined {
  if (planId === "silver") return env.REVENUECAT_WEB_SILVER_PACKAGE_ID;
  if (planId === "gold") return env.REVENUECAT_WEB_GOLD_PACKAGE_ID;
  return undefined;
}

export function buildRevenueCatWebCheckoutUrl(
  purchaseLinkUrl: string | undefined,
  userId: string,
  packageId?: string
): string | undefined {
  if (!purchaseLinkUrl) return undefined;
  const url = new URL(purchaseLinkUrl);
  if (url.protocol !== "https:" || url.hostname !== "pay.rev.cat") {
    throw new Error("RevenueCat web checkout must use an HTTPS pay.rev.cat purchase link.");
  }
  url.pathname = `${url.pathname.replace(/\/$/, "")}/${encodeURIComponent(userId)}`;
  if (packageId) url.searchParams.set("package_id", packageId);
  url.searchParams.set("skip_purchase_success", "true");
  return url.toString();
}

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
      const packageId = webPackageId(product.planId);
      const webCheckoutUrl = packageId
        ? buildRevenueCatWebCheckoutUrl(env.REVENUECAT_WEB_PURCHASE_LINK_URL, userId, packageId)
        : undefined;
      return {
        ...product,
        displayName: plan.displayName,
        description: plan.description,
        monthlyPriceCents: plan.monthlyPriceCents,
        ...(webCheckoutUrl ? { webCheckoutUrl } : {})
      };
    }),
    currentPlanId: access.plan.id
  };
}
