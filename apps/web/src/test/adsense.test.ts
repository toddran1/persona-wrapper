import { describe, expect, it, vi } from "vitest";
import { initializeAdsenseSlot } from "../advertising/adsense.js";

describe("initializeAdsenseSlot", () => {
  it("pushes each mounted slot only once", () => {
    const push = vi.fn();
    Object.assign(window, { adsbygoogle: { push } });
    const slot = document.createElement("ins");

    expect(initializeAdsenseSlot(slot)).toBe(true);
    expect(initializeAdsenseSlot(slot)).toBe(false);
    expect(push).toHaveBeenCalledTimes(1);
  });

  it("does not throw when an ad blocker makes the global unusable", () => {
    Object.defineProperty(window, "adsbygoogle", {
      configurable: true,
      set() {
        throw new Error("blocked");
      }
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    expect(initializeAdsenseSlot(document.createElement("ins"))).toBe(false);
    expect(warn).toHaveBeenCalledOnce();
  });
});
