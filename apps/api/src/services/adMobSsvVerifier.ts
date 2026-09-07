import { createPublicKey, verify as verifySignature } from "node:crypto";
import { env } from "../config/env.js";
import { HttpError } from "../utils/httpError.js";

type VerificationKeyResponse = { keys?: Array<{ keyId?: unknown; pem?: unknown }> };

type VerifiedAdMobCallbackFields = {
  adUnit: string;
  keyId: string;
  rewardAmount: number;
  rewardItem: string;
  timestamp: Date;
  transactionId: string;
};

export type VerifiedAdMobCallback = VerifiedAdMobCallbackFields & (
  | { kind: "reward"; customData: string; userId: string }
  | { kind: "unattributed"; customData?: string; userId?: string }
);

const TEST_REWARDED_UNITS = [
  "ca-app-pub-3940256099942544/5224354917",
  "ca-app-pub-3940256099942544/1712485313"
];
const KEY_CACHE_TTL_MS = 12 * 60 * 60 * 1000;
const KEY_STALE_FALLBACK_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const KEY_REFRESH_BACKOFF_MS = 60 * 1000;
let cachedKeys = new Map<number, string>();
let cachedKeysAt = 0;
let lastKeyFetchAttemptAt = 0;
let keyRefreshPromise: Promise<Map<number, string>> | undefined;

function adUnitSuffix(value: string): string {
  return value.split("/").at(-1) ?? value;
}

function expectedRewardedAdUnits(): Set<string> {
  const configured = [
    env.ADMOB_ANDROID_REWARDED_AD_UNIT_ID,
    env.ADMOB_IOS_REWARDED_AD_UNIT_ID
  ].filter((value): value is string => Boolean(value));
  const allowed = env.NODE_ENV === "production" ? configured : [...configured, ...TEST_REWARDED_UNITS];
  if (allowed.length === 0) throw new HttpError("AdMob rewarded verification is not configured.", 503);
  return new Set(allowed.flatMap((value) => [value, adUnitSuffix(value)]));
}

async function fetchVerificationKeys(): Promise<Map<number, string>> {
  let response: Response;
  try {
    response = await fetch(env.ADMOB_SSV_PUBLIC_KEYS_URL, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(5_000)
    });
  } catch {
    throw new HttpError("AdMob verification keys are temporarily unavailable.", 503);
  }
  if (!response.ok) throw new HttpError("AdMob verification keys are temporarily unavailable.", 503);
  let payload: VerificationKeyResponse;
  try {
    payload = await response.json() as VerificationKeyResponse;
  } catch {
    throw new HttpError("AdMob verification keys are temporarily unavailable.", 503);
  }
  const keys = new Map<number, string>();
  for (const candidate of payload.keys ?? []) {
    if (typeof candidate.keyId === "number" && Number.isSafeInteger(candidate.keyId) && typeof candidate.pem === "string") {
      keys.set(candidate.keyId, candidate.pem);
    }
  }
  if (keys.size === 0) throw new HttpError("AdMob verification keys are temporarily unavailable.", 503);
  cachedKeys = keys;
  cachedKeysAt = Date.now();
  return keys;
}

async function refreshVerificationKeys(now: number): Promise<Map<number, string> | undefined> {
  if (keyRefreshPromise) return keyRefreshPromise;
  if (lastKeyFetchAttemptAt > 0 && now - lastKeyFetchAttemptAt < KEY_REFRESH_BACKOFF_MS) return undefined;
  lastKeyFetchAttemptAt = now;
  keyRefreshPromise = fetchVerificationKeys().finally(() => {
    keyRefreshPromise = undefined;
  });
  return keyRefreshPromise;
}

async function verificationKey(keyId: number): Promise<string> {
  const now = Date.now();
  const cacheFresh = cachedKeys.size > 0 && now - cachedKeysAt < KEY_CACHE_TTL_MS;
  const cached = now - cachedKeysAt <= KEY_STALE_FALLBACK_MAX_AGE_MS ? cachedKeys.get(keyId) : undefined;
  if (cacheFresh && cached) return cached;
  try {
    const refreshed = await refreshVerificationKeys(now);
    if (refreshed) {
      const key = refreshed.get(keyId);
      if (key) return key;
      throw new HttpError("AdMob callback signing key is not recognized.", 400);
    }
  } catch (error) {
    // A previously trusted key remains safer than dropping valid callbacks
    // during a transient Google key-service outage. The refresh backoff still
    // prevents an untrusted public request from amplifying that outage.
    if (cached) return cached;
    throw error;
  }
  if (cached) return cached;
  throw new HttpError("AdMob verification keys are temporarily unavailable.", 503);
}

function oneRequired(params: URLSearchParams, name: string): string {
  const values = params.getAll(name);
  if (values.length !== 1 || !values[0]) throw new HttpError(`Invalid AdMob callback parameter: ${name}.`, 400);
  return values[0];
}

function oneOptional(params: URLSearchParams, name: string): string | undefined {
  const values = params.getAll(name);
  if (values.length > 1 || (values.length === 1 && !values[0])) {
    throw new HttpError(`Invalid AdMob callback parameter: ${name}.`, 400);
  }
  return values[0];
}

function decodeRawValue(value: string): string {
  try {
    return decodeURIComponent(value.replace(/\+/g, "%20"));
  } catch {
    throw new HttpError("AdMob callback encoding is invalid.", 400);
  }
}

export async function verifyAdMobSsvQuery(rawQuery: string, now = new Date()): Promise<VerifiedAdMobCallback> {
  const signatureMarker = "&signature=";
  const keyMarker = "&key_id=";
  const signatureIndex = rawQuery.lastIndexOf(signatureMarker);
  const keyIndex = rawQuery.indexOf(keyMarker, signatureIndex + signatureMarker.length);
  if (signatureIndex <= 0 || keyIndex <= signatureIndex || rawQuery.indexOf("&", keyIndex + keyMarker.length) !== -1) {
    throw new HttpError("AdMob callback signature parameters are invalid.", 400);
  }

  const signedContent = rawQuery.slice(0, signatureIndex);
  const signatureValue = decodeRawValue(rawQuery.slice(signatureIndex + signatureMarker.length, keyIndex));
  const keyIdValue = decodeRawValue(rawQuery.slice(keyIndex + keyMarker.length));
  const keyId = Number(keyIdValue);
  if (!Number.isSafeInteger(keyId) || keyId < 0) throw new HttpError("AdMob callback key ID is invalid.", 400);

  const publicKeyPem = await verificationKey(keyId);
  if (!/^[A-Za-z0-9_-]+={0,2}$/.test(signatureValue)) {
    throw new HttpError("AdMob callback signature is invalid.", 400);
  }
  let verified = false;
  try {
    verified = verifySignature(
      "sha256",
      Buffer.from(signedContent, "utf8"),
      createPublicKey(publicKeyPem),
      Buffer.from(signatureValue, "base64url")
    );
  } catch {
    throw new HttpError("AdMob callback signature is invalid.", 400);
  }
  if (!verified) throw new HttpError("AdMob callback signature is invalid.", 400);

  const params = new URLSearchParams(signedContent);
  const adUnit = oneRequired(params, "ad_unit");
  if (!expectedRewardedAdUnits().has(adUnit)) throw new HttpError("AdMob callback ad unit is not authorized.", 400);
  const rewardAmount = Number(oneRequired(params, "reward_amount"));
  if (!Number.isFinite(rewardAmount) || rewardAmount < 0) throw new HttpError("AdMob reward amount is invalid.", 400);
  const timestampValue = Number(oneRequired(params, "timestamp"));
  if (!Number.isFinite(timestampValue) || timestampValue <= 0) throw new HttpError("AdMob callback timestamp is invalid.", 400);
  // Current AdMob examples use microseconds despite labeling the field as ms.
  const timestampMs = timestampValue > now.getTime() * 100 ? Math.floor(timestampValue / 1_000) : timestampValue;
  if (timestampMs > now.getTime() + 5 * 60 * 1000 || timestampMs < now.getTime() - env.ADMOB_SSV_MAX_AGE_MS) {
    throw new HttpError("AdMob callback timestamp is outside the accepted window.", 400);
  }

  const customData = oneOptional(params, "custom_data");
  const userId = oneOptional(params, "user_id");
  const callback = {
    adUnit,
    keyId: keyIdValue,
    rewardAmount,
    rewardItem: oneRequired(params, "reward_item"),
    timestamp: new Date(timestampMs),
    transactionId: oneRequired(params, "transaction_id")
  };
  return customData && userId
    ? { ...callback, kind: "reward", customData, userId }
    : { ...callback, kind: "unattributed", ...(customData ? { customData } : {}), ...(userId ? { userId } : {}) };
}

export function resetAdMobSsvKeyCacheForTests(): void {
  cachedKeys = new Map();
  cachedKeysAt = 0;
  lastKeyFetchAttemptAt = 0;
  keyRefreshPromise = undefined;
}
