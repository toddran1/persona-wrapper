import {
  type BillingCatalogResponse,
  billingProductCatalog,
  type PlanId
} from "@persona/shared";
import { and, desc, eq } from "drizzle-orm";
import { env } from "../config/env.js";
import { getDatabase } from "../db/client.js";
import { billingSubscriptions } from "../db/schema.js";
import { customerUsageService } from "./customerUsageService.js";
import { getPlanDefinition } from "./planCatalog.js";

const catalogEntries = Object.values(billingProductCatalog);
type PaidPlanId = Exclude<PlanId, "bronze">;
const legacyStoreProductIds: Readonly<Record<string, PlanId>> = {
  ftb_silver_monthly: "silver",
  ftb_gold_monthly: "gold"
};
const RECENTLY_ENDED_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

type StoredBillingSubscription = {
  status: string;
  planId: string;
  store: string | null;
  currentPeriodEndsAt: Date | null;
  pendingPlanId: string | null;
  cancelReason: string | null;
  expirationReason: string | null;
  gracePeriodEndsAt: Date | null;
};

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
  const candidate = productId.trim();
  if (!candidate) return undefined;
  const exactMatch = catalogEntries.find((product) =>
    candidate === product.iosProductId ||
    candidate === `${product.androidProductId}:${product.androidBasePlanId}`
  );
  if (exactMatch) return exactMatch.planId;
  const normalized = normalizeStoreProductId(candidate);
  const baseMatch = catalogEntries.find((product) => normalized === product.androidProductId);
  return baseMatch?.planId ?? legacyStoreProductIds[normalized];
}

/**
 * RevenueCat's Web Billing/Stripe events can identify a purchase with a
 * provider-side product id that is different from our App Store and Play
 * product ids. The entitlement is the stable cross-store identifier, so use
 * it only as a fallback after an explicit store-product match. This keeps
 * upgrades that temporarily expose multiple entitlements deterministic.
 */
export function planIdForRevenueCatPurchase(
  productId: string | null | undefined,
  entitlementIds: readonly string[] | null | undefined
): PlanId | undefined {
  const byProduct = planIdForStoreProduct(productId);
  if (byProduct) return byProduct;

  const matchingPlans = [...new Set(
    (entitlementIds ?? [])
      .map((entitlementId) => catalogEntries.find((product) => product.entitlementId === entitlementId)?.planId)
      .filter((planId): planId is PaidPlanId => planId !== undefined)
  )];
  return matchingPlans.length === 1 ? matchingPlans[0] : undefined;
}

export function billingSubscriptionState(
  subscription: StoredBillingSubscription | undefined,
  now = new Date()
): BillingCatalogResponse["subscription"] {
  const currentPeriodEndsAt = subscription?.currentPeriodEndsAt;
  if (!subscription || !currentPeriodEndsAt) return null;
  const planId = subscription.planId === "silver" || subscription.planId === "gold"
    ? subscription.planId
    : undefined;
  if (!planId) return null;
  const periodEndMs = currentPeriodEndsAt.getTime();
  const effectiveAccessEndMs = (subscription.status === "billing_issue" || subscription.cancelReason === "BILLING_ERROR")
    && subscription.gracePeriodEndsAt
    ? subscription.gracePeriodEndsAt.getTime()
    : periodEndMs;
  const ended = subscription.status === "expired"
    || subscription.status === "refunded"
    || effectiveAccessEndMs <= now.getTime();
  if (ended && now.getTime() - effectiveAccessEndMs > RECENTLY_ENDED_WINDOW_MS) return null;
  const pendingPlanId = subscription.pendingPlanId === "bronze"
    || subscription.pendingPlanId === "silver"
    || subscription.pendingPlanId === "gold"
    ? subscription.pendingPlanId
    : null;
  const normalizedStore = subscription.store?.trim().toUpperCase();
  const store = normalizedStore === "APP_STORE" || normalizedStore === "MAC_APP_STORE"
    ? "app_store" as const
    : normalizedStore === "PLAY_STORE"
      ? "play_store" as const
      : normalizedStore === "RC_BILLING"
        ? "revenuecat_web" as const
        : "other" as const;
  const cancellationReason = subscription.cancelReason === "UNSUBSCRIBE"
    ? "user" as const
    : subscription.cancelReason === "PRICE_INCREASE"
      ? "price_change" as const
      : subscription.cancelReason === "DEVELOPER_INITIATED"
        ? "developer" as const
        : subscription.status === "cancellation"
          && subscription.cancelReason !== "BILLING_ERROR"
          && subscription.cancelReason !== "CUSTOMER_SUPPORT"
          ? "unknown" as const
          : null;
  const state = ended
    ? "ended" as const
    : subscription.status === "billing_issue" || subscription.cancelReason === "BILLING_ERROR"
      ? "payment_issue" as const
      : pendingPlanId && pendingPlanId !== planId
        ? "change_scheduled" as const
        : subscription.status === "cancellation" || subscription.status === "non_renewing_purchase"
          ? subscription.cancelReason === "CUSTOMER_SUPPORT" ? "status_unknown" as const : "canceled" as const
          : subscription.status === "subscription_paused"
            ? "status_unknown" as const
            : "active" as const;
  const endedReason = !ended
    ? null
    : subscription.expirationReason === "BILLING_ERROR"
      ? "payment_issue" as const
      : subscription.expirationReason === "UNSUBSCRIBE"
        || subscription.expirationReason === "DEVELOPER_INITIATED"
        || subscription.expirationReason === "PRICE_INCREASE"
        ? "non_renewing" as const
        : "other" as const;
  return {
    state,
    planId,
    store,
    currentPeriodEndsAt: currentPeriodEndsAt.toISOString(),
    pendingPlanId,
    gracePeriodEndsAt: subscription.gracePeriodEndsAt?.toISOString() ?? null,
    cancellationReason,
    endedReason
  };
}

export async function getBillingCatalog(userId: string): Promise<BillingCatalogResponse> {
  const access = await customerUsageService.getAccess(userId);
  const db = getDatabase();
  const selection = {
    status: billingSubscriptions.status,
    planId: billingSubscriptions.planId,
    store: billingSubscriptions.store,
    currentPeriodEndsAt: billingSubscriptions.currentPeriodEndsAt,
    pendingPlanId: billingSubscriptions.pendingPlanId,
    cancelReason: billingSubscriptions.cancelReason,
    expirationReason: billingSubscriptions.expirationReason,
    gracePeriodEndsAt: billingSubscriptions.gracePeriodEndsAt
  };
  let subscription: StoredBillingSubscription | undefined;
  if (db && access.assignment?.source === "subscription") {
    [subscription] = await db.select(selection).from(billingSubscriptions).where(and(
      eq(billingSubscriptions.userId, userId),
      eq(billingSubscriptions.planAssignmentId, access.assignment.id)
    )).orderBy(desc(billingSubscriptions.updatedAt)).limit(1);
  } else if (db && access.plan.id === "bronze") {
    [subscription] = await db.select(selection).from(billingSubscriptions)
      .where(eq(billingSubscriptions.userId, userId))
      .orderBy(desc(billingSubscriptions.updatedAt)).limit(1);
  }
  const currentSubscription = billingSubscriptionState(subscription);
  return {
    enabled: env.BILLING_ENABLED,
    provider: env.BILLING_PROVIDER,
    offeringId: env.REVENUECAT_OFFERING_ID,
    products: catalogEntries.map((product) => {
      const plan = getPlanDefinition(product.planId);
      if (plan.monthlyPriceCents === null) {
        throw new Error(`Paid billing product ${product.planId} is mapped to a free plan.`);
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
    currentPlanId: access.plan.id,
    subscription: currentSubscription
  };
}
