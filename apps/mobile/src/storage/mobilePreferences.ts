import AsyncStorage from "@react-native-async-storage/async-storage";
import * as SecureStore from "expo-secure-store";
import type { AuthUser } from "@persona/shared";

const LANDSCAPE_LAYOUT_KEY = "persona-wrapper-landscape-layout-enabled";
const CACHED_AUTH_USER_KEY = "persona-wrapper-cached-auth-user";

export async function getLandscapeLayoutEnabled(): Promise<boolean> {
  return (await SecureStore.getItemAsync(LANDSCAPE_LAYOUT_KEY)) === "true";
}

export async function setLandscapeLayoutEnabled(enabled: boolean): Promise<void> {
  await SecureStore.setItemAsync(LANDSCAPE_LAYOUT_KEY, enabled ? "true" : "false");
}

// Last successfully verified account profile. Used to offer a read-only
// offline mode when the app launches without connectivity; cleared on every
// explicit sign-out.
export async function getCachedAuthUser(): Promise<AuthUser | undefined> {
  const raw = await AsyncStorage.getItem(CACHED_AUTH_USER_KEY);
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw) as Partial<AuthUser>;
    return typeof parsed.id === "string" && parsed.id ? (parsed as AuthUser) : undefined;
  } catch {
    return undefined;
  }
}

export async function setCachedAuthUser(user: AuthUser): Promise<void> {
  await AsyncStorage.setItem(CACHED_AUTH_USER_KEY, JSON.stringify(user));
}

export async function clearCachedAuthUser(): Promise<void> {
  await AsyncStorage.removeItem(CACHED_AUTH_USER_KEY);
}
