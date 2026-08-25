import type { MobileUpdatePolicy } from "@persona/shared";
import { env } from "../config/env.js";

type MobilePlatform = MobileUpdatePolicy["platform"];

export function getMobileUpdatePolicy(platform: MobilePlatform, installedBuild: number): MobileUpdatePolicy {
  const isIos = platform === "ios";
  const latestBuild = isIos ? env.MOBILE_IOS_LATEST_BUILD : env.MOBILE_ANDROID_LATEST_BUILD;
  const minimumSupportedBuild = isIos ? env.MOBILE_IOS_MINIMUM_BUILD : env.MOBILE_ANDROID_MINIMUM_BUILD;
  const storeUrl = isIos ? env.MOBILE_IOS_STORE_URL : env.MOBILE_ANDROID_STORE_URL;
  const status = installedBuild < minimumSupportedBuild
    ? "required"
    : installedBuild < latestBuild
      ? "optional"
      : "current";
  return {
    platform,
    installedBuild,
    latestBuild,
    minimumSupportedBuild,
    status,
    message: status === "required"
      ? "This version is no longer supported. Update For the Baddiez to continue."
      : env.MOBILE_UPDATE_MESSAGE,
    ...(storeUrl ? { storeUrl } : {}),
    policyVersion: env.MOBILE_UPDATE_POLICY_VERSION,
    checkedAt: new Date().toISOString()
  };
}
