import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("react-native", () => ({ Platform: { OS: "android" } }));
vi.mock("react-native-google-mobile-ads", () => ({
  TestIds: { BANNER: "google-test-banner", REWARDED: "google-test-rewarded" }
}));

describe("advertising mode", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("uses Google test placements whenever ADS_MODE is test", async () => {
    vi.stubEnv("EXPO_PUBLIC_ADS_MODE", "test");
    vi.stubEnv("EXPO_PUBLIC_ADMOB_ANDROID_BANNER_ID", "ca-app-pub-1555286261518615/2899664457");
    vi.stubEnv("EXPO_PUBLIC_ADMOB_ANDROID_REWARDED_ID", "ca-app-pub-1555286261518615/4021174432");
    const config = await import("../advertising/config");

    expect(config.isProductionAdsEnvironment).toBe(false);
    expect(config.getBannerAdUnitId()).toBe("google-test-banner");
    expect(config.getRewardedAdUnitId()).toBe("google-test-rewarded");
  });

  it("uses configured live placements only when ADS_MODE is production", async () => {
    vi.stubEnv("EXPO_PUBLIC_ADS_MODE", "production");
    vi.stubEnv("EXPO_PUBLIC_ADMOB_ANDROID_BANNER_ID", "ca-app-pub-1555286261518615/2899664457");
    vi.stubEnv("EXPO_PUBLIC_ADMOB_ANDROID_REWARDED_ID", "ca-app-pub-1555286261518615/4021174432");
    const config = await import("../advertising/config");

    expect(config.isProductionAdsEnvironment).toBe(true);
    expect(config.getBannerAdUnitId()).toBe("ca-app-pub-1555286261518615/2899664457");
    expect(config.getRewardedAdUnitId()).toBe("ca-app-pub-1555286261518615/4021174432");
  });

  it("defaults to test placements when ADS_MODE is absent", async () => {
    vi.stubEnv("EXPO_PUBLIC_ADS_MODE", "");
    const config = await import("../advertising/config");

    expect(config.isProductionAdsEnvironment).toBe(false);
    expect(config.getBannerAdUnitId()).toBe("google-test-banner");
  });
});
