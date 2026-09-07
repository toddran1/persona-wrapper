import type { BillingCatalogResponse } from "@persona/shared";

export type AdvertisingAccountContext = {
  authenticated: boolean;
  billingCatalog?: BillingCatalogResponse;
};

export type AdvertisingConsentResult = {
  canRequestAds: boolean;
  source: "current" | "cached" | "unavailable";
};
