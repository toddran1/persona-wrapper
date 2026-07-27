import { useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import type { CurrentPoliciesResponse } from "@persona/shared";
import type { MobileTheme } from "../../theme/personaTheme";

export function MobilePolicyConsentScreen({
  policies,
  loading,
  loadError,
  theme,
  onOpenPublicPage,
  onAccept,
  onRetry,
  onLogout
}: {
  policies?: CurrentPoliciesResponse | undefined;
  loading: boolean;
  loadError?: string | undefined;
  theme: MobileTheme;
  onOpenPublicPage: (path: "/terms" | "/privacy") => void;
  onAccept: () => Promise<void>;
  onRetry: () => void;
  onLogout: () => Promise<void>;
}) {
  const [accepted, setAccepted] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();

  async function submit(): Promise<void> {
    if (!accepted || !policies || saving) return;
    setSaving(true);
    setError(undefined);
    try {
      await onAccept();
    } catch (acceptError) {
      setError(acceptError instanceof Error ? acceptError.message : "Could not save your acceptance.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <View style={[styles.screen, { backgroundColor: theme.background }]}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={[styles.card, { backgroundColor: theme.surfaceStrong, borderColor: theme.border }]}>
          <Text style={[styles.eyebrow, { color: theme.accent2 }]}>BEFORE YOU CONTINUE</Text>
          <Text accessibilityRole="header" style={[styles.title, { color: theme.text }]}>Review our current policies</Text>
          <Text style={[styles.copy, { color: theme.muted }]}>
            We updated the policies that govern your account. Review them and confirm your acceptance to continue using For the Baddiez.
          </Text>
          {loading ? <ActivityIndicator color={theme.accent2} style={styles.loader} /> : null}
          {loadError ? (
            <View style={[styles.loadError, { borderColor: theme.danger }]}>
              <Text accessibilityRole="alert" style={[styles.error, { color: theme.danger }]}>{loadError}</Text>
              <Pressable accessibilityRole="button" onPress={onRetry} style={styles.retry}>
                <Text style={[styles.retryText, { color: theme.text }]}>Try again</Text>
              </Pressable>
            </View>
          ) : null}
          {policies ? (
            <>
              <View style={styles.links}>
                {([
                  ["Terms of Use", "document-text-outline", policies.termsPath],
                  ["Privacy Policy", "shield-checkmark-outline", policies.privacyPath]
                ] as const).map(([label, icon, path]) => (
                  <Pressable
                    key={path}
                    accessibilityRole="link"
                    onPress={() => onOpenPublicPage(path)}
                    style={[styles.link, { borderColor: theme.border }]}
                  >
                    <Ionicons name={icon} size={20} color={theme.text} />
                    <Text style={[styles.linkText, { color: theme.text }]}>{label}</Text>
                    <Ionicons name="open-outline" size={17} color={theme.muted} />
                  </Pressable>
                ))}
              </View>
              <Pressable
                accessibilityRole="checkbox"
                accessibilityState={{ checked: accepted }}
                onPress={() => setAccepted((value) => !value)}
                style={[styles.checkRow, { borderColor: theme.border }]}
              >
                <View style={[styles.checkbox, { borderColor: accepted ? theme.accent2 : theme.muted, backgroundColor: accepted ? theme.accent2 : "transparent" }]}>
                  {accepted ? <Ionicons name="checkmark" size={16} color={theme.background} /> : null}
                </View>
                <Text style={[styles.checkText, { color: theme.text }]}>
                  I accept the Terms of Use and Privacy Policy.
                </Text>
              </Pressable>
            </>
          ) : null}
          {error ? <Text accessibilityRole="alert" style={[styles.error, { color: theme.danger }]}>{error}</Text> : null}
          <Pressable
            accessibilityRole="button"
            disabled={!accepted || !policies || saving}
            onPress={() => void submit()}
            style={[styles.primary, { backgroundColor: theme.accent2, opacity: !accepted || !policies || saving ? 0.45 : 1 }]}
          >
            {saving ? <ActivityIndicator color={theme.background} /> : <Text style={[styles.primaryText, { color: theme.background }]}>Accept and continue</Text>}
          </Pressable>
          <Pressable accessibilityRole="button" disabled={saving} onPress={() => void onLogout()} style={styles.logout}>
            <Text style={[styles.logoutText, { color: theme.muted }]}>Log out</Text>
          </Pressable>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: 22, borderWidth: 1, maxWidth: 520, padding: 24, width: "100%" },
  checkRow: { alignItems: "flex-start", borderRadius: 14, borderWidth: 1, flexDirection: "row", gap: 12, padding: 15 },
  checkbox: { alignItems: "center", borderRadius: 6, borderWidth: 1.5, height: 24, justifyContent: "center", width: 24 },
  checkText: { flex: 1, fontSize: 15, fontWeight: "600", lineHeight: 22 },
  content: { alignItems: "center", flexGrow: 1, justifyContent: "center", padding: 22 },
  copy: { fontSize: 16, lineHeight: 24, marginBottom: 20 },
  error: { fontSize: 14, fontWeight: "700", lineHeight: 20, marginTop: 12 },
  eyebrow: { fontSize: 12, fontWeight: "900", letterSpacing: 1.4 },
  loader: { marginBottom: 16 },
  link: { alignItems: "center", borderRadius: 12, borderWidth: 1, flexDirection: "row", minHeight: 50, paddingHorizontal: 14 },
  links: { gap: 9, marginBottom: 16 },
  linkText: { flex: 1, fontSize: 15, fontWeight: "700", marginLeft: 10 },
  loadError: { borderRadius: 14, borderWidth: 1, marginBottom: 16, padding: 14 },
  logout: { alignItems: "center", marginTop: 7, padding: 12 },
  logoutText: { fontSize: 15, fontWeight: "700" },
  primary: { alignItems: "center", borderRadius: 999, justifyContent: "center", marginTop: 16, minHeight: 54 },
  primaryText: { fontSize: 16, fontWeight: "900" },
  retry: { alignSelf: "flex-start", marginTop: 10, paddingVertical: 6 },
  retryText: { fontSize: 15, fontWeight: "800" },
  screen: { flex: 1 },
  title: { fontSize: 32, fontWeight: "900", lineHeight: 35, marginBottom: 12, marginTop: 7 }
});
