import type { ExpoConfig } from "expo/config";

const config: ExpoConfig = {
  name: "For the Baddiez",
  slug: "persona-wrapper",
  scheme: "personawrapper",
  version: "0.1.0",
  orientation: "portrait",
  userInterfaceStyle: "dark",
  newArchEnabled: true,
  splash: {
    image: "./assets/branding/For_the_Baddiez_logo_transparent.png",
    resizeMode: "contain",
    backgroundColor: "#09060f"
  },
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
        photosPermission: "Allow For the Baddiez to access photos for generated image downloads.",
        savePhotosPermission: "Allow For the Baddiez to save generated images to your photo library."
      }
    ],
    [
      "expo-speech-recognition",
      {
        microphonePermission: "Allow For the Baddiez to use the microphone for voice input.",
        speechRecognitionPermission: "Allow For the Baddiez to transcribe your voice into chat messages.",
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
