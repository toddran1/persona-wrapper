import type { ExpoConfig } from "expo/config";

const appEnvironment = process.env.EXPO_PUBLIC_APP_ENV?.trim() || "development";
const apiUrl = process.env.EXPO_PUBLIC_API_URL?.trim() || "http://localhost:4000";
const webAppUrl = process.env.EXPO_PUBLIC_WEB_APP_URL?.trim() || "http://localhost:5173";
const GOOGLE_TEST_ANDROID_APP_ID = "ca-app-pub-3940256099942544~3347511713";
const GOOGLE_TEST_IOS_APP_ID = "ca-app-pub-3940256099942544~1458002511";
const ADMOB_APP_ID_PATTERN = /^ca-app-pub-\d{16}~\d{10}$/;
// Keep aligned with Google's current iOS third-party buyer list. These enable
// privacy-preserving install attribution through SKAdNetwork without IDFA.
const ADMOB_SK_AD_NETWORK_ITEMS = [
  "cstr6suwn9.skadnetwork",
  "4fzdc2evr5.skadnetwork",
  "2fnua5tdw4.skadnetwork",
  "ydx93a7ass.skadnetwork",
  "p78axxw29g.skadnetwork",
  "v72qych5uu.skadnetwork",
  "ludvb6z3bs.skadnetwork",
  "cp8zw746q7.skadnetwork",
  "3sh42y64q3.skadnetwork",
  "c6k4g5qg8m.skadnetwork",
  "s39g8k73mm.skadnetwork",
  "wg4vff78zm.skadnetwork",
  "3qy4746246.skadnetwork",
  "f38h382jlk.skadnetwork",
  "hs6bdukanm.skadnetwork",
  "mlmmfzh3r3.skadnetwork",
  "v4nxqhlyqp.skadnetwork",
  "wzmmz9fp6w.skadnetwork",
  "su67r6k2v3.skadnetwork",
  "yclnxrl5pm.skadnetwork",
  "t38b2kh725.skadnetwork",
  "7ug5zh24hu.skadnetwork",
  "gta9lk7p23.skadnetwork",
  "vutu7akeur.skadnetwork",
  "y5ghdn5j9k.skadnetwork",
  "v9wttpbfk9.skadnetwork",
  "n38lu8286q.skadnetwork",
  "47vhws6wlr.skadnetwork",
  "kbd757ywx3.skadnetwork",
  "9t245vhmpl.skadnetwork",
  "a2p9lx4jpn.skadnetwork",
  "22mmun2rn5.skadnetwork",
  "44jx6755aq.skadnetwork",
  "k674qkevps.skadnetwork",
  "4468km3ulz.skadnetwork",
  "2u9pt9hc89.skadnetwork",
  "8s468mfl3y.skadnetwork",
  "klf5c3l5u5.skadnetwork",
  "ppxm28t8ap.skadnetwork",
  "kbmxgpxpgc.skadnetwork",
  "uw77j35x4d.skadnetwork",
  "578prtvx9j.skadnetwork",
  "4dzt52r2t5.skadnetwork",
  "tl55sbb4fm.skadnetwork",
  "c3frkrj4fj.skadnetwork",
  "e5fvkxwrpn.skadnetwork",
  "8c4e2ghe7u.skadnetwork",
  "3rd42ekr43.skadnetwork",
  "97r2b46745.skadnetwork",
  "3qcr597p9d.skadnetwork"
];
const admobAndroidAppId = appEnvironment === "production"
  ? process.env.EXPO_PUBLIC_ADMOB_ANDROID_APP_ID?.trim()
  : GOOGLE_TEST_ANDROID_APP_ID;
const admobIosAppId = appEnvironment === "production"
  ? process.env.EXPO_PUBLIC_ADMOB_IOS_APP_ID?.trim()
  : GOOGLE_TEST_IOS_APP_ID;
if (appEnvironment === "production") {
  const required = [
    ["EXPO_PUBLIC_API_URL", apiUrl],
    ["EXPO_PUBLIC_WEB_APP_URL", webAppUrl],
    ["EXPO_PUBLIC_ADMOB_ANDROID_APP_ID", admobAndroidAppId],
    ["EXPO_PUBLIC_ADMOB_IOS_APP_ID", admobIosAppId]
  ] as const;
  const missing = required.filter(([, value]) => !value).map(([name]) => name);
  if (missing.length > 0) throw new Error(`Store mobile configuration is missing: ${missing.join(", ")}`);
  const invalidAppIds = [
    ["EXPO_PUBLIC_ADMOB_ANDROID_APP_ID", admobAndroidAppId],
    ["EXPO_PUBLIC_ADMOB_IOS_APP_ID", admobIosAppId]
  ].filter(([, value]) => value && !ADMOB_APP_ID_PATTERN.test(value)).map(([name]) => name);
  if (invalidAppIds.length > 0) {
    throw new Error(`Invalid AdMob app ID format: ${invalidAppIds.join(", ")}. App IDs must use ca-app-pub-…~… format.`);
  }
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
      // Contextual/non-personalized ads do not need the advertising identifier.
      // Keep AD_ID blocked until a consent-reviewed personalization design requires it.
      "com.google.android.gms.permission.AD_ID",
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
    [
      "react-native-google-mobile-ads",
      {
        androidAppId: admobAndroidAppId,
        iosAppId: admobIosAppId,
        skAdNetworkItems: ADMOB_SK_AD_NETWORK_ITEMS,
        delayAppMeasurementInit: true
      }
    ],
    [
      "expo-build-properties",
      {
        android: {
          extraProguardRules: "-keep class com.google.android.gms.internal.consent_sdk.** { *; }"
        }
      }
    ],
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
      "expo-location",
      {
        locationWhenInUsePermission: "Allow For the Baddiez to use your approximate location for weather and nearby requests."
      }
    ],
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
