const ADSENSE_SCRIPT_ID = "forthebaddiez-adsense-loader";

const initializedSlots = new WeakSet<HTMLElement>();
const pendingSlots = new WeakSet<HTMLElement>();

type AdsByGoogleQueue = Array<Record<string, never>> & {
  pauseAdRequests?: number;
  requestNonPersonalizedAds?: number;
};

type TcfData = {
  gdprApplies?: boolean;
  purpose?: { consents?: Record<number, boolean> };
};

type AdsByGoogleWindow = Window & {
  adsbygoogle?: AdsByGoogleQueue;
  googlefc?: {
    callbackQueue?: Array<Record<string, () => void>>;
  };
  __tcfapi?: (
    command: string,
    version: number,
    callback: (data: TcfData | undefined, success: boolean) => void
  ) => void;
};

function consentAllowsAdRequest(adsWindow: AdsByGoogleWindow, resume: () => void): void {
  if (typeof adsWindow.__tcfapi !== "function") {
    resume();
    return;
  }

  adsWindow.__tcfapi("addEventListener", 2, (data, success) => {
    if (!success || !data) return;
    if (data.gdprApplies === true && data.purpose?.consents?.[1] !== true) return;
    resume();
  });
}

function ensureAdsenseScript(publisherId: string, onFailure: () => void): void {
  if (document.getElementById(ADSENSE_SCRIPT_ID)) return;
  const script = document.createElement("script");
  script.id = ADSENSE_SCRIPT_ID;
  script.async = true;
  script.crossOrigin = "anonymous";
  script.dataset.privacyTreatments = "disablePersonalization";
  script.src = `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${encodeURIComponent(publisherId)}`;
  script.addEventListener("error", () => {
    script.remove();
    onFailure();
  }, { once: true });
  document.head.append(script);
}

/**
 * Queues one non-personalized slot while ad requests are paused, then lets
 * Google's published CMP resume it only after applicable consent data exists.
 */
export function initializeAdsenseSlot(slot: HTMLElement, publisherId: string): boolean {
  if (typeof window === "undefined" || initializedSlots.has(slot) || pendingSlots.has(slot)) return false;
  try {
    const adsWindow = window as AdsByGoogleWindow;
    const queue = adsWindow.adsbygoogle ?? [];
    queue.pauseAdRequests = 1;
    queue.requestNonPersonalizedAds = 1;
    adsWindow.adsbygoogle = queue;

    adsWindow.googlefc = adsWindow.googlefc ?? {};
    adsWindow.googlefc.callbackQueue = adsWindow.googlefc.callbackQueue ?? [];
    pendingSlots.add(slot);

    let resumed = false;
    const resume = () => {
      if (resumed || !slot.isConnected) return;
      resumed = true;
      queue.requestNonPersonalizedAds = 1;
      queue.pauseAdRequests = 0;
      initializedSlots.add(slot);
      pendingSlots.delete(slot);
    };

    queue.push({});
    adsWindow.googlefc.callbackQueue.push({
      CONSENT_DATA_READY: () => consentAllowsAdRequest(adsWindow, resume)
    });
    ensureAdsenseScript(publisherId, () => pendingSlots.delete(slot));
    return true;
  } catch (error) {
    pendingSlots.delete(slot);
    console.warn("AdSense slot initialization was blocked or unavailable.", error);
    return false;
  }
}
