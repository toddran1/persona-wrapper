import { requestMayNeedLocation, type ClientContext } from "@persona/shared";
import * as Location from "expo-location";
import { getClientContext } from "./mobileChatUtils";

const LOCATION_CACHE_MS = 10 * 60 * 1000;
const LOCATION_TIMEOUT_MS = 8_000;
let cachedLocation: { location: NonNullable<ClientContext["location"]>; capturedAt: number } | undefined;

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

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, signal?: AbortSignal): Promise<T | undefined> {
  throwIfAborted(signal);
  return new Promise((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout>;
    const onAbort = () => {
      clearTimeout(timer);
      reject(abortError());
    };
    signal?.addEventListener("abort", onAbort, { once: true });
    const finish = (value: T | undefined) => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      resolve(value);
    };
    timer = setTimeout(() => finish(undefined), timeoutMs);
    promise.then(
      (value) => finish(value),
      () => finish(undefined)
    );
  });
}

async function currentDeviceLocation(signal?: AbortSignal): Promise<ClientContext["location"] | undefined> {
  try {
    throwIfAborted(signal);
    const existing = await Location.getForegroundPermissionsAsync();
    throwIfAborted(signal);
    const permission = existing.granted ? existing : await Location.requestForegroundPermissionsAsync();
    throwIfAborted(signal);
    if (!permission.granted) return undefined;
    if (cachedLocation && Date.now() - cachedLocation.capturedAt < LOCATION_CACHE_MS) {
      return cachedLocation.location;
    }

    const lastKnown = await Location.getLastKnownPositionAsync({
      maxAge: LOCATION_CACHE_MS,
      requiredAccuracy: 5_000
    }).catch(() => null);
    throwIfAborted(signal);
    const position = lastKnown ?? await withTimeout(
      Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }),
      LOCATION_TIMEOUT_MS,
      signal
    );
    if (!position) return undefined;

    const latitude = roundCoordinate(position.coords.latitude);
    const longitude = roundCoordinate(position.coords.longitude);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return undefined;
    const reportedAccuracy = Number.isFinite(position.coords.accuracy)
      ? Math.round(position.coords.accuracy ?? 1_000)
      : 1_000;
    const location = {
      latitude,
      longitude,
      accuracyMeters: Math.max(1_000, reportedAccuracy)
    };
    cachedLocation = { location, capturedAt: Date.now() };
    return location;
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") throw error;
    return undefined;
  }
}

export async function getClientContextForMessage(message: string, signal?: AbortSignal): Promise<ClientContext> {
  const context = getClientContext();
  if (!requestMayNeedLocation(message)) return context;
  const location = await currentDeviceLocation(signal);
  throwIfAborted(signal);
  return location ? { ...context, location } : context;
}
