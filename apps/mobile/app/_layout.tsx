import "react-native-gesture-handler";
import { Stack } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import { focusManager } from "@tanstack/react-query";
import { useEffect, useState, type ComponentType, type PropsWithChildren } from "react";
import { AppState, type ViewProps } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { QueryClientProvider } from "@tanstack/react-query";
import { MobileErrorBoundary } from "../src/components/MobileErrorBoundary";
import { LocalizationProvider } from "../src/localization/LocalizationProvider";
import { NetworkProvider } from "../src/network/NetworkProvider";
import { queryClient } from "../src/api/queryClient";
import { restorePublicQueryCache, subscribePublicQueryCache } from "../src/api/queryPersistence";

const AppGestureHandlerRootView = GestureHandlerRootView as ComponentType<PropsWithChildren<ViewProps>>;
void SplashScreen.preventAutoHideAsync().catch(() => undefined);

export default function RootLayout() {
  const [cacheReady, setCacheReady] = useState(false);

  useEffect(() => {
    let mounted = true;
    let unsubscribePersistence: (() => void) | undefined;
    const restore = restorePublicQueryCache(queryClient).catch(() => undefined);
    void restore.finally(() => {
      if (!mounted) return;
      unsubscribePersistence = subscribePublicQueryCache(queryClient);
      setCacheReady(true);
      SplashScreen.hide();
    });
    const subscription = AppState.addEventListener("change", (status) => {
      focusManager.setFocused(status === "active");
    });
    return () => {
      mounted = false;
      unsubscribePersistence?.();
      subscription.remove();
    };
  }, []);

  return (
    <AppGestureHandlerRootView style={{ flex: 1 }}>
      <LocalizationProvider>
        <QueryClientProvider client={queryClient}>
          <NetworkProvider>
            <MobileErrorBoundary>
              <StatusBar style="light" />
              {cacheReady ? <Stack screenOptions={{ headerShown: false }} /> : null}
            </MobileErrorBoundary>
          </NetworkProvider>
        </QueryClientProvider>
      </LocalizationProvider>
    </AppGestureHandlerRootView>
  );
}
