import { afterEach, describe, expect, it, vi } from "vitest";
import { initializeAdsenseSlot } from "../advertising/adsense.js";

describe("initializeAdsenseSlot", () => {
  afterEach(() => {
    Reflect.deleteProperty(window, "adsbygoogle");
    Reflect.deleteProperty(window, "googlefc");
    Reflect.deleteProperty(window, "__tcfapi");
    document.getElementById("forthebaddiez-adsense-loader")?.remove();
    vi.restoreAllMocks();
  });

  it("loads the script only for an eligible slot and pauses requests until consent data is ready", () => {
    const slot = document.createElement("ins");
    document.body.append(slot);

    expect(initializeAdsenseSlot(slot, "ca-pub-1555286261518615")).toBe(true);

    const adsWindow = window as unknown as Window & {
      adsbygoogle: Array<Record<string, never>> & { pauseAdRequests?: number; requestNonPersonalizedAds?: number };
      googlefc: { callbackQueue: Array<Record<string, () => void>> };
    };
    expect(adsWindow.adsbygoogle).toHaveLength(1);
    expect(adsWindow.adsbygoogle.pauseAdRequests).toBe(1);
    expect(adsWindow.adsbygoogle.requestNonPersonalizedAds).toBe(1);
    const script = document.getElementById("forthebaddiez-adsense-loader") as HTMLScriptElement;
    expect(script.src).toContain("client=ca-pub-1555286261518615");
    expect(script.dataset.privacyTreatments).toBe("disablePersonalization");

    adsWindow.googlefc.callbackQueue[0]?.CONSENT_DATA_READY?.();
    expect(adsWindow.adsbygoogle.pauseAdRequests).toBe(0);
    expect(initializeAdsenseSlot(slot, "ca-pub-1555286261518615")).toBe(false);
  });

  it("keeps the request paused when GDPR applies and storage consent is denied", () => {
    Object.assign(window, {
      __tcfapi: (_command: string, _version: number, callback: (data: unknown, success: boolean) => void) => {
        callback({ gdprApplies: true, purpose: { consents: { 1: false } } }, true);
      }
    });
    const slot = document.createElement("ins");
    document.body.append(slot);

    expect(initializeAdsenseSlot(slot, "ca-pub-1555286261518615")).toBe(true);
    const adsWindow = window as unknown as Window & {
      adsbygoogle: Array<Record<string, never>> & { pauseAdRequests?: number };
      googlefc: { callbackQueue: Array<Record<string, () => void>> };
    };
    adsWindow.googlefc.callbackQueue[0]?.CONSENT_DATA_READY?.();

    expect(adsWindow.adsbygoogle.pauseAdRequests).toBe(1);
  });

  it("does not throw when an ad blocker makes the global unusable", () => {
    Object.defineProperty(window, "adsbygoogle", {
      configurable: true,
      set() {
        throw new Error("blocked");
      }
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    expect(initializeAdsenseSlot(document.createElement("ins"), "ca-pub-1555286261518615")).toBe(false);
    expect(warn).toHaveBeenCalledOnce();
  });

  it("allows the same slot to retry after a transient initialization failure", () => {
    const push = vi.fn()
      .mockImplementationOnce(() => { throw new Error("temporarily blocked"); })
      .mockImplementationOnce(() => undefined);
    Object.assign(window, { adsbygoogle: { push } });
    const slot = document.createElement("ins");
    vi.spyOn(console, "warn").mockImplementation(() => undefined);

    expect(initializeAdsenseSlot(slot, "ca-pub-1555286261518615")).toBe(false);
    expect(initializeAdsenseSlot(slot, "ca-pub-1555286261518615")).toBe(true);
    expect(push).toHaveBeenCalledTimes(2);
  });
});
