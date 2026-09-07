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
  loadSettled: boolean;
  loadTimeout: ReturnType<typeof setTimeout> | undefined;
  settleLoad: ((loaded: boolean) => void) | undefined;
  unsubscribers: Array<() => void>;
};

let activeRewardedAd: ActiveRewardedAd | undefined;
const REWARDED_AD_LOAD_TIMEOUT_MS = 20_000;

function settleRewardedAdLoad(session: ActiveRewardedAd, loaded: boolean): void {
  if (session.loadSettled) return;
  session.loadSettled = true;
  if (session.loadTimeout) clearTimeout(session.loadTimeout);
  session.loadTimeout = undefined;
  session.settleLoad?.(loaded);
  session.settleLoad = undefined;
}

function clearActiveRewardedAd(session: ActiveRewardedAd): void {
  if (activeRewardedAd !== session) return;
  settleRewardedAdLoad(session, false);
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
    loadSettled: false,
    loadTimeout: undefined,
    settleLoad: undefined,
    unsubscribers: []
  };
  activeRewardedAd = session;

  return new Promise((resolve) => {
    session.settleLoad = resolve;
    session.unsubscribers.push(
      ad.addAdEventListener(RewardedAdEventType.LOADED, () => {
        if (activeRewardedAd !== session || session.state !== "loading") return;
        session.state = "loaded";
        callbacks.onLoaded?.();
        settleRewardedAdLoad(session, true);
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
        settleRewardedAdLoad(session, false);
        clearActiveRewardedAd(session);
      })
    );
    session.loadTimeout = setTimeout(() => {
      if (activeRewardedAd !== session || session.state !== "loading") return;
      callbacks.onLoadError?.(new Error("Rewarded ad loading timed out."));
      clearActiveRewardedAd(session);
    }, REWARDED_AD_LOAD_TIMEOUT_MS);
    try {
      ad.load();
    } catch (error) {
      const normalized = error instanceof Error ? error : new Error("Rewarded ad could not be loaded.");
      callbacks.onLoadError?.(normalized);
      clearActiveRewardedAd(session);
    }
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
