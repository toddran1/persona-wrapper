import { StyleSheet, Text, View } from "react-native";
import { passwordStrengthScore, type PasswordStrength } from "@persona/shared";
import type { MobileTheme } from "../theme/personaTheme";

const STRENGTH_LABELS: Record<PasswordStrength, string> = {
  0: "",
  1: "Too short",
  2: "Fair",
  3: "Good",
  4: "Strong"
};

export function PasswordStrengthMeter({ password, theme }: { password: string; theme: MobileTheme }) {
  if (!password) return null;
  const score = passwordStrengthScore(password);
  const color = score <= 1 ? theme.danger : score === 2 ? "#e0a54a" : score === 3 ? theme.accent2 : "#3ecf8e";
  return (
    <View style={styles.wrap} accessibilityLiveRegion="polite" accessibilityLabel={`Password strength: ${STRENGTH_LABELS[score]}`}>
      <View style={styles.bars}>
        {([1, 2, 3, 4] as const).map((bar) => (
          <View
            key={bar}
            style={[styles.bar, { backgroundColor: bar <= score ? color : "rgba(255,255,255,0.12)" }]}
          />
        ))}
      </View>
      <Text style={[styles.label, { color }]}>{STRENGTH_LABELS[score]}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  bars: {
    flex: 1,
    flexDirection: "row",
    gap: 5
  },
  bar: {
    borderRadius: 999,
    flex: 1,
    height: 4
  },
  label: {
    fontSize: 12,
    fontWeight: "800",
    minWidth: 64,
    textAlign: "right"
  },
  wrap: {
    alignItems: "center",
    flexDirection: "row",
    gap: 10,
    paddingHorizontal: 4
  }
});
