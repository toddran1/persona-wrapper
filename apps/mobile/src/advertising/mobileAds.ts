import { isPlanAdSupported } from "@persona/shared";
import mobileAds from "react-native-google-mobile-ads";
import { resolveAdvertisingConsent } from "./privacy";
import type { AdvertisingAccountContext } from "./types";

let initializationPromise: Promise<boolean> | undefined;

export async function initializeMobileAds(context: AdvertisingAccountContext): Promise<boolean> {
  if (
    !context.authenticated
    || !context.billingCatalog
    || !isPlanAdSupported(context.billingCatalog.currentPlanId)
  ) return false;

  initializationPromise ??= (async () => {
    const consent = await resolveAdvertisingConsent();
    if (!consent.canRequestAds) return false;
    try {
      await mobileAds().initialize();
      return true;
    } catch (error) {
      console.warn("Google Mobile Ads initialization failed; ads remain disabled.", error);
      return false;
    }
  })();
  const currentAttempt = initializationPromise;
  const initialized = await currentAttempt;
  if (!initialized && initializationPromise === currentAttempt) initializationPromise = undefined;
  return initialized;
}
