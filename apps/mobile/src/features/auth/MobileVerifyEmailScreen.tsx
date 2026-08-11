import { useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import type { MobileTheme } from "../../theme/personaTheme";

export function MobileVerifyEmailScreen({
  email,
  theme,
  onResend,
  onCheckStatus,
  onLogout
}: {
  email: string;
  theme: MobileTheme;
  onResend: () => Promise<void>;
  onCheckStatus: () => Promise<boolean>;
  onLogout: () => Promise<void>;
}) {
  const [busy, setBusy] = useState<"resend" | "check" | "logout" | undefined>();
  const [notice, setNotice] = useState<string>();
  const [error, setError] = useState<string>();

  async function run(action: "resend" | "check" | "logout", task: () => Promise<void>): Promise<void> {
    if (busy) return;
    setBusy(action);
    setNotice(undefined);
    setError(undefined);
    try {
      await task();
    } catch (taskError) {
      setError(taskError instanceof Error ? taskError.message : "Something went wrong. Try again.");
    } finally {
      setBusy(undefined);
    }
  }

  return (
    <View style={[styles.screen, { backgroundColor: theme.background }]}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={[styles.card, { backgroundColor: theme.surfaceStrong, borderColor: theme.border }]}>
          <Text style={[styles.eyebrow, { color: theme.accent2 }]}>ONE MORE STEP</Text>
          <Text accessibilityRole="header" style={[styles.title, { color: theme.text }]}>Verify your email</Text>
          <Text style={[styles.copy, { color: theme.muted }]}>
            We sent a verification link to <Text style={{ color: theme.text, fontWeight: "800" }}>{email}</Text>.
            Open it to activate your account. On this phone, the verification page will try to bring you back to the app.
          </Text>
          {notice ? <Text accessibilityLiveRegion="polite" style={[styles.notice, { color: theme.accent2 }]}>{notice}</Text> : null}
          {error ? <Text accessibilityRole="alert" style={[styles.error, { color: theme.danger }]}>{error}</Text> : null}
          <Pressable
            accessibilityRole="button"
            disabled={Boolean(busy)}
            onPress={() => void run("check", async () => {
              const verified = await onCheckStatus();
              if (!verified) setNotice("Not verified yet — open the link in the email, then check again.");
            })}
            style={[styles.primary, { backgroundColor: theme.accent2, opacity: busy ? 0.45 : 1 }]}
          >
            {busy === "check"
              ? <ActivityIndicator color={theme.background} />
              : <Text style={[styles.primaryText, { color: theme.background }]}>I've verified — continue</Text>}
          </Pressable>
          <Pressable
            accessibilityRole="button"
            disabled={Boolean(busy)}
            onPress={() => void run("resend", async () => {
              await onResend();
              setNotice("Verification email sent — check your inbox and spam folder.");
            })}
            style={styles.secondary}
          >
            <Text style={[styles.secondaryText, { color: theme.text }]}>
              {busy === "resend" ? "Sending…" : "Resend verification email"}
            </Text>
          </Pressable>
          <Pressable accessibilityRole="button" disabled={Boolean(busy)} onPress={() => void run("logout", onLogout)} style={styles.logout}>
            <Text style={[styles.logoutText, { color: theme.muted }]}>Log out</Text>
          </Pressable>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: 22, borderWidth: 1, maxWidth: 520, padding: 24, width: "100%" },
  content: { alignItems: "center", flexGrow: 1, justifyContent: "center", padding: 22 },
  copy: { fontSize: 16, lineHeight: 24, marginBottom: 20 },
  error: { fontSize: 14, fontWeight: "700", lineHeight: 20, marginBottom: 12 },
  eyebrow: { fontSize: 12, fontWeight: "900", letterSpacing: 1.4 },
  logout: { alignItems: "center", marginTop: 7, padding: 12 },
  logoutText: { fontSize: 15, fontWeight: "700" },
  notice: { fontSize: 14, fontWeight: "700", lineHeight: 20, marginBottom: 12 },
  primary: { alignItems: "center", borderRadius: 999, justifyContent: "center", marginTop: 4, minHeight: 54 },
  primaryText: { fontSize: 16, fontWeight: "900" },
  screen: { flex: 1 },
  secondary: { alignItems: "center", marginTop: 7, padding: 12 },
  secondaryText: { fontSize: 15, fontWeight: "800" },
  title: { fontSize: 32, fontWeight: "900", lineHeight: 35, marginBottom: 12, marginTop: 7 }
});
