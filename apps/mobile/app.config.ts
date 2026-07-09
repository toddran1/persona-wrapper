import type { ExpoConfig } from "expo/config";

const config: ExpoConfig = {
  name: "Persona Wrapper",
  slug: "persona-wrapper",
  scheme: "personawrapper",
  version: "0.1.0",
  orientation: "portrait",
  userInterfaceStyle: "dark",
  ios: {
    supportsTablet: true,
    bundleIdentifier: "com.personawrapper.mobile"
  },
  android: {
    package: "com.personawrapper.mobile",
    adaptiveIcon: {
      backgroundColor: "#09060f"
    }
  },
  plugins: [
    "expo-router",
    "expo-secure-store"
  ],
  experiments: {
    typedRoutes: true
  },
  extra: {
    apiUrl: process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:4000"
  }
};

export default config;
