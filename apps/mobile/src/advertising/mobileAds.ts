import { isPlanAdSupported } from "@persona/shared";
import mobileAds from "react-native-google-mobile-ads";
import { getAdMobTestDeviceIdentifiers, isSsvTestAdsEnvironment } from "./config";
import { resolveAdvertisingConsent } from "./privacy";
import type { AdvertisingAccountContext } from "./types";

let initializationPromise: Promise<boolean> | undefined;

export async function initializeMobileAds(context: AdvertisingAccountContext): Promise<boolean> {
  if (
    !context.authenticated
    || !context.billingCatalog
    || !isPlanAdSupported(context.billingCatalog.currentPlanId)
  ) return false;

  const consent = await resolveAdvertisingConsent();
  if (!consent.canRequestAds) return false;

  initializationPromise ??= (async () => {
    try {
      const ads = mobileAds();
      if (isSsvTestAdsEnvironment) {
        const testDeviceIdentifiers = getAdMobTestDeviceIdentifiers();
        if (testDeviceIdentifiers.length === 0) {
          console.warn("SSV test ads require at least one configured AdMob test device; ads remain disabled.");
          return false;
        }
        await ads.setRequestConfiguration({ testDeviceIdentifiers });
      }
      await ads.initialize();
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
