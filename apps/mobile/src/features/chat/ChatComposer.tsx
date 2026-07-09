import { useState } from "react";
import { Pressable, StyleSheet, TextInput, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import type { MobileTheme } from "../../theme/personaTheme";

type ChatComposerProps = {
  theme: MobileTheme;
  disabled?: boolean;
  placeholder: string;
  onSubmit: (message: string) => void;
};

export function ChatComposer({ theme, disabled, placeholder, onSubmit }: ChatComposerProps) {
  const [draft, setDraft] = useState("");
  const canSend = draft.trim().length > 0 && !disabled;

  function submit(): void {
    const message = draft.trim();
    if (!message || disabled) return;
    setDraft("");
    onSubmit(message);
  }

  return (
    <View style={[styles.wrap, { borderColor: theme.border, backgroundColor: theme.surfaceStrong }]}>
      <Pressable accessibilityRole="button" accessibilityLabel="Attach file" style={styles.sideButton}>
        <Ionicons name="add" size={25} color={theme.muted} />
      </Pressable>
      <TextInput
        value={draft}
        onChangeText={setDraft}
        editable={!disabled}
        placeholder={placeholder}
        placeholderTextColor={theme.muted}
        multiline
        maxLength={4000}
        style={[styles.input, { color: theme.text }]}
      />
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={canSend ? "Send message" : "Voice input"}
        onPress={canSend ? submit : undefined}
        style={[
          styles.sendButton,
          { backgroundColor: canSend ? theme.text : "rgba(255,255,255,0.08)" }
        ]}
      >
        <Ionicons name={canSend ? "arrow-up" : "mic-outline"} size={20} color={canSend ? theme.background : theme.text} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  input: {
    flex: 1,
    fontSize: 16,
    lineHeight: 21,
    maxHeight: 110,
    minHeight: 24,
    paddingVertical: 10
  },
  sendButton: {
    alignItems: "center",
    borderRadius: 999,
    height: 36,
    justifyContent: "center",
    width: 36
  },
  sideButton: {
    alignItems: "center",
    height: 40,
    justifyContent: "center",
    width: 32
  },
  wrap: {
    alignItems: "flex-end",
    borderRadius: 26,
    borderWidth: 1,
    flexDirection: "row",
    gap: 8,
    paddingBottom: 7,
    paddingHorizontal: 9,
    paddingTop: 7
  }
});
