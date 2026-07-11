import "react-native-gesture-handler";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import type { ComponentType, PropsWithChildren } from "react";
import type { ViewProps } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { MobileErrorBoundary } from "../src/components/MobileErrorBoundary";

const AppGestureHandlerRootView = GestureHandlerRootView as ComponentType<PropsWithChildren<ViewProps>>;

export default function RootLayout() {
  return (
    <AppGestureHandlerRootView style={{ flex: 1 }}>
      <MobileErrorBoundary>
        <StatusBar style="light" />
        <Stack screenOptions={{ headerShown: false }} />
      </MobileErrorBoundary>
    </AppGestureHandlerRootView>
  );
}
