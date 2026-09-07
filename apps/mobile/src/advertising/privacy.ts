import {
  AdsConsent,
  AdsConsentPrivacyOptionsRequirementStatus
} from "react-native-google-mobile-ads";
import type { AdvertisingConsentResult } from "./types";

let consentResolutionPromise: Promise<AdvertisingConsentResult> | undefined;

function consentResult(
  consent: Awaited<ReturnType<typeof AdsConsent.getConsentInfo>>,
  source: AdvertisingConsentResult["source"]
): AdvertisingConsentResult {
  return {
    canRequestAds: consent.canRequestAds,
    privacyOptionsRequired:
      consent.privacyOptionsRequirementStatus === AdsConsentPrivacyOptionsRequirementStatus.REQUIRED,
    source
  };
}

/**
 * Resolves Google's UMP state. Consent messaging must also be configured in
 * the AdMob console; this intentionally does not implement a custom dialog.
 */
export async function resolveAdvertisingConsent(): Promise<AdvertisingConsentResult> {
  consentResolutionPromise ??= (async () => {
    try {
      const consent = await AdsConsent.gatherConsent();
      return consentResult(consent, "current");
    } catch (error) {
      console.warn("Advertising consent refresh failed; checking the last SDK consent state.", error);
      try {
        const cached = await AdsConsent.getConsentInfo();
        return consentResult(cached, cached.canRequestAds ? "cached" : "unavailable");
      } catch (cachedError) {
        console.warn("Advertising consent state is unavailable; ads remain disabled.", cachedError);
        return { canRequestAds: false, privacyOptionsRequired: false, source: "unavailable" };
      }
    }
  })();
  return consentResolutionPromise;
}

export async function showAdvertisingPrivacyOptions(): Promise<AdvertisingConsentResult> {
  const consent = await AdsConsent.showPrivacyOptionsForm();
  const result = consentResult(consent, "current");
  // Keep subsequent ad initialization aligned with the user's latest choice.
  consentResolutionPromise = Promise.resolve(result);
  return result;
}
