import * as SecureStore from "expo-secure-store";
import type { AuthTokens } from "@persona/shared";

const AUTH_TOKENS_KEY = "persona-wrapper-auth-tokens";
const DEVICE_ID_KEY = "persona-wrapper-device-id";
const OWNER_ID_KEY = "persona-wrapper-owner-id";
const SELECTED_CONVERSATION_ID_KEY = "persona-wrapper-selected-conversation-id";
const PENDING_MOBILE_OAUTH_KEY = "persona-wrapper-pending-mobile-oauth";

export type PendingMobileOAuth = {
  exchangeCode: string;
  startedAt: number;
  callbackReceivedAt?: number;
};

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

export async function getSelectedConversationId(): Promise<string | undefined> {
  return await SecureStore.getItemAsync(SELECTED_CONVERSATION_ID_KEY) ?? undefined;
}

export async function setSelectedConversationId(conversationId: string): Promise<void> {
  await SecureStore.setItemAsync(SELECTED_CONVERSATION_ID_KEY, conversationId);
}

export async function clearSelectedConversationId(): Promise<void> {
  await SecureStore.deleteItemAsync(SELECTED_CONVERSATION_ID_KEY);
}

export async function getPendingMobileOAuth(): Promise<PendingMobileOAuth | undefined> {
  const value = await SecureStore.getItemAsync(PENDING_MOBILE_OAUTH_KEY);
  if (!value) return undefined;
  try {
    const parsed = JSON.parse(value) as Partial<PendingMobileOAuth>;
    if (typeof parsed.exchangeCode !== "string" || !parsed.exchangeCode || typeof parsed.startedAt !== "number") {
      throw new Error("Invalid pending OAuth state.");
    }
    return {
      exchangeCode: parsed.exchangeCode,
      startedAt: parsed.startedAt,
      ...(typeof parsed.callbackReceivedAt === "number" ? { callbackReceivedAt: parsed.callbackReceivedAt } : {})
    };
  } catch {
    await SecureStore.deleteItemAsync(PENDING_MOBILE_OAUTH_KEY);
    return undefined;
  }
}

export async function setPendingMobileOAuth(exchangeCode: string): Promise<void> {
  await SecureStore.setItemAsync(PENDING_MOBILE_OAUTH_KEY, JSON.stringify({ exchangeCode, startedAt: Date.now() }));
}

export async function markPendingMobileOAuthCallbackReceived(): Promise<void> {
  const pending = await getPendingMobileOAuth();
  if (!pending) return;
  await SecureStore.setItemAsync(PENDING_MOBILE_OAUTH_KEY, JSON.stringify({
    ...pending,
    callbackReceivedAt: Date.now()
  }));
}

export async function clearPendingMobileOAuth(): Promise<void> {
  await SecureStore.deleteItemAsync(PENDING_MOBILE_OAUTH_KEY);
}
