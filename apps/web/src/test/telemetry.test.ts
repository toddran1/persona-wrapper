import { afterEach, describe, expect, it, vi } from "vitest";

async function loadTelemetry(enabled: string, sampleRate = "1") {
  vi.stubEnv("VITE_TELEMETRY_ENABLED", enabled);
  vi.stubEnv("VITE_TELEMETRY_SAMPLE_RATE", sampleRate);
  vi.resetModules();
  return import("../lib/telemetry.js");
}

describe("client telemetry transport", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("does not transmit error events when telemetry is disabled", async () => {
    const sendBeacon = vi.fn(() => true);
    Object.defineProperty(navigator, "sendBeacon", { configurable: true, value: sendBeacon });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { logClientEvent } = await loadTelemetry("false");

    logClientEvent("client_error", { level: "error", message: "failed" });

    expect(sendBeacon).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("falls back to fetch when the browser cannot queue a beacon", async () => {
    const sendBeacon = vi.fn(() => false);
    Object.defineProperty(navigator, "sendBeacon", { configurable: true, value: sendBeacon });
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 202 }));
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { logClientEvent } = await loadTelemetry("true");

    logClientEvent("client_error", { level: "error", message: "failed" });

    expect(sendBeacon).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:4000/api/observability/client-events",
      expect.objectContaining({ method: "POST", keepalive: true })
    );
  });
});
