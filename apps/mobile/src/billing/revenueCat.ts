import type { BillingCatalogResponse } from "@persona/shared";
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
  productId: string;
  price: string;
  package: PurchasesPackage;
};

export async function loadStoreBillingProducts(
  userId: string,
  catalog: BillingCatalogResponse
): Promise<StoreBillingProduct[]> {
  return runRevenueCatOperation(async () => {
    if (!(await configureRevenueCatInternal(userId))) return [];
    const offerings = await Purchases.getOfferings();
    const offering = offerings.all[catalog.offeringId] ?? offerings.current;
    if (!offering) throw new Error("Subscriptions are temporarily unavailable. Please try again later.");
    const catalogIds = new Set(catalog.products.map((product) => product.productId));
    return offering.availablePackages.flatMap((candidate) => {
      const normalized = candidate.product.identifier.split(":", 1)[0] ?? candidate.product.identifier;
      return catalogIds.has(normalized)
        ? [{ productId: normalized, price: candidate.product.priceString, package: candidate }]
        : [];
    });
  });
}

export function purchaseStorePackage(userId: string, candidate: PurchasesPackage): Promise<"purchased" | "cancelled"> {
  return runRevenueCatOperation(async () => {
    if (!(await configureRevenueCatInternal(userId))) throw new Error("Store billing is not configured for this build.");
    try {
      await Purchases.purchasePackage(candidate);
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
