import { beforeEach, describe, expect, it, vi } from "vitest";

const locationRuntime = vi.hoisted(() => ({
  getForegroundPermissionsAsync: vi.fn(),
  requestForegroundPermissionsAsync: vi.fn(),
  getLastKnownPositionAsync: vi.fn(),
  getCurrentPositionAsync: vi.fn()
}));

vi.mock("expo-location", () => ({
  Accuracy: { Balanced: 3 },
  ...locationRuntime
}));

import {
  getClientContextForMessage,
  resetMobileLocationCacheForTests
} from "../features/chat/mobileClientContext";

function permission(granted: boolean) {
  return {
    granted,
    canAskAgain: true,
    expires: "never",
    status: granted ? "granted" : "undetermined"
  };
}

function position(latitude = 33.15, longitude = -96.82) {
  return {
    coords: {
      latitude,
      longitude,
      accuracy: 125,
      altitude: null,
      altitudeAccuracy: null,
      heading: null,
      speed: null
    },
    timestamp: Date.now()
  };
}

describe("mobile location-aware client context", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetMobileLocationCacheForTests();
    locationRuntime.getForegroundPermissionsAsync.mockResolvedValue(permission(true));
    locationRuntime.requestForegroundPermissionsAsync.mockResolvedValue(permission(true));
    locationRuntime.getLastKnownPositionAsync.mockResolvedValue(null);
    locationRuntime.getCurrentPositionAsync.mockResolvedValue(position());
  });

  it("does not inspect permission for an unrelated request", async () => {
    const context = await getClientContextForMessage("Rewrite this paragraph.");

    expect(context.location).toBeUndefined();
    expect(locationRuntime.getForegroundPermissionsAsync).not.toHaveBeenCalled();
  });

  it("uses an existing grant and reuses the successful location", async () => {
    const first = await getClientContextForMessage("How is the weather in my location?");
    const second = await getClientContextForMessage("Will it rain here tonight?");

    expect(first.location).toEqual({ latitude: 33.15, longitude: -96.82, accuracyMeters: 1_000 });
    expect(second.location).toEqual(first.location);
    expect(locationRuntime.requestForegroundPermissionsAsync).not.toHaveBeenCalled();
    expect(locationRuntime.getCurrentPositionAsync).toHaveBeenCalledOnce();
  });

  it("retries location acquisition once immediately after a new grant", async () => {
    locationRuntime.getForegroundPermissionsAsync.mockResolvedValue(permission(false));
    locationRuntime.getCurrentPositionAsync
      .mockRejectedValueOnce(new Error("Location provider is warming up."))
      .mockResolvedValueOnce(position());

    const context = await getClientContextForMessage("How is the weather in my location?");

    expect(locationRuntime.requestForegroundPermissionsAsync).toHaveBeenCalledOnce();
    expect(locationRuntime.getCurrentPositionAsync).toHaveBeenCalledTimes(2);
    expect(context.location).toEqual({ latitude: 33.15, longitude: -96.82, accuracyMeters: 1_000 });
  });

  it("continues without coordinates after permission is denied", async () => {
    locationRuntime.getForegroundPermissionsAsync.mockResolvedValue(permission(false));
    locationRuntime.requestForegroundPermissionsAsync.mockResolvedValue({
      ...permission(false),
      canAskAgain: false,
      status: "denied"
    });

    const context = await getClientContextForMessage("How is the weather in my location?");

    expect(context.location).toBeUndefined();
    expect(locationRuntime.getCurrentPositionAsync).not.toHaveBeenCalled();
  });
});
