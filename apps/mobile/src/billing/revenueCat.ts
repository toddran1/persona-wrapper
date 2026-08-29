import type { BillingCatalogProduct, BillingCatalogResponse, PlanId } from "@persona/shared";
import { Platform } from "react-native";
import Purchases, {
  LOG_LEVEL,
  PURCHASES_ERROR_CODE,
  type CustomerInfo,
  type PurchasesError,
  type PurchasesPackage
} from "react-native-purchases";

let configured = false;
let configuredUserId: string | undefined;
let operationQueue: Promise<void> = Promise.resolve();

function runRevenueCatOperation<T>(operation: () => Promise<T>): Promise<T> {
  const result = operationQueue.then(operation, operation);
  operationQueue = result.then(() => undefined, () => undefined);
  return result;
}

function platformApiKey(): string | undefined {
  if (Platform.OS === "ios") return process.env.EXPO_PUBLIC_REVENUECAT_IOS_API_KEY?.trim() || undefined;
  if (Platform.OS === "android") return process.env.EXPO_PUBLIC_REVENUECAT_ANDROID_API_KEY?.trim() || undefined;
  return undefined;
}

export function revenueCatIsAvailable(): boolean {
  return Boolean(platformApiKey());
}

async function configureRevenueCatInternal(userId: string): Promise<boolean> {
  const apiKey = platformApiKey();
  if (!apiKey) return false;
  if (!configured) {
    Purchases.configure({ apiKey, appUserID: userId });
    configured = true;
    configuredUserId = userId;
    if (__DEV__) await Purchases.setLogLevel(LOG_LEVEL.DEBUG);
    return true;
  }
  if (configuredUserId !== userId) {
    await Purchases.logIn(userId);
    configuredUserId = userId;
  }
  return true;
}

export function configureRevenueCat(userId: string): Promise<boolean> {
  return runRevenueCatOperation(() => configureRevenueCatInternal(userId));
}

export function disconnectRevenueCat(): Promise<void> {
  return runRevenueCatOperation(async () => {
    if (!configured || !configuredUserId) return;
    await Purchases.logOut().catch(() => undefined);
    configuredUserId = undefined;
  });
}

export type StoreBillingProduct = {
  planId: "silver" | "gold";
  storeProductId: string;
  price: string;
  package: PurchasesPackage;
};

function androidRevenueCatProductId(product: BillingCatalogProduct): string {
  return `${product.androidProductId}:${product.androidBasePlanId}`;
}

function matchesCatalogProduct(identifier: string, product: BillingCatalogProduct): boolean {
  if (Platform.OS === "ios") return identifier === product.iosProductId;
  if (Platform.OS !== "android") return false;
  return identifier === product.androidProductId || identifier === androidRevenueCatProductId(product);
}

export async function loadStoreBillingProducts(
  userId: string,
  catalog: BillingCatalogResponse
): Promise<StoreBillingProduct[]> {
  return runRevenueCatOperation(async () => {
    if (!(await configureRevenueCatInternal(userId))) return [];
    const offerings = await Purchases.getOfferings();
    const offering = offerings.all[catalog.offeringId] ?? offerings.current;
    if (!offering) throw new Error("Subscriptions are temporarily unavailable. Please try again later.");
    return offering.availablePackages.flatMap((candidate) => {
      const product = catalog.products.find((entry) => matchesCatalogProduct(candidate.product.identifier, entry));
      return product && product.planId !== "bronze"
        ? [{ planId: product.planId, storeProductId: candidate.product.identifier, price: candidate.product.priceString, package: candidate }]
        : [];
    });
  });
}

function androidActiveProductIdentifier(productIdentifier: string, productPlanIdentifier: string | null): string {
  if (productIdentifier.includes(":") || !productPlanIdentifier) return productIdentifier;
  return `${productIdentifier}:${productPlanIdentifier}`;
}

export function purchaseStorePackage(
  userId: string,
  candidate: PurchasesPackage,
  catalog: BillingCatalogResponse,
  targetPlanId: "silver" | "gold"
): Promise<"purchased" | "cancelled"> {
  return runRevenueCatOperation(async () => {
    if (!(await configureRevenueCatInternal(userId))) throw new Error("Store billing is not configured for this build.");
    try {
      const currentPlanId = catalog.currentPlanId;
      const customerInfo = await Purchases.getCustomerInfo();
      if (currentPlanId === "bronze") {
        const activePaidPlan = catalog.products.find((product) =>
          product.planId !== "bronze" && Boolean(customerInfo.entitlements.active[product.entitlementId])
        );
        if (activePaidPlan) {
          throw new Error(`${activePaidPlan.displayName} is already active in RevenueCat. Refresh Plan & usage before starting another purchase.`);
        }
      }
      if (currentPlanId !== "bronze" && currentPlanId !== targetPlanId) {
        const currentProduct = catalog.products.find((product) => product.planId === currentPlanId);
        const currentEntitlement = currentProduct
          ? customerInfo.entitlements.active[currentProduct.entitlementId]
          : undefined;
        if (!currentProduct || !currentEntitlement) {
          throw new Error("This subscription is managed outside this app store. Use Manage subscription to change it without creating a second subscription.");
        }
        if (Platform.OS === "android") {
          if (currentEntitlement.store !== "PLAY_STORE") {
            throw new Error("This subscription was purchased on another platform. Use Manage subscription to change it there.");
          }
          const planRank: Record<PlanId, number> = { bronze: 0, silver: 1, gold: 2 };
          const replacementMode = planRank[targetPlanId] > planRank[currentPlanId]
            ? Purchases.STORE_REPLACEMENT_MODE.CHARGE_PRORATED_PRICE
            : Purchases.STORE_REPLACEMENT_MODE.DEFERRED;
          await Purchases.purchasePackage(candidate, null, {
            oldProductIdentifier: androidActiveProductIdentifier(
              currentEntitlement.productIdentifier,
              currentEntitlement.productPlanIdentifier
            ),
            replacementMode
          });
        } else {
          if (Platform.OS === "ios" && currentEntitlement.store !== "APP_STORE") {
            throw new Error("This subscription was purchased on another platform. Use Manage subscription to change it there.");
          }
          await Purchases.purchasePackage(candidate);
        }
      } else {
        await Purchases.purchasePackage(candidate);
      }
      return "purchased";
    } catch (error) {
      const purchaseError = error as Partial<PurchasesError>;
      if (purchaseError.code === PURCHASES_ERROR_CODE.PURCHASE_CANCELLED_ERROR || purchaseError.userCancelled) {
        return "cancelled";
      }
      throw error;
    }
  });
}

export function restoreStorePurchases(userId: string): Promise<CustomerInfo> {
  return runRevenueCatOperation(async () => {
    if (!(await configureRevenueCatInternal(userId))) throw new Error("Store billing is not configured for this build.");
    return Purchases.restorePurchases();
  });
}

export function showStoreSubscriptionManagement(userId: string): Promise<void> {
  return runRevenueCatOperation(async () => {
    if (!(await configureRevenueCatInternal(userId))) throw new Error("Store billing is not configured for this build.");
    await Purchases.showManageSubscriptions();
  });
}
