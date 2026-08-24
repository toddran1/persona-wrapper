import { afterEach, describe, expect, it, vi } from "vitest";
import { getClientContextForMessage } from "../lib/clientContext.js";

const originalGeolocation = Object.getOwnPropertyDescriptor(navigator, "geolocation");

afterEach(() => {
  vi.restoreAllMocks();
  if (originalGeolocation) {
    Object.defineProperty(navigator, "geolocation", originalGeolocation);
  } else {
    Reflect.deleteProperty(navigator, "geolocation");
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
