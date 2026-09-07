import { requestMayNeedLocation, type ClientContext } from "@persona/shared";

const LOCATION_CACHE_MS = 30 * 60 * 1000;
const LOCATION_ACQUISITION_TIMEOUT_MS = 15_000;
const LOCATION_PERMISSION_TIMEOUT_MS = 60_000;
let cachedLocation: { location: NonNullable<ClientContext["location"]>; capturedAt: number } | undefined;

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

async function browserLocationPermissionState(): Promise<PermissionState | undefined> {
  if (!("permissions" in navigator)) return undefined;
  try {
    const permission = await navigator.permissions.query({ name: "geolocation" });
    return permission.state;
  } catch {
    return undefined;
  }
}

function requestBrowserLocation(
  timeout: number,
  signal?: AbortSignal
): Promise<ClientContext["location"] | undefined> {
  throwIfAborted(signal);
  if (!("geolocation" in navigator)) return Promise.resolve(undefined);

  return new Promise((resolve, reject) => {
    let settled = false;
    const onAbort = () => {
      if (settled) return;
      settled = true;
      reject(abortError());
    };
    signal?.addEventListener("abort", onAbort, { once: true });
    const finish = (location: ClientContext["location"] | undefined) => {
      if (settled) return;
      settled = true;
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
      { enableHighAccuracy: false, maximumAge: LOCATION_CACHE_MS, timeout }
    );
  });
}

async function currentBrowserLocation(signal?: AbortSignal): Promise<ClientContext["location"] | undefined> {
  throwIfAborted(signal);
  if (!("geolocation" in navigator)) return undefined;
  if (cachedLocation && Date.now() - cachedLocation.capturedAt < LOCATION_CACHE_MS) {
    return cachedLocation.location;
  }

  const initialPermission = await browserLocationPermissionState();
  throwIfAborted(signal);
  if (initialPermission === "denied") return undefined;
  // If the browser treated an earlier approval as one-time and later reports
  // "prompt" again, keep using the already approved approximate location for
  // this SPA session instead of opening another permission dialog. A durable
  // browser grant still refreshes stale coordinates silently below.
  if (initialPermission === "prompt" && cachedLocation) return cachedLocation.location;

  let location = await requestBrowserLocation(
    initialPermission === "prompt" ? LOCATION_PERMISSION_TIMEOUT_MS : LOCATION_ACQUISITION_TIMEOUT_MS,
    signal
  );
  throwIfAborted(signal);

  // Chromium can report a timeout from the request that opened the permission
  // prompt even though the user granted access while that request was active.
  // Re-check and retry once so the chat is not submitted without coordinates.
  if (!location && initialPermission !== "granted" && await browserLocationPermissionState() === "granted") {
    location = await requestBrowserLocation(LOCATION_ACQUISITION_TIMEOUT_MS, signal);
    throwIfAborted(signal);
  }

  if (location) cachedLocation = { location, capturedAt: Date.now() };
  return location;
}

export function resetClientLocationCacheForTests(): void {
  cachedLocation = undefined;
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
