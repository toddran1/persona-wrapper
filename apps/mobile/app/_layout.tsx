import "react-native-gesture-handler";
import { Stack } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import { useEffect, type ComponentType, type PropsWithChildren } from "react";
import type { ViewProps } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { MobileErrorBoundary } from "../src/components/MobileErrorBoundary";

const AppGestureHandlerRootView = GestureHandlerRootView as ComponentType<PropsWithChildren<ViewProps>>;

export default function RootLayout() {
  useEffect(() => {
    // Expo Router normally handles this. Explicitly release the native splash
    // once React mounts so an interrupted background restore cannot retain it.
    SplashScreen.hide();
  }, []);

  return (
    <AppGestureHandlerRootView style={{ flex: 1 }}>
      <MobileErrorBoundary>
        <StatusBar style="light" />
        <Stack screenOptions={{ headerShown: false }} />
      </MobileErrorBoundary>
    </AppGestureHandlerRootView>
  );
}
