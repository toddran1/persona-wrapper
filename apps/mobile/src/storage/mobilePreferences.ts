import * as SecureStore from "expo-secure-store";

const LANDSCAPE_LAYOUT_KEY = "persona-wrapper-landscape-layout-enabled";

export async function getLandscapeLayoutEnabled(): Promise<boolean> {
  return (await SecureStore.getItemAsync(LANDSCAPE_LAYOUT_KEY)) === "true";
}

export async function setLandscapeLayoutEnabled(enabled: boolean): Promise<void> {
  await SecureStore.setItemAsync(LANDSCAPE_LAYOUT_KEY, enabled ? "true" : "false");
}
