import Constants from "expo-constants";
import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";
import { createAuthClient } from "better-auth/react";
import { usernameClient } from "better-auth/client/plugins";
import { expoClient } from "@better-auth/expo/client";

const configuredApiUrl = process.env.EXPO_PUBLIC_API_URL || Constants.expoConfig?.extra?.apiUrl;
export const MOBILE_AUTH_CALLBACK_URL = "personawrapper:///";

export const authClient = createAuthClient({
  baseURL: String(configuredApiUrl || "http://localhost:4000").replace(/\/$/, ""),
  fetchOptions: {
    headers: { "x-client-type": Platform.OS === "ios" || Platform.OS === "android" ? Platform.OS : "unknown" }
  },
  plugins: [
    usernameClient(),
    expoClient({
      scheme: "personawrapper",
      storagePrefix: "for-the-baddiez",
      cookiePrefix: "for-the-baddiez",
      storage: SecureStore
    })
  ]
});
