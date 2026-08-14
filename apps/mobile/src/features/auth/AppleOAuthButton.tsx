import { useEffect, useState } from "react";
import { Image, Platform, Pressable, StyleSheet, Text, View } from "react-native";
import * as AppleAuthentication from "expo-apple-authentication";

const APPLE_LOGO_SOURCE = {
  uri: "https://appleid.cdn-apple.com/appleid/button/logo?color=black&border=false&size=30&scale=3"
};

export function AppleOAuthButton({
  disabled,
  onPress,
  testID
}: {
  disabled: boolean;
  onPress: () => void;
  testID: string;
}) {
  const [nativeAvailable, setNativeAvailable] = useState(false);

  useEffect(() => {
    let active = true;
    if (Platform.OS !== "ios") return () => { active = false; };
    void AppleAuthentication.isAvailableAsync()
      .then((available) => {
        if (active) setNativeAvailable(available);
      })
      .catch(() => {
        if (active) setNativeAvailable(false);
      });
    return () => { active = false; };
  }, []);

  if (Platform.OS === "ios" && nativeAvailable) {
    return (
      <View pointerEvents={disabled ? "none" : "auto"} style={disabled ? styles.disabled : undefined}>
        <AppleAuthentication.AppleAuthenticationButton
          accessibilityLabel="Continue with Apple"
          accessibilityState={{ disabled }}
          buttonStyle={AppleAuthentication.AppleAuthenticationButtonStyle.WHITE_OUTLINE}
          buttonType={AppleAuthentication.AppleAuthenticationButtonType.CONTINUE}
          cornerRadius={14}
          onPress={onPress}
          style={styles.button}
          testID={testID}
        />
      </View>
    );
  }

  return (
    <Pressable
      accessibilityLabel="Continue with Apple"
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [styles.fallbackButton, pressed && !disabled ? styles.pressed : null, disabled ? styles.disabled : null]}
      testID={testID}
    >
      <Image accessible={false} accessibilityIgnoresInvertColors source={APPLE_LOGO_SOURCE} style={styles.logo} />
      <Text style={styles.label}>Continue with Apple</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    height: 50,
    width: "100%"
  },
  disabled: {
    opacity: 0.5
  },
  fallbackButton: {
    alignItems: "center",
    backgroundColor: "#000000",
    borderColor: "#ffffff",
    borderRadius: 14,
    borderWidth: 1,
    flexDirection: "row",
    gap: 9,
    height: 50,
    justifyContent: "center",
    paddingHorizontal: 16,
    width: "100%"
  },
  label: {
    color: "#ffffff",
    fontSize: 15,
    fontWeight: "600"
  },
  logo: {
    height: 22,
    width: 22
  },
  pressed: {
    opacity: 0.82
  }
});
