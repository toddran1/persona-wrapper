import { Platform } from "react-native";
import { TestIds } from "react-native-google-mobile-ads";

const adsMode = process.env.EXPO_PUBLIC_ADS_MODE?.trim() || "test";
const reportedMissingConfig = new Set<string>();
const ADMOB_AD_UNIT_ID_PATTERN = /^ca-app-pub-\d{16}\/\d{10}$/;

export const isProductionAdsEnvironment = adsMode === "production";
export const isSsvTestAdsEnvironment = adsMode === "ssv-test";

function unavailable(name: string): undefined {
  if (!reportedMissingConfig.has(name)) {
    reportedMissingConfig.add(name);
    console.warn(`${name} is not configured; mobile ads are disabled for this placement.`);
  }
  return undefined;
}

function configuredAdUnitId(name: string, value: string | undefined): string | undefined {
  const normalized = value?.trim();
  if (normalized && ADMOB_AD_UNIT_ID_PATTERN.test(normalized)) return normalized;
  return unavailable(normalized
    ? `${name} has an invalid format (ad unit IDs use ca-app-pub-…/…)`
    : name);
}

export function getBannerAdUnitId(): string | undefined {
  if (!isProductionAdsEnvironment) return TestIds.BANNER;
  if (Platform.OS === "android") {
    return configuredAdUnitId("EXPO_PUBLIC_ADMOB_ANDROID_BANNER_ID", process.env.EXPO_PUBLIC_ADMOB_ANDROID_BANNER_ID);
  }
  if (Platform.OS === "ios") {
    return configuredAdUnitId("EXPO_PUBLIC_ADMOB_IOS_BANNER_ID", process.env.EXPO_PUBLIC_ADMOB_IOS_BANNER_ID);
  }
  return undefined;
}

export function getRewardedAdUnitId(): string | undefined {
  if (!isProductionAdsEnvironment && !isSsvTestAdsEnvironment) return TestIds.REWARDED;
  if (isSsvTestAdsEnvironment && getAdMobTestDeviceIdentifiers().length === 0) {
    return unavailable("EXPO_PUBLIC_ADMOB_TEST_DEVICE_IDS");
  }
  if (Platform.OS === "android") {
    return configuredAdUnitId("EXPO_PUBLIC_ADMOB_ANDROID_REWARDED_ID", process.env.EXPO_PUBLIC_ADMOB_ANDROID_REWARDED_ID);
  }
  if (Platform.OS === "ios") {
    return configuredAdUnitId("EXPO_PUBLIC_ADMOB_IOS_REWARDED_ID", process.env.EXPO_PUBLIC_ADMOB_IOS_REWARDED_ID);
  }
  return undefined;
}

export function getAdMobTestDeviceIdentifiers(): string[] {
  if (!isSsvTestAdsEnvironment) return [];
  return [...new Set(
    (process.env.EXPO_PUBLIC_ADMOB_TEST_DEVICE_IDS ?? "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean)
  )];
}
