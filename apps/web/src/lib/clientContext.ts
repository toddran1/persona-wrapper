import { requestMayNeedLocation, type ClientContext } from "@persona/shared";

const LOCATION_CACHE_MS = 10 * 60 * 1000;
const LOCATION_TIMEOUT_MS = 8_000;

function baseClientContext(): ClientContext {
  const now = new Date();
  return {
    locale: navigator.language,
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    currentDateTime: now.toISOString(),
    utcOffsetMinutes: -now.getTimezoneOffset()
  };
}

function roundCoordinate(value: number): number {
  return Math.round(value * 100) / 100;
}

function abortError(): Error {
  const error = new Error("The location request was canceled.");
  error.name = "AbortError";
  return error;
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw abortError();
}

function currentBrowserLocation(signal?: AbortSignal): Promise<ClientContext["location"] | undefined> {
  throwIfAborted(signal);
  if (!("geolocation" in navigator)) return Promise.resolve(undefined);

  return new Promise((resolve, reject) => {
    const onAbort = () => reject(abortError());
    signal?.addEventListener("abort", onAbort, { once: true });
    const finish = (location: ClientContext["location"] | undefined) => {
      signal?.removeEventListener("abort", onAbort);
      resolve(location);
    };
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const latitude = roundCoordinate(position.coords.latitude);
        const longitude = roundCoordinate(position.coords.longitude);
        if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
          finish(undefined);
          return;
        }
        const reportedAccuracy = Number.isFinite(position.coords.accuracy)
          ? Math.round(position.coords.accuracy)
          : 1_000;
        finish({
          latitude,
          longitude,
          accuracyMeters: Math.max(1_000, reportedAccuracy)
        });
      },
      () => finish(undefined),
      { enableHighAccuracy: false, maximumAge: LOCATION_CACHE_MS, timeout: LOCATION_TIMEOUT_MS }
    );
  });
}

export async function getClientContextForMessage(message: string, signal?: AbortSignal): Promise<ClientContext> {
  const context = baseClientContext();
  if (!requestMayNeedLocation(message)) return context;
  try {
    const location = await currentBrowserLocation(signal);
    throwIfAborted(signal);
    return location ? { ...context, location } : context;
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") throw error;
    return context;
  }
}
