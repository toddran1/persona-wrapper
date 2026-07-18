import "react-native-gesture-handler";
import { Stack } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import { focusManager } from "@tanstack/react-query";
import { useEffect, type ComponentType, type PropsWithChildren } from "react";
import { AppState, type ViewProps } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { QueryClientProvider } from "@tanstack/react-query";
import { MobileErrorBoundary } from "../src/components/MobileErrorBoundary";
import { LocalizationProvider } from "../src/localization/LocalizationProvider";
import { NetworkProvider } from "../src/network/NetworkProvider";
import { queryClient } from "../src/api/queryClient";

const AppGestureHandlerRootView = GestureHandlerRootView as ComponentType<PropsWithChildren<ViewProps>>;

export default function RootLayout() {
  useEffect(() => {
    // Expo Router normally handles this. Explicitly release the native splash
    // once React mounts so an interrupted background restore cannot retain it.
    SplashScreen.hide();
    const subscription = AppState.addEventListener("change", (status) => {
      focusManager.setFocused(status === "active");
    });
    return () => subscription.remove();
  }, []);

  return (
    <AppGestureHandlerRootView style={{ flex: 1 }}>
      <LocalizationProvider>
        <QueryClientProvider client={queryClient}>
          <NetworkProvider>
            <MobileErrorBoundary>
              <StatusBar style="light" />
              <Stack screenOptions={{ headerShown: false }} />
            </MobileErrorBoundary>
          </NetworkProvider>
        </QueryClientProvider>
      </LocalizationProvider>
    </AppGestureHandlerRootView>
  );
}
