import type { ExpoConfig } from "expo/config";

const appEnvironment = process.env.EXPO_PUBLIC_APP_ENV?.trim() || "development";
const apiUrl = process.env.EXPO_PUBLIC_API_URL?.trim() || "http://localhost:4000";
const webAppUrl = process.env.EXPO_PUBLIC_WEB_APP_URL?.trim() || "http://localhost:5173";
const requiresRevenueCatConfiguration =
  appEnvironment === "production" || process.env.EXPO_PUBLIC_REQUIRE_REVENUECAT_CONFIGURATION === "true";

if (appEnvironment === "production" || requiresRevenueCatConfiguration) {
  const required = [
    ["EXPO_PUBLIC_API_URL", apiUrl],
    ["EXPO_PUBLIC_WEB_APP_URL", webAppUrl],
    ...(requiresRevenueCatConfiguration
      ? ([
          ["EXPO_PUBLIC_REVENUECAT_IOS_API_KEY", process.env.EXPO_PUBLIC_REVENUECAT_IOS_API_KEY?.trim()],
          ["EXPO_PUBLIC_REVENUECAT_ANDROID_API_KEY", process.env.EXPO_PUBLIC_REVENUECAT_ANDROID_API_KEY?.trim()]
        ] as const)
      : [])
  ] as const;
  const missing = required.filter(([, value]) => !value).map(([name]) => name);
  if (missing.length > 0) throw new Error(`Store mobile configuration is missing: ${missing.join(", ")}`);
  if ([apiUrl, webAppUrl].some((value) => /(?:localhost|127\.0\.0\.1)/i.test(value))) {
    throw new Error("Production mobile builds cannot use localhost API or web URLs.");
  }
  if (!apiUrl.startsWith("https://") || !webAppUrl.startsWith("https://")) {
    throw new Error("Production mobile API and web URLs must use HTTPS.");
  }
}

const config: ExpoConfig = {
  name: "For the Baddiez",
  slug: "persona-wrapper",
  scheme: "personawrapper",
  version: "0.1.0",
  orientation: "default",
  userInterfaceStyle: "dark",
  updates: {
    url: "https://u.expo.dev/075598af-c09e-4a7f-81b6-0151a8549441"
  },
  runtimeVersion: {
    policy: "appVersion"
  },
  ios: {
    supportsTablet: true,
    usesAppleSignIn: true,
    bundleIdentifier: "com.forthebaddiez.mobile",
    icon: "./assets/branding/FTB_logo_ios_letters_only_icon.png",
    config: {
      usesNonExemptEncryption: false
    },
    infoPlist: {
      NSMicrophoneUsageDescription: "Allow For the Baddiez to use the microphone for voice input.",
      NSPhotoLibraryUsageDescription: "Allow For the Baddiez to save generated images to your photo library.",
      NSCameraUsageDescription: "Allow For the Baddiez to use the camera to take photos for chat messages."
    }
  },
  android: {
    package: "com.forthebaddiez.mobile",
    icon: "./assets/branding/FTB_Logo_120x120.png",
    softwareKeyboardLayoutMode: "resize",
    blockedPermissions: [
      "android.permission.READ_EXTERNAL_STORAGE",
      "android.permission.READ_MEDIA_AUDIO",
      "android.permission.READ_MEDIA_IMAGES",
      "android.permission.READ_MEDIA_VIDEO"
    ],
    adaptiveIcon: {
      foregroundImage: "./assets/branding/FTB_Logo_120x120_adaptive.png",
      backgroundColor: "#09060f"
    }
  },
  plugins: [
    "expo-router",
    ["expo-screen-orientation", { initialOrientation: "DEFAULT" }],
    ["expo-localization", { supportedLocales: ["en"] }],
    "./plugins/withQuotedExpoConstantsScript",
    [
      "expo-splash-screen",
      {
        image: "./assets/branding/For_the_Baddiez_logo_runtime.png",
        resizeMode: "contain",
        backgroundColor: "#09060f"
      }
    ],
    ["expo-secure-store", { faceIDPermission: false }],
    "expo-sharing",
    "expo-status-bar",
    "expo-web-browser",
    "expo-apple-authentication",
    [
      "expo-audio",
      {
        microphonePermission: "Allow For the Baddiez to use the microphone for voice input.",
        enableBackgroundPlayback: false,
        enableBackgroundRecording: false
      }
    ],
    [
      "expo-video",
      {
        supportsBackgroundPlayback: false,
        supportsPictureInPicture: false
      }
    ],
    [
      "expo-media-library",
      {
        photosPermission: "Allow For the Baddiez to access your photo library for sharing images in chat.",
        savePhotosPermission: "Allow For the Baddiez to save generated images to your photo library.",
        granularPermissions: []
      }
    ],
    [
      "expo-image-picker",
      {
        photosPermission: false,
        cameraPermission: false
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
    appEnvironment,
    apiUrl,
    webAppUrl,
    eas: {
      projectId: "075598af-c09e-4a7f-81b6-0151a8549441"
    }
  }
};

export default config;
