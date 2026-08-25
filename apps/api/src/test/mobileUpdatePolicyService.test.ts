import { describe, expect, it, vi } from "vitest";

vi.mock("../config/env.js", () => ({
  env: {
    MOBILE_IOS_LATEST_BUILD: 12,
    MOBILE_IOS_MINIMUM_BUILD: 10,
    MOBILE_IOS_STORE_URL: "https://apps.apple.com/app/id123456789",
    MOBILE_ANDROID_LATEST_BUILD: 24,
    MOBILE_ANDROID_MINIMUM_BUILD: 20,
    MOBILE_ANDROID_STORE_URL: "https://play.google.com/store/apps/details?id=com.forthebaddiez.mobile",
    MOBILE_UPDATE_MESSAGE: "A newer version is available.",
    MOBILE_UPDATE_POLICY_VERSION: "test-1"
  }
}));

import { getMobileUpdatePolicy } from "../services/mobileUpdatePolicyService.js";

describe("mobile update policy", () => {
  it("requires builds below the minimum", () => {
    expect(getMobileUpdatePolicy("ios", 9).status).toBe("required");
  });

  it("offers an optional update between minimum and latest", () => {
    expect(getMobileUpdatePolicy("android", 22).status).toBe("optional");
  });

  it("accepts the latest and newer builds", () => {
    expect(getMobileUpdatePolicy("android", 24).status).toBe("current");
    expect(getMobileUpdatePolicy("android", 25).status).toBe("current");
  });
});
