import { beforeEach, describe, expect, it, vi } from "vitest";

const adSdk = vi.hoisted(() => ({
  initialize: vi.fn(),
  setRequestConfiguration: vi.fn()
}));
const adConfig = vi.hoisted(() => ({
  isSsvTestAdsEnvironment: true,
  testDeviceIdentifiers: ["DEVICE_A", "DEVICE_B"]
}));

vi.mock("react-native-google-mobile-ads", () => ({
  default: () => adSdk
}));
vi.mock("../advertising/config", () => ({
  getAdMobTestDeviceIdentifiers: () => adConfig.testDeviceIdentifiers,
  get isSsvTestAdsEnvironment() {
    return adConfig.isSsvTestAdsEnvironment;
  }
}));
vi.mock("../advertising/privacy", () => ({
  resolveAdvertisingConsent: vi.fn().mockResolvedValue({ canRequestAds: true })
}));

const bronzeContext = {
  authenticated: true,
  billingCatalog: { currentPlanId: "bronze" } as never
};

describe("mobile ad SDK initialization", () => {
  beforeEach(() => {
    vi.resetModules();
    adSdk.initialize.mockReset().mockResolvedValue(undefined);
    adSdk.setRequestConfiguration.mockReset().mockResolvedValue(undefined);
    adConfig.isSsvTestAdsEnvironment = true;
    adConfig.testDeviceIdentifiers = ["DEVICE_A", "DEVICE_B"];
  });

  it("registers SSV test devices before initializing the SDK", async () => {
    const { initializeMobileAds } = await import("../advertising/mobileAds");

    await expect(initializeMobileAds(bronzeContext)).resolves.toBe(true);
    expect(adSdk.setRequestConfiguration).toHaveBeenCalledWith({
      testDeviceIdentifiers: ["DEVICE_A", "DEVICE_B"]
    });
    expect(adSdk.setRequestConfiguration.mock.invocationCallOrder[0]).toBeLessThan(
      adSdk.initialize.mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY
    );
  });

  it("fails closed when SSV test mode has no registered device", async () => {
    adConfig.testDeviceIdentifiers = [];
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { initializeMobileAds } = await import("../advertising/mobileAds");

    await expect(initializeMobileAds(bronzeContext)).resolves.toBe(false);
    expect(adSdk.setRequestConfiguration).not.toHaveBeenCalled();
    expect(adSdk.initialize).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("SSV test ads require"));
    warn.mockRestore();
  });
});
