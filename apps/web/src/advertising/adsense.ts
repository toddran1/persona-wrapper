const initializedSlots = new WeakSet<HTMLElement>();

type AdsByGoogleWindow = Window & {
  adsbygoogle?: Array<Record<string, never>>;
};

/** Initializes one mounted slot at most once and tolerates blocked AdSense scripts. */
export function initializeAdsenseSlot(slot: HTMLElement): boolean {
  if (typeof window === "undefined" || initializedSlots.has(slot)) return false;
  try {
    const adsWindow = window as AdsByGoogleWindow;
    adsWindow.adsbygoogle = adsWindow.adsbygoogle ?? [];
    adsWindow.adsbygoogle.push({});
    initializedSlots.add(slot);
    return true;
  } catch (error) {
    console.warn("AdSense slot initialization was blocked or unavailable.", error);
    return false;
  }
}
