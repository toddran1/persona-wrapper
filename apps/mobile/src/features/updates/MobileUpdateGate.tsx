import Constants from "expo-constants";
import * as Linking from "expo-linking";
import * as Updates from "expo-updates";
import { useCallback, useEffect, useRef, useState, type PropsWithChildren } from "react";
import { AppState, Modal, Platform, Pressable, StyleSheet, Text, View } from "react-native";
import type { MobileUpdatePolicy } from "@persona/shared";
import { api } from "../../api/client";
import {
  cacheMobileUpdatePolicy,
  dismissOptionalBuild,
  readCachedMobileUpdatePolicy,
  readDismissedOptionalBuild
} from "../../storage/mobileUpdateStorage";
import { defaultPersonaTheme as theme } from "../../theme/personaTheme";

const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
const CACHED_REQUIRED_POLICY_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

function installedBuild(): number {
  const value = Number.parseInt(Constants.nativeBuildVersion ?? "0", 10);
  return Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

export function MobileUpdateGate({ children }: PropsWithChildren) {
  const [policy, setPolicy] = useState<MobileUpdatePolicy>();
  const [optionalVisible, setOptionalVisible] = useState(false);
  const [otaReady, setOtaReady] = useState(false);
  const [openingStore, setOpeningStore] = useState(false);
  const [storeError, setStoreError] = useState<string>();
  const lastCheckAt = useRef(0);
  const checking = useRef(false);
  const platform = Platform.OS === "ios" ? "ios" : Platform.OS === "android" ? "android" : undefined;
  const build = installedBuild();

  const check = useCallback(async (force = false) => {
    if (!platform || checking.current) return;
    if (!force && Date.now() - lastCheckAt.current < CHECK_INTERVAL_MS) return;
    checking.current = true;
    try {
      const next = await api.getMobileUpdatePolicy({
        platform,
        build,
        ...(Constants.nativeAppVersion ? { version: Constants.nativeAppVersion } : {}),
        ...(Updates.runtimeVersion ? { runtimeVersion: Updates.runtimeVersion } : {})
      });
      lastCheckAt.current = Date.now();
      await cacheMobileUpdatePolicy(next).catch(() => undefined);
      setPolicy(next);
      const dismissed = await readDismissedOptionalBuild().catch(() => undefined);
      setOptionalVisible(next.status === "optional" && dismissed !== next.latestBuild);
    } catch {
      const cached = await readCachedMobileUpdatePolicy().catch(() => undefined);
      // A previously confirmed required policy remains enforceable offline for
      // the same native build. All other failures are deliberately fail-open.
      const cachedAt = cached ? Date.parse(cached.checkedAt) : Number.NaN;
      const cachedRequiredPolicyIsFresh = Number.isFinite(cachedAt)
        && Date.now() - cachedAt <= CACHED_REQUIRED_POLICY_MAX_AGE_MS;
      if (
        cached?.platform === platform
        && cached.installedBuild === build
        && cached.status === "required"
        && cachedRequiredPolicyIsFresh
      ) {
        setPolicy(cached);
      }
    } finally {
      checking.current = false;
    }

    if (!__DEV__ && Updates.isEnabled) {
      try {
        const result = await Updates.checkForUpdateAsync();
        if (result.isAvailable) {
          await Updates.fetchUpdateAsync();
          setOtaReady(true);
        }
      } catch {
        // OTA availability is opportunistic; native-version policy still works.
      }
    }
  }, [build, platform]);

  useEffect(() => {
    void check(true);
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") void check();
    });
    return () => subscription.remove();
  }, [check]);

  const openStore = async () => {
    if (!policy?.storeUrl || openingStore) return;
    setOpeningStore(true);
    setStoreError(undefined);
    try {
      await Linking.openURL(policy.storeUrl);
    } catch {
      setStoreError("The app store could not be opened. Check your connection and try again.");
    } finally {
      setOpeningStore(false);
    }
  };

  const dismissOptional = async () => {
    if (policy) await dismissOptionalBuild(policy.latestBuild).catch(() => undefined);
    setOptionalVisible(false);
  };

  const required = policy?.status === "required";
  const visible = required || optionalVisible || otaReady;
  const title = required ? "Update required" : optionalVisible ? "Update available" : "Update ready";
  const message = required || optionalVisible
    ? policy?.message
    : "A small app update has downloaded. Restart when you are ready to apply it.";

  return (
    <>
      {children}
      <Modal
        visible={visible}
        transparent={!required}
        animationType="fade"
        accessibilityViewIsModal
        onRequestClose={() => {
          if (required) return;
          if (otaReady) setOtaReady(false);
          else void dismissOptional();
        }}
      >
        <View style={[styles.overlay, required && styles.requiredOverlay]}>
          <View style={styles.card} accessibilityViewIsModal>
            <Text style={styles.eyebrow}>FOR THE BADDIEZ</Text>
            <Text style={styles.title}>{title}</Text>
            <Text style={styles.message}>{message}</Text>
            {storeError ? <Text style={styles.error}>{storeError}</Text> : null}
            {otaReady && !required && !optionalVisible ? (
              <Pressable style={styles.primaryButton} onPress={() => void Updates.reloadAsync()} accessibilityRole="button">
                <Text style={styles.primaryButtonText}>Restart now</Text>
              </Pressable>
            ) : (
              <Pressable
                style={[styles.primaryButton, !policy?.storeUrl && styles.disabledButton]}
                onPress={() => void openStore()}
                disabled={!policy?.storeUrl || openingStore}
                accessibilityRole="button"
              >
                <Text style={styles.primaryButtonText}>{openingStore ? "Opening store…" : "Update app"}</Text>
              </Pressable>
            )}
            {!required ? (
              <Pressable
                style={styles.secondaryButton}
                onPress={() => {
                  if (otaReady) setOtaReady(false);
                  else void dismissOptional();
                }}
                accessibilityRole="button"
              >
                <Text style={styles.secondaryButtonText}>{otaReady ? "Next launch" : "Later"}</Text>
              </Pressable>
            ) : null}
            {required && !policy?.storeUrl ? (
              <Pressable style={styles.secondaryButton} onPress={() => void check(true)} accessibilityRole="button">
                <Text style={styles.secondaryButtonText}>Try again</Text>
              </Pressable>
            ) : null}
          </View>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.72)", alignItems: "center", justifyContent: "center", padding: 24 },
  requiredOverlay: { backgroundColor: theme.background },
  card: { width: "100%", maxWidth: 460, backgroundColor: theme.surfaceStrong, borderColor: theme.border, borderWidth: 1, borderRadius: 24, padding: 24, gap: 14 },
  eyebrow: { color: theme.accent2, fontSize: 12, fontWeight: "800", letterSpacing: 1.5 },
  title: { color: theme.text, fontSize: 30, lineHeight: 36, fontWeight: "800" },
  message: { color: theme.muted, fontSize: 17, lineHeight: 25 },
  error: { color: theme.danger, fontSize: 14, lineHeight: 20 },
  primaryButton: { minHeight: 54, borderRadius: 18, alignItems: "center", justifyContent: "center", backgroundColor: theme.accent2, marginTop: 4 },
  disabledButton: { opacity: 0.45 },
  primaryButtonText: { color: theme.background, fontSize: 17, fontWeight: "800" },
  secondaryButton: { minHeight: 48, alignItems: "center", justifyContent: "center" },
  secondaryButtonText: { color: theme.text, fontSize: 16, fontWeight: "700" }
});
