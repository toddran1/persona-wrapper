import { Pressable, StyleSheet, Text, type StyleProp, type ViewStyle } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import type { MobileTheme } from "../theme/personaTheme";

type IconButtonProps = {
  name: keyof typeof Ionicons.glyphMap;
  label: string;
  theme: MobileTheme;
  onPress?: () => void;
  style?: StyleProp<ViewStyle>;
};

export function IconButton({ name, label, theme, onPress, style }: IconButtonProps) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        { borderColor: theme.border, backgroundColor: pressed ? "rgba(255,255,255,0.12)" : "rgba(255,255,255,0.055)" },
        style
      ]}
    >
      <Ionicons name={name} size={21} color={theme.text} />
      <Text style={styles.hiddenLabel}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    alignItems: "center",
    borderRadius: 999,
    borderWidth: 1,
    height: 40,
    justifyContent: "center",
    width: 40
  },
  hiddenLabel: {
    height: 0,
    opacity: 0,
    width: 0
  }
});
