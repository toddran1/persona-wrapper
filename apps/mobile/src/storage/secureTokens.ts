import * as SecureStore from "expo-secure-store";
import type { AuthTokens } from "@persona/shared";

const AUTH_TOKENS_KEY = "persona-wrapper-auth-tokens";
const DEVICE_ID_KEY = "persona-wrapper-device-id";
const OWNER_ID_KEY = "persona-wrapper-owner-id";

function createLocalId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

export async function getAuthTokens(): Promise<AuthTokens | undefined> {
  const value = await SecureStore.getItemAsync(AUTH_TOKENS_KEY);
  if (!value) return undefined;
  try {
    return JSON.parse(value) as AuthTokens;
  } catch {
    await SecureStore.deleteItemAsync(AUTH_TOKENS_KEY);
    return undefined;
  }
}

export async function setAuthTokens(tokens: AuthTokens): Promise<void> {
  await SecureStore.setItemAsync(AUTH_TOKENS_KEY, JSON.stringify(tokens));
}

export async function clearAuthTokens(): Promise<void> {
  await SecureStore.deleteItemAsync(AUTH_TOKENS_KEY);
}

export async function getDeviceId(): Promise<string> {
  const existing = await SecureStore.getItemAsync(DEVICE_ID_KEY);
  if (existing) return existing;
  const created = createLocalId("mobile");
  await SecureStore.setItemAsync(DEVICE_ID_KEY, created);
  return created;
}

export async function getOwnerId(): Promise<string> {
  const existing = await SecureStore.getItemAsync(OWNER_ID_KEY);
  if (existing) return existing;
  const created = createLocalId("owner");
  await SecureStore.setItemAsync(OWNER_ID_KEY, created);
  return created;
}
