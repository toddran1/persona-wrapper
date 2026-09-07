import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const adRuntime = vi.hoisted(() => ({
  instances: [] as Array<{
    listeners: Map<string, Array<(value?: unknown) => void>>;
    load: ReturnType<typeof vi.fn>;
    show: ReturnType<typeof vi.fn>;
  }>
}));

vi.mock("react-native-google-mobile-ads", () => ({
  AdEventType: { CLOSED: "closed", ERROR: "error" },
  RewardedAdEventType: { LOADED: "rewarded_loaded", EARNED_REWARD: "earned_reward" },
  RewardedAd: {
    createForAdRequest: vi.fn(() => {
      const listeners = new Map<string, Array<(value?: unknown) => void>>();
      const instance = {
        listeners,
        load: vi.fn(),
        show: vi.fn().mockResolvedValue(undefined),
        addAdEventListener: vi.fn((event: string, listener: (value?: unknown) => void) => {
          const eventListeners = listeners.get(event) ?? [];
          eventListeners.push(listener);
          listeners.set(event, eventListeners);
          return () => listeners.set(event, (listeners.get(event) ?? []).filter((candidate) => candidate !== listener));
        })
      };
      adRuntime.instances.push(instance);
      return instance;
    })
  }
}));

vi.mock("../advertising/config", () => ({ getRewardedAdUnitId: () => "test-rewarded-unit" }));
vi.mock("../advertising/mobileAds", () => ({ initializeMobileAds: vi.fn().mockResolvedValue(true) }));

import { cancelRewardedAd, loadRewardedAd } from "../advertising/rewardedAds";

const context = {
  authenticated: true,
  billingCatalog: { currentPlanId: "bronze" } as never,
  ssvUserId: "user_test",
  ssvCustomData: "session_test"
};

async function waitForAdCreation(): Promise<void> {
  for (let attempt = 0; attempt < 5 && adRuntime.instances.length === 0; attempt += 1) {
    await Promise.resolve();
  }
}

describe("rewarded ad lifecycle", () => {
  beforeEach(() => {
    adRuntime.instances.length = 0;
  });

  afterEach(() => {
    cancelRewardedAd();
    vi.useRealTimers();
  });

  it("settles a pending load when account lifecycle cancellation clears the ad", async () => {
    const loading = loadRewardedAd(context);
    await waitForAdCreation();

    cancelRewardedAd();

    await expect(loading).resolves.toBe(false);
  });

  it("times out a stalled SDK load and allows the caller to recover", async () => {
    vi.useFakeTimers();
    const onLoadError = vi.fn();
    const loading = loadRewardedAd(context, { onLoadError });
    await waitForAdCreation();

    await vi.advanceTimersByTimeAsync(20_000);

    await expect(loading).resolves.toBe(false);
    expect(onLoadError).toHaveBeenCalledWith(expect.objectContaining({
      message: "Rewarded ad loading timed out."
    }));
  });
});
