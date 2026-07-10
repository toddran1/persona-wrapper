import type { ExpoConfig } from "expo/config";

const config: ExpoConfig = {
  name: "Persona Wrapper",
  slug: "persona-wrapper",
  scheme: "personawrapper",
  version: "0.1.0",
  orientation: "portrait",
  userInterfaceStyle: "dark",
  newArchEnabled: true,
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
    "expo-secure-store",
    [
      "expo-media-library",
      {
        photosPermission: "Allow Persona Wrapper to access photos for generated image downloads.",
        savePhotosPermission: "Allow Persona Wrapper to save generated images to your photo library."
      }
    ],
    [
      "expo-speech-recognition",
      {
        microphonePermission: "Allow Persona Wrapper to use the microphone for voice input.",
        speechRecognitionPermission: "Allow Persona Wrapper to transcribe your voice into chat messages.",
        androidSpeechServicePackages: ["com.google.android.googlequicksearchbox"]
      }
    ]
  ],
  experiments: {
    typedRoutes: true
  },
  extra: {
    apiUrl: process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:4000"
  }
};

export default config;
