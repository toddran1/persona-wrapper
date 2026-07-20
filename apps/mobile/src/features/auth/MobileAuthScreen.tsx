import { useState } from "react";
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
  useWindowDimensions,
  View
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { OAuthProvider, OAuthProviderStatus } from "@persona/shared";
import type { MobileTheme } from "../../theme/personaTheme";
import { NetworkStatusBanner } from "../../components/NetworkStatusBanner";
import { useLocalization } from "../../localization/LocalizationProvider";
import { useNetwork } from "../../network/NetworkProvider";

const APP_LOGO = require("../../../assets/branding/For_the_Baddiez_logo_transparent.png");

export type MobileAuthMode = "login" | "register" | "restore" | "forgot";

type MobileAuthScreenProps = {
  checkingSession: boolean;
  mode: MobileAuthMode;
  identifier: string;
  displayName: string;
  password: string;
  busy: boolean;
  error?: string | undefined;
  oauthProviders: OAuthProviderStatus[];
  theme: MobileTheme;
  onModeChange: (mode: MobileAuthMode) => void;
  onIdentifierChange: (value: string) => void;
  onDisplayNameChange: (value: string) => void;
  onPasswordChange: (value: string) => void;
  onSubmit: () => void;
  onOAuth: (provider: OAuthProvider) => void;
  onRetry: () => void;
  onOpenPublicPage: (path: "/privacy" | "/terms" | "/delete-account" | "/support") => void;
};

export function MobileAuthScreen({
  checkingSession,
  mode,
  identifier,
  displayName,
  password,
  busy,
  error,
  oauthProviders,
  theme,
  onModeChange,
  onIdentifierChange,
  onDisplayNameChange,
  onPasswordChange,
  onSubmit,
  onOAuth,
  onRetry,
  onOpenPublicPage
}: MobileAuthScreenProps) {
  const { t } = useLocalization();
  const { isOnline } = useNetwork();
  const { height, width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [passwordVisible, setPasswordVisible] = useState(false);
  const compact = height < 700 || width < 360;
  const enabledProviders = oauthProviders.filter((provider) => provider.enabled);
  const canSubmit = identifier.trim().length > 0 && (mode === "forgot" || password.length > 0) && !busy && isOnline;

  return (
    <LinearGradient
      colors={["#09060f", "#190d25", "#0b0712"]}
      locations={[0, 0.56, 1]}
      style={styles.screen}
    >
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.keyboard}>
        <ScrollView
          contentContainerStyle={[
            styles.content,
            compact ? styles.contentCompact : null,
            { paddingTop: Math.max(insets.top + 18, compact ? 24 : 44), paddingBottom: Math.max(insets.bottom + 18, 32) }
          ]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.brandBlock}>
            <Image accessible={false} accessibilityIgnoresInvertColors source={APP_LOGO} resizeMode="contain" style={[styles.logo, compact ? styles.logoCompact : null]} />
            <Text style={[styles.brandName, { color: theme.text }]}>{t("app.name")}</Text>
            <Text style={[styles.brandLine, { color: theme.muted }]}>{t("auth.brandLine")}</Text>
          </View>

          <NetworkStatusBanner theme={theme} onRetry={onRetry} />

          {checkingSession ? (
            <View accessibilityLiveRegion="polite" accessibilityLabel={t("auth.restoreSession")} style={styles.sessionLoader}>
              <ActivityIndicator color={theme.accent2} size="small" />
              <Text style={[styles.sessionText, { color: theme.muted }]}>{t("auth.restoreSession")}</Text>
            </View>
          ) : (
            <View style={styles.form}>
              <View accessibilityRole="tablist" style={[styles.modeSwitch, { borderColor: theme.border }]}>
                {(["login", "register"] as const).map((nextMode) => {
                  const selected = mode === nextMode;
                  return (
                    <Pressable
                      key={nextMode}
                      testID={`mobile-auth-mode-${nextMode}`}
                      accessibilityRole="tab"
                      accessibilityState={{ selected }}
                      disabled={busy}
                      onPress={() => onModeChange(nextMode)}
                      style={[styles.modeButton, selected ? { backgroundColor: theme.text } : null]}
                    >
                      <Text style={[styles.modeText, { color: selected ? theme.background : theme.muted }]}>
                        {nextMode === "login" ? t("auth.signIn") : t("auth.createAccount")}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>

              <View style={styles.headingBlock}>
                <Text style={[styles.title, { color: theme.text }]}>{mode === "login" ? t("auth.welcomeBack") : mode === "restore" ? t("auth.restoreAccount") : mode === "forgot" ? "Reset your password" : t("auth.joinConversation")}</Text>
                <Text style={[styles.copy, { color: theme.muted }]}>
                  {mode === "login" ? t("auth.signInDescription") : mode === "restore" ? t("auth.restoreDescription") : mode === "forgot" ? "Enter your account email and we’ll send a secure reset link." : t("auth.registerDescription")}
                </Text>
              </View>

              {enabledProviders.length > 0 && mode !== "forgot" ? (
                <View style={styles.oauthStack}>
                  {enabledProviders.map((providerStatus) => (
                    <Pressable
                      key={providerStatus.provider}
                      accessibilityRole="button"
                      testID={`mobile-auth-oauth-${providerStatus.provider}`}
                      disabled={busy || !isOnline}
                      onPress={() => onOAuth(providerStatus.provider)}
                      style={({ pressed }) => [
                        styles.oauthButton,
                        { borderColor: theme.border, backgroundColor: pressed ? "rgba(255,255,255,0.10)" : "rgba(255,255,255,0.055)" },
                        busy ? styles.disabled : null
                      ]}
                    >
                      <Ionicons name={providerStatus.provider === "google" ? "logo-google" : "logo-facebook"} size={20} color={theme.text} />
                      <Text style={[styles.oauthText, { color: theme.text }]}>{t("auth.continueWith", { provider: providerStatus.provider === "google" ? "Google" : "Facebook" })}</Text>
                    </Pressable>
                  ))}
                  <View style={styles.dividerRow}>
                    <View style={[styles.divider, { backgroundColor: theme.border }]} />
                    <Text style={[styles.dividerText, { color: theme.muted }]}>{t("auth.or")}</Text>
                    <View style={[styles.divider, { backgroundColor: theme.border }]} />
                  </View>
                </View>
              ) : null}

              <View style={styles.fields}>
                <View style={styles.fieldGroup}>
                  <Text style={[styles.fieldLabel, { color: theme.muted }]}>{t("auth.identifier")}</Text>
                  <TextInput
                    testID="mobile-auth-identifier"
                    accessibilityLabel={t("auth.identifier")}
                    autoCapitalize="none"
                    autoComplete="email"
                    editable={!busy && isOnline}
                    keyboardType="email-address"
                    value={identifier}
                    onChangeText={onIdentifierChange}
                    placeholder="you@example.com"
                    placeholderTextColor="rgba(200,189,216,0.54)"
                    returnKeyType="next"
                    style={[styles.input, { borderColor: theme.border, color: theme.text }]}
                  />
                </View>

                {mode === "register" ? (
                  <View style={styles.fieldGroup}>
                    <Text style={[styles.fieldLabel, { color: theme.muted }]}>{t("auth.displayName")} <Text style={styles.optional}>({t("auth.optional")})</Text></Text>
                    <TextInput
                      testID="mobile-auth-display-name"
                      accessibilityLabel={t("auth.displayName")}
                      autoCapitalize="words"
                      autoComplete="name"
                      editable={!busy && isOnline}
                      value={displayName}
                      onChangeText={onDisplayNameChange}
                      placeholder={t("auth.displayNamePlaceholder")}
                      placeholderTextColor="rgba(200,189,216,0.54)"
                      returnKeyType="next"
                      style={[styles.input, { borderColor: theme.border, color: theme.text }]}
                    />
                  </View>
                ) : null}

                {mode !== "forgot" ? <View style={styles.fieldGroup}>
                  <Text style={[styles.fieldLabel, { color: theme.muted }]}>{t("auth.password")}</Text>
                  <View style={[styles.passwordShell, { borderColor: theme.border }]}>
                    <TextInput
                      testID="mobile-auth-password"
                      accessibilityLabel={t("auth.password")}
                      autoCapitalize="none"
                      autoComplete={mode === "register" ? "new-password" : "current-password"}
                      editable={!busy && isOnline}
                      secureTextEntry={!passwordVisible}
                      value={password}
                      onChangeText={onPasswordChange}
                      onSubmitEditing={() => {
                        if (canSubmit) onSubmit();
                      }}
                      placeholder={mode === "register" ? t("auth.newPasswordPlaceholder") : t("auth.passwordPlaceholder")}
                      placeholderTextColor="rgba(200,189,216,0.54)"
                      returnKeyType="go"
                      style={[styles.passwordInput, { color: theme.text }]}
                    />
                    <Pressable accessibilityRole="button" accessibilityLabel={passwordVisible ? t("auth.hidePassword") : t("auth.showPassword")} onPress={() => setPasswordVisible((visible) => !visible)} style={styles.passwordToggle}>
                      <Ionicons name={passwordVisible ? "eye-off-outline" : "eye-outline"} size={20} color={theme.muted} />
                    </Pressable>
                  </View>
                </View> : null}
              </View>

              {error ? (
                <View accessibilityRole="alert" style={[styles.error, { borderColor: theme.danger }]}>
                  <Ionicons name="alert-circle-outline" size={18} color={theme.danger} />
                  <View style={styles.errorCopy}>
                    <Text style={[styles.errorText, { color: theme.text }]}>{error}</Text>
                    <Pressable accessibilityRole="button" disabled={busy} onPress={onRetry} style={styles.retryButton}>
                      <Text style={[styles.retryText, { color: theme.accent2 }]}>{t("auth.tryAgain")}</Text>
                    </Pressable>
                  </View>
                </View>
              ) : null}

              <Pressable
                accessibilityRole="button"
                testID="mobile-auth-submit"
                disabled={!canSubmit}
                onPress={onSubmit}
                style={({ pressed }) => [
                  styles.primaryButton,
                  { backgroundColor: theme.accent2, opacity: !canSubmit ? 0.48 : pressed ? 0.84 : 1 }
                ]}
              >
                {busy ? <ActivityIndicator color="#170f21" /> : <Text style={styles.primaryText}>{mode === "login" ? t("auth.signIn") : mode === "restore" ? t("auth.restoreAction") : mode === "forgot" ? "Send reset link" : t("auth.createAccount")}</Text>}
              </Pressable>
              <Pressable accessibilityRole="button" disabled={busy} onPress={() => onModeChange(mode === "forgot" ? "login" : "forgot")} style={styles.recoveryLink}>
                <Text style={[styles.retryText, { color: theme.accent2 }]}>{mode === "forgot" ? t("auth.backToSignIn") : "Forgot password?"}</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                disabled={busy}
                onPress={() => onModeChange(mode === "restore" ? "login" : "restore")}
                style={styles.recoveryLink}
              >
                <Text style={[styles.retryText, { color: theme.accent2 }]}>
                  {mode === "restore" ? t("auth.backToSignIn") : t("auth.restorePrompt")}
                </Text>
              </Pressable>
              <View style={[styles.aboutMenu, { borderTopColor: theme.border }]}>
                <Text style={[styles.aboutMenuLabel, { color: theme.muted }]}>{t("auth.about")}</Text>
                {([
                  [t("about.privacy"), "shield-checkmark-outline", "/privacy"],
                  [t("about.terms"), "document-text-outline", "/terms"],
                  [t("about.delete"), "person-remove-outline", "/delete-account"],
                  [t("about.support"), "help-circle-outline", "/support"]
                ] as const).map(([label, icon, path]) => (
                  <Pressable
                    key={path}
                    accessibilityRole="link"
                    onPress={() => onOpenPublicPage(path)}
                    style={({ pressed }) => [styles.aboutMenuRow, { backgroundColor: pressed ? "rgba(255,255,255,0.10)" : "rgba(255,255,255,0.055)" }]}
                  >
                    <Ionicons name={icon} size={18} color={theme.text} />
                    <Text style={[styles.aboutMenuText, { color: theme.text }]}>{label}</Text>
                    <Ionicons name="open-outline" size={16} color={theme.muted} />
                  </Pressable>
                ))}
              </View>
            </View>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  brandBlock: {
    alignItems: "center"
  },
  brandLine: {
    fontSize: 14,
    lineHeight: 20,
    marginTop: 7,
    maxWidth: 330,
    textAlign: "center"
  },
  aboutMenu: {
    gap: 6,
    marginTop: 18,
    paddingTop: 16,
    borderTopWidth: StyleSheet.hairlineWidth
  },
  aboutMenuLabel: {
    fontSize: 12,
    fontWeight: "800",
    letterSpacing: 0.7,
    marginBottom: 2,
    textTransform: "uppercase"
  },
  aboutMenuRow: {
    alignItems: "center",
    borderRadius: 8,
    flexDirection: "row",
    gap: 10,
    minHeight: 44,
    paddingHorizontal: 12
  },
  aboutMenuText: {
    flex: 1,
    fontSize: 14,
    fontWeight: "700"
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
  contentCompact: {
    justifyContent: "flex-start",
    paddingHorizontal: 20,
    paddingVertical: 24
  },
  copy: {
    fontSize: 15,
    lineHeight: 21
  },
  disabled: {
    opacity: 0.5
  },
  divider: {
    flex: 1,
    height: StyleSheet.hairlineWidth
  },
  dividerRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 12,
    paddingVertical: 2
  },
  dividerText: {
    fontSize: 12,
    fontWeight: "700",
    textTransform: "uppercase"
  },
  error: {
    alignItems: "flex-start",
    backgroundColor: "rgba(190,55,79,0.10)",
    borderRadius: 12,
    borderWidth: 1,
    flexDirection: "row",
    gap: 9,
    padding: 12
  },
  errorText: {
    fontSize: 13,
    lineHeight: 18
  },
  errorCopy: {
    flex: 1,
    gap: 7
  },
  fieldGroup: {
    gap: 7
  },
  fieldLabel: {
    fontSize: 12,
    fontWeight: "800",
    letterSpacing: 0.3
  },
  fields: {
    gap: 14
  },
  form: {
    gap: 18,
    marginTop: 28
  },
  headingBlock: {
    gap: 5
  },
  input: {
    backgroundColor: "rgba(255,255,255,0.045)",
    borderRadius: 14,
    borderWidth: 1,
    fontSize: 16,
    minHeight: 52,
    paddingHorizontal: 15
  },
  keyboard: {
    flex: 1
  },
  logo: {
    borderRadius: 26,
    height: 132,
    width: 132
  },
  logoCompact: {
    height: 96,
    width: 96
  },
  modeButton: {
    alignItems: "center",
    borderRadius: 11,
    flex: 1,
    justifyContent: "center",
    minHeight: 40
  },
  modeSwitch: {
    backgroundColor: "rgba(255,255,255,0.035)",
    borderRadius: 14,
    borderWidth: 1,
    flexDirection: "row",
    gap: 4,
    padding: 3
  },
  modeText: {
    fontSize: 14,
    fontWeight: "900"
  },
  oauthButton: {
    alignItems: "center",
    borderRadius: 14,
    borderWidth: 1,
    flexDirection: "row",
    gap: 10,
    justifyContent: "center",
    minHeight: 50,
    paddingHorizontal: 16
  },
  oauthStack: {
    gap: 10
  },
  oauthText: {
    fontSize: 15,
    fontWeight: "800"
  },
  optional: {
    fontWeight: "500",
    opacity: 0.7
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
  retryButton: {
    alignSelf: "flex-start",
    minHeight: 24,
    justifyContent: "center"
  },
  recoveryLink: {
    alignItems: "center",
    paddingVertical: 4
  },
  retryText: {
    fontSize: 13,
    fontWeight: "900"
  },
  screen: {
    flex: 1
  },
  sessionLoader: {
    alignItems: "center",
    gap: 10,
    marginTop: 38
  },
  sessionText: {
    fontSize: 13,
    fontWeight: "700"
  },
  title: {
    fontSize: 26,
    fontWeight: "900"
  }
});
