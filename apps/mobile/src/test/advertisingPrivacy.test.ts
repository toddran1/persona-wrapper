import { beforeEach, describe, expect, it, vi } from "vitest";

const consentSdk = vi.hoisted(() => ({
  gatherConsent: vi.fn(),
  getConsentInfo: vi.fn(),
  showPrivacyOptionsForm: vi.fn()
}));

vi.mock("react-native-google-mobile-ads", () => ({
  AdsConsent: consentSdk,
  AdsConsentPrivacyOptionsRequirementStatus: {
    UNKNOWN: "UNKNOWN",
    REQUIRED: "REQUIRED",
    NOT_REQUIRED: "NOT_REQUIRED"
  }
}));

describe("advertising privacy", () => {
  beforeEach(() => {
    vi.resetModules();
    consentSdk.gatherConsent.mockReset();
    consentSdk.getConsentInfo.mockReset();
    consentSdk.showPrivacyOptionsForm.mockReset();
  });

  it("coalesces the launch consent refresh and reports required privacy options", async () => {
    consentSdk.gatherConsent.mockResolvedValue({
      canRequestAds: true,
      privacyOptionsRequirementStatus: "REQUIRED"
    });
    const { resolveAdvertisingConsent } = await import("../advertising/privacy");

    const [first, second] = await Promise.all([
      resolveAdvertisingConsent(),
      resolveAdvertisingConsent()
    ]);

    expect(consentSdk.gatherConsent).toHaveBeenCalledTimes(1);
    expect(first).toEqual({ canRequestAds: true, privacyOptionsRequired: true, source: "current" });
    expect(second).toEqual(first);
  });

  it("fails closed when neither current nor cached consent is available", async () => {
    consentSdk.gatherConsent.mockRejectedValue(new Error("offline"));
    consentSdk.getConsentInfo.mockRejectedValue(new Error("missing"));
    const { resolveAdvertisingConsent } = await import("../advertising/privacy");

    await expect(resolveAdvertisingConsent()).resolves.toEqual({
      canRequestAds: false,
      privacyOptionsRequired: false,
      source: "unavailable"
    });
  });

  it("updates the cached state after the user changes privacy choices", async () => {
    consentSdk.showPrivacyOptionsForm.mockResolvedValue({
      canRequestAds: false,
      privacyOptionsRequirementStatus: "REQUIRED"
    });
    const { resolveAdvertisingConsent, showAdvertisingPrivacyOptions } = await import("../advertising/privacy");

    await expect(showAdvertisingPrivacyOptions()).resolves.toEqual({
      canRequestAds: false,
      privacyOptionsRequired: true,
      source: "current"
    });
    await expect(resolveAdvertisingConsent()).resolves.toEqual({
      canRequestAds: false,
      privacyOptionsRequired: true,
      source: "current"
    });
    expect(consentSdk.gatherConsent).not.toHaveBeenCalled();
  });
});
