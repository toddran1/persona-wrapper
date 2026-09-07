import { afterEach, describe, expect, it, vi } from "vitest";
import { getClientContextForMessage, resetClientLocationCacheForTests } from "../lib/clientContext.js";

const originalGeolocation = Object.getOwnPropertyDescriptor(navigator, "geolocation");
const originalPermissions = Object.getOwnPropertyDescriptor(navigator, "permissions");

function position(latitude = 33.15, longitude = -96.82): GeolocationPosition {
  return {
    coords: {
      latitude,
      longitude,
      accuracy: 125,
      altitude: null,
      altitudeAccuracy: null,
      heading: null,
      speed: null,
      toJSON: () => ({})
    },
    timestamp: Date.now(),
    toJSON: () => ({})
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  resetClientLocationCacheForTests();
  if (originalGeolocation) {
    Object.defineProperty(navigator, "geolocation", originalGeolocation);
  } else {
    Reflect.deleteProperty(navigator, "geolocation");
  }
  if (originalPermissions) {
    Object.defineProperty(navigator, "permissions", originalPermissions);
  } else {
    Reflect.deleteProperty(navigator, "permissions");
  }
});

describe("location-aware client context", () => {
  it("does not touch geolocation for an unrelated request", async () => {
    const getCurrentPosition = vi.fn();
    Object.defineProperty(navigator, "geolocation", {
      configurable: true,
      value: { getCurrentPosition }
    });

    const context = await getClientContextForMessage("Help me rewrite this paragraph.");

    expect(getCurrentPosition).not.toHaveBeenCalled();
    expect(context.location).toBeUndefined();
  });

  it("continues without location when the browser blocks geolocation", async () => {
    Object.defineProperty(navigator, "geolocation", {
      configurable: true,
      value: {
        getCurrentPosition: () => {
          throw new Error("Geolocation is blocked by Permissions Policy.");
        }
      }
    });

    const context = await getClientContextForMessage("How is the weather today?");

    expect(context.location).toBeUndefined();
  });

  it("reuses a successful location without asking the browser again", async () => {
    const getCurrentPosition = vi.fn((success: PositionCallback) => success(position()));
    Object.defineProperty(navigator, "geolocation", {
      configurable: true,
      value: { getCurrentPosition }
    });
    Object.defineProperty(navigator, "permissions", {
      configurable: true,
      value: { query: vi.fn(async () => ({ state: "granted" })) }
    });

    const first = await getClientContextForMessage("How is the weather today in my location?");
    const second = await getClientContextForMessage("Will it rain here tonight?");

    expect(first.location).toEqual({ latitude: 33.15, longitude: -96.82, accuracyMeters: 1_000 });
    expect(second.location).toEqual(first.location);
    expect(getCurrentPosition).toHaveBeenCalledOnce();
  });

  it("does not re-prompt during the SPA session if a one-time grant later returns to prompt", async () => {
    let now = 1_000;
    vi.spyOn(Date, "now").mockImplementation(() => now);
    const query = vi.fn()
      .mockResolvedValueOnce({ state: "granted" })
      .mockResolvedValueOnce({ state: "prompt" });
    const getCurrentPosition = vi.fn((success: PositionCallback) => success(position()));
    Object.defineProperty(navigator, "permissions", {
      configurable: true,
      value: { query }
    });
    Object.defineProperty(navigator, "geolocation", {
      configurable: true,
      value: { getCurrentPosition }
    });

    const first = await getClientContextForMessage("How is the weather today in my location?");
    now += 31 * 60 * 1_000;
    const second = await getClientContextForMessage("How is the weather here now?");

    expect(second.location).toEqual(first.location);
    expect(query).toHaveBeenCalledTimes(2);
    expect(getCurrentPosition).toHaveBeenCalledOnce();
  });

  it("retries when permission becomes granted while the first location request times out", async () => {
    const query = vi.fn()
      .mockResolvedValueOnce({ state: "prompt" })
      .mockResolvedValueOnce({ state: "granted" });
    let attempt = 0;
    const getCurrentPosition = vi.fn((success: PositionCallback, failure: PositionErrorCallback) => {
      attempt += 1;
      if (attempt === 1) {
        failure({ code: 3, message: "Timed out", PERMISSION_DENIED: 1, POSITION_UNAVAILABLE: 2, TIMEOUT: 3 });
        return;
      }
      success(position());
    });
    Object.defineProperty(navigator, "permissions", {
      configurable: true,
      value: { query }
    });
    Object.defineProperty(navigator, "geolocation", {
      configurable: true,
      value: { getCurrentPosition }
    });

    const context = await getClientContextForMessage("How is the weather today in my location?");

    expect(context.location).toEqual({ latitude: 33.15, longitude: -96.82, accuracyMeters: 1_000 });
    expect(getCurrentPosition).toHaveBeenCalledTimes(2);
  });

  it("does not reopen geolocation after the browser has denied it", async () => {
    const getCurrentPosition = vi.fn();
    Object.defineProperty(navigator, "permissions", {
      configurable: true,
      value: { query: vi.fn(async () => ({ state: "denied" })) }
    });
    Object.defineProperty(navigator, "geolocation", {
      configurable: true,
      value: { getCurrentPosition }
    });

    const context = await getClientContextForMessage("How is the weather today in my location?");

    expect(context.location).toBeUndefined();
    expect(getCurrentPosition).not.toHaveBeenCalled();
  });

  it("cancels location acquisition when the chat request is stopped", async () => {
    const controller = new AbortController();
    Object.defineProperty(navigator, "geolocation", {
      configurable: true,
      value: { getCurrentPosition: vi.fn() }
    });
    controller.abort();

    await expect(getClientContextForMessage("How is the weather today?", controller.signal))
      .rejects.toMatchObject({ name: "AbortError" });
  });
});
