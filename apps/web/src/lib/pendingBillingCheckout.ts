import type { PlanId } from "@persona/shared";

export const PENDING_BILLING_CHECKOUT_KEY = "ftb.pending-billing-checkout.v1";

export type PendingBillingCheckout = {
  accountId: string;
  currentPlanId: PlanId;
  planId: Exclude<PlanId, "bronze">;
  startedAt: number;
};

export function savePendingBillingCheckout(value: PendingBillingCheckout): void {
  try {
    window.sessionStorage.setItem(PENDING_BILLING_CHECKOUT_KEY, JSON.stringify(value));
  } catch {
    // Storage can be unavailable in hardened/private browser modes. Confirmation
    // still works by checking the server's current entitlement.
  }
}

export function readPendingBillingCheckout(): PendingBillingCheckout | undefined {
  try {
    const raw = window.sessionStorage.getItem(PENDING_BILLING_CHECKOUT_KEY);
    if (!raw) return undefined;
    const candidate = JSON.parse(raw) as Partial<PendingBillingCheckout>;
    if (
      typeof candidate.accountId !== "string" ||
      (candidate.planId !== "silver" && candidate.planId !== "gold") ||
      (candidate.currentPlanId !== "bronze" && candidate.currentPlanId !== "silver" && candidate.currentPlanId !== "gold") ||
      typeof candidate.startedAt !== "number" ||
      !Number.isFinite(candidate.startedAt) ||
      candidate.startedAt <= 0 ||
      Date.now() - candidate.startedAt > 24 * 60 * 60 * 1000
    ) {
      clearPendingBillingCheckout();
      return undefined;
    }
    return candidate as PendingBillingCheckout;
  } catch {
    clearPendingBillingCheckout();
    return undefined;
  }
}

export function clearPendingBillingCheckout(): void {
  try {
    window.sessionStorage.removeItem(PENDING_BILLING_CHECKOUT_KEY);
  } catch {
    // Nothing else is required when browser storage is unavailable.
  }
}
