import { useMemo, useState } from "react";
import {
  ActivityIndicator,
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View
} from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import { LinearGradient } from "expo-linear-gradient";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { PASSWORD_MIN_LENGTH } from "@persona/shared";
import { api } from "../src/api/client";
import { PasswordStrengthMeter } from "../src/components/PasswordStrengthMeter";
import { defaultPersonaTheme } from "../src/theme/personaTheme";

const APP_LOGO = require("../assets/branding/FTB_Logo_120x120.png");

// Native landing screen for the personawrapper://reset-password deep link sent
// by the mobile forgot-password flow.
export default function ResetPasswordScreen() {
  const theme = defaultPersonaTheme;
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const params = useLocalSearchParams<{ token?: string; error?: string }>();
  const token = typeof params.token === "string" ? params.token : "";
  const invalidToken = params.error === "INVALID_TOKEN" || !token;
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [complete, setComplete] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const canSubmit = useMemo(
    () => !invalidToken && password.length >= PASSWORD_MIN_LENGTH && password === confirmation && !busy,
    [busy, confirmation, invalidToken, password]
  );

  async function submit(): Promise<void> {
    if (!canSubmit) return;
    setBusy(true);
    setError(undefined);
    try {
      await api.resetPassword(token, password);
      setComplete(true);
    } catch (resetError) {
      setError(resetError instanceof Error ? resetError.message : "Could not reset your password.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <LinearGradient colors={["#09060f", "#190d25", "#0b0712"]} locations={[0, 0.56, 1]} style={styles.screen}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.keyboard}>
        <ScrollView
          contentContainerStyle={[
            styles.content,
            {
              paddingTop: Math.max(insets.top + 18, 44),
              paddingBottom: Math.max(insets.bottom + 18, 32),
              paddingLeft: Math.max(insets.left + 12, 24),
              paddingRight: Math.max(insets.right + 12, 24)
            }
          ]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.brandBlock}>
            <Image accessible={false} accessibilityIgnoresInvertColors source={APP_LOGO} resizeMode="contain" style={styles.logo} />
            <Text style={[styles.brandName, { color: theme.text }]}>For the Baddiez</Text>
          </View>

          <View style={styles.form}>
            {invalidToken ? (
              <>
                <Text style={[styles.title, { color: theme.text }]}>Reset link expired</Text>
                <Text style={[styles.copy, { color: theme.muted }]}>
                  That reset link is invalid or has expired. Request a fresh one from the sign-in screen.
                </Text>
              </>
            ) : complete ? (
              <>
                <Text style={[styles.title, { color: theme.text }]}>Password updated</Text>
                <Text style={[styles.copy, { color: theme.muted }]}>
                  Your password was changed and other devices were signed out. Sign in with your new password.
                </Text>
              </>
            ) : (
              <>
                <Text style={[styles.title, { color: theme.text }]}>Reset your password</Text>
                <Text style={[styles.copy, { color: theme.muted }]}>
                  Choose a new password with at least {PASSWORD_MIN_LENGTH} characters.
                </Text>
                <View style={styles.fieldGroup}>
                  <Text style={[styles.fieldLabel, { color: theme.muted }]}>New password</Text>
                  <View style={[styles.passwordShell, { borderColor: theme.border }]}>
                    <TextInput
                      testID="mobile-reset-password"
                      accessibilityLabel="New password"
                      autoCapitalize="none"
                      autoComplete="new-password"
                      editable={!busy}
                      secureTextEntry={!passwordVisible}
                      value={password}
                      onChangeText={setPassword}
                      placeholder={`Password (${PASSWORD_MIN_LENGTH}+ chars)`}
                      placeholderTextColor="rgba(200,189,216,0.54)"
                      returnKeyType="next"
                      style={[styles.passwordInput, { color: theme.text }]}
                    />
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={passwordVisible ? "Hide password" : "Show password"}
                      onPress={() => setPasswordVisible((visible) => !visible)}
                      style={styles.passwordToggle}
                    >
                      <Ionicons name={passwordVisible ? "eye-off-outline" : "eye-outline"} size={20} color={theme.muted} />
                    </Pressable>
                  </View>
                  <PasswordStrengthMeter password={password} theme={theme} />
                </View>
                <View style={styles.fieldGroup}>
                  <Text style={[styles.fieldLabel, { color: theme.muted }]}>Confirm password</Text>
                  <View style={[styles.passwordShell, { borderColor: theme.border }]}>
                    <TextInput
                      testID="mobile-reset-password-confirm"
                      accessibilityLabel="Confirm password"
                      autoCapitalize="none"
                      autoComplete="new-password"
                      editable={!busy}
                      secureTextEntry={!passwordVisible}
                      value={confirmation}
                      onChangeText={setConfirmation}
                      onSubmitEditing={() => void submit()}
                      placeholder="Repeat your password"
                      placeholderTextColor="rgba(200,189,216,0.54)"
                      returnKeyType="go"
                      style={[styles.passwordInput, { color: theme.text }]}
                    />
                  </View>
                  {confirmation && password !== confirmation ? (
                    <Text style={[styles.mismatch, { color: theme.danger }]}>Passwords do not match.</Text>
                  ) : null}
                </View>
                {error ? (
                  <Text accessibilityRole="alert" style={[styles.mismatch, { color: theme.danger }]}>{error}</Text>
                ) : null}
                <Pressable
                  accessibilityRole="button"
                  testID="mobile-reset-submit"
                  disabled={!canSubmit}
                  onPress={() => void submit()}
                  style={({ pressed }) => [
                    styles.primaryButton,
                    { backgroundColor: theme.accent2, opacity: !canSubmit ? 0.48 : pressed ? 0.84 : 1 }
                  ]}
                >
                  {busy ? <ActivityIndicator color="#170f21" /> : <Text style={styles.primaryText}>Reset password</Text>}
                </Pressable>
              </>
            )}
            {invalidToken || complete ? (
              <Pressable
                accessibilityRole="button"
                onPress={() => router.replace("/")}
                style={({ pressed }) => [
                  styles.primaryButton,
                  { backgroundColor: theme.accent2, opacity: pressed ? 0.84 : 1 }
                ]}
              >
                <Text style={styles.primaryText}>Back to sign in</Text>
              </Pressable>
            ) : null}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  brandBlock: {
    alignItems: "center"
  },
  brandName: {
    fontSize: 28,
    fontWeight: "900",
    marginTop: 10
  },
  content: {
    alignSelf: "center",
    flexGrow: 1,
    justifyContent: "center",
    maxWidth: 460,
    paddingHorizontal: 24,
    paddingVertical: 44,
    width: "100%"
  },
  copy: {
    fontSize: 15,
    lineHeight: 21
  },
  fieldGroup: {
    gap: 7
  },
  fieldLabel: {
    fontSize: 12,
    fontWeight: "800",
    letterSpacing: 0.3
  },
  form: {
    gap: 18,
    marginTop: 28
  },
  keyboard: {
    flex: 1
  },
  logo: {
    borderRadius: 26,
    height: 96,
    width: 96
  },
  mismatch: {
    fontSize: 13,
    fontWeight: "700",
    paddingHorizontal: 4
  },
  passwordInput: {
    flex: 1,
    fontSize: 16,
    minHeight: 50,
    paddingLeft: 15
  },
  passwordShell: {
    alignItems: "center",
    backgroundColor: "rgba(255,255,255,0.045)",
    borderRadius: 14,
    borderWidth: 1,
    flexDirection: "row",
    minHeight: 52
  },
  passwordToggle: {
    alignItems: "center",
    height: 48,
    justifyContent: "center",
    width: 48
  },
  primaryButton: {
    alignItems: "center",
    borderRadius: 14,
    justifyContent: "center",
    minHeight: 52
  },
  primaryText: {
    color: "#170f21",
    fontSize: 16,
    fontWeight: "900"
  },
  screen: {
    flex: 1
  },
  title: {
    fontSize: 26,
    fontWeight: "900"
  }
});
