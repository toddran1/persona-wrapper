import { isPlanAdSupported } from "@persona/shared";
import {
  AdEventType,
  RewardedAd,
  RewardedAdEventType,
  type RewardedAdReward
} from "react-native-google-mobile-ads";
import { getRewardedAdUnitId } from "./config";
import { initializeMobileAds } from "./mobileAds";
import type { AdvertisingAccountContext } from "./types";

export type RewardedAdCallbacks = {
  onLoaded?: () => void;
  onClosed?: () => void;
  onEarned?: (reward: RewardedAdReward) => void;
  onLoadError?: (error: Error) => void;
  onShowError?: (error: Error) => void;
};

type ActiveRewardedAd = {
  ad: RewardedAd;
  callbacks: RewardedAdCallbacks;
  state: "loading" | "loaded" | "showing";
  earnedDelivered: boolean;
  closedDelivered: boolean;
  unsubscribers: Array<() => void>;
};

let activeRewardedAd: ActiveRewardedAd | undefined;

function clearActiveRewardedAd(session: ActiveRewardedAd): void {
  if (activeRewardedAd !== session) return;
  for (const unsubscribe of session.unsubscribers) unsubscribe();
  activeRewardedAd = undefined;
}

export async function loadRewardedAd(
  context: AdvertisingAccountContext & { ssvUserId: string; ssvCustomData: string },
  callbacks: RewardedAdCallbacks = {}
): Promise<boolean> {
  if (
    activeRewardedAd
    || !context.authenticated
    || !context.billingCatalog
    || !isPlanAdSupported(context.billingCatalog.currentPlanId)
  ) return false;

  const adUnitId = getRewardedAdUnitId();
  if (!adUnitId || !(await initializeMobileAds(context))) return false;

  const ad = RewardedAd.createForAdRequest(adUnitId, {
    requestNonPersonalizedAdsOnly: true,
    serverSideVerificationOptions: {
      userId: context.ssvUserId,
      customData: context.ssvCustomData
    }
  });
  const session: ActiveRewardedAd = {
    ad,
    callbacks,
    state: "loading",
    earnedDelivered: false,
    closedDelivered: false,
    unsubscribers: []
  };
  activeRewardedAd = session;

  return new Promise((resolve) => {
    session.unsubscribers.push(
      ad.addAdEventListener(RewardedAdEventType.LOADED, () => {
        if (activeRewardedAd !== session || session.state !== "loading") return;
        session.state = "loaded";
        callbacks.onLoaded?.();
        resolve(true);
      }),
      ad.addAdEventListener(RewardedAdEventType.EARNED_REWARD, (reward) => {
        if (activeRewardedAd !== session || session.earnedDelivered) return;
        session.earnedDelivered = true;
        // UI feedback only. Permanent credit grants require verified AdMob SSV.
        callbacks.onEarned?.(reward);
      }),
      ad.addAdEventListener(AdEventType.CLOSED, () => {
        if (activeRewardedAd !== session || session.closedDelivered) return;
        session.closedDelivered = true;
        callbacks.onClosed?.();
        clearActiveRewardedAd(session);
      }),
      ad.addAdEventListener(AdEventType.ERROR, (error) => {
        if (activeRewardedAd !== session) return;
        if (session.state === "showing") callbacks.onShowError?.(error);
        else callbacks.onLoadError?.(error);
        resolve(false);
        clearActiveRewardedAd(session);
      })
    );
    ad.load();
  });
}

export async function showRewardedAd(context: AdvertisingAccountContext): Promise<boolean> {
  const session = activeRewardedAd;
  if (
    !session
    || session.state !== "loaded"
    || !context.authenticated
    || !context.billingCatalog
    || !isPlanAdSupported(context.billingCatalog.currentPlanId)
  ) {
    if (session) clearActiveRewardedAd(session);
    return false;
  }
  session.state = "showing";
  try {
    await session.ad.show();
    return true;
  } catch (error) {
    const normalized = error instanceof Error ? error : new Error("Rewarded ad could not be shown.");
    session.callbacks.onShowError?.(normalized);
    clearActiveRewardedAd(session);
    return false;
  }
}

export function cancelRewardedAd(): void {
  if (activeRewardedAd) clearActiveRewardedAd(activeRewardedAd);
}
