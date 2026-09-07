import { AdsConsent } from "react-native-google-mobile-ads";
import type { AdvertisingConsentResult } from "./types";

/**
 * Resolves Google's UMP state. Consent messaging must also be configured in
 * the AdMob console; this intentionally does not implement a custom dialog.
 */
export async function resolveAdvertisingConsent(): Promise<AdvertisingConsentResult> {
  try {
    const consent = await AdsConsent.gatherConsent();
    return { canRequestAds: consent.canRequestAds, source: "current" };
  } catch (error) {
    console.warn("Advertising consent refresh failed; checking the last SDK consent state.", error);
    try {
      const cached = await AdsConsent.getConsentInfo();
      return {
        canRequestAds: cached.canRequestAds,
        source: cached.canRequestAds ? "cached" : "unavailable"
      };
    } catch (cachedError) {
      console.warn("Advertising consent state is unavailable; ads remain disabled.", cachedError);
      return { canRequestAds: false, source: "unavailable" };
    }
  }
}
