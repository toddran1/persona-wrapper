import { useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import type { MobileTheme } from "../../theme/personaTheme";
import type { MobilePickedFile } from "./types";

type ChatComposerProps = {
  theme: MobileTheme;
  disabled?: boolean;
  uploadingAttachments?: boolean;
  attachments: MobilePickedFile[];
  placeholder: string;
  onAttach: () => void;
  onRemoveAttachment: (id: string) => void;
  onSubmit: (message: string) => void;
};

export function ChatComposer({
  theme,
  disabled,
  uploadingAttachments,
  attachments,
  placeholder,
  onAttach,
  onRemoveAttachment,
  onSubmit
}: ChatComposerProps) {
  const [draft, setDraft] = useState("");
  const canSend = draft.trim().length > 0 && !disabled && !uploadingAttachments;

  function submit(): void {
    const message = draft.trim();
    if (!message || disabled || uploadingAttachments) return;
    setDraft("");
    onSubmit(message);
  }

  return (
    <View style={styles.shell}>
      {attachments.length > 0 ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.attachmentTray}>
          {attachments.map((attachment) => (
            <View key={attachment.id} style={[styles.attachmentChip, { borderColor: theme.border, backgroundColor: "rgba(255,255,255,0.055)" }]}>
              <Ionicons name={attachment.kind === "image" ? "image-outline" : "document-text-outline"} size={16} color={theme.accent2} />
              <Text style={[styles.attachmentName, { color: theme.text }]} numberOfLines={1}>{attachment.name}</Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Remove ${attachment.name}`}
                onPress={() => onRemoveAttachment(attachment.id)}
                style={styles.removeAttachment}
              >
                <Ionicons name="close" size={14} color={theme.muted} />
              </Pressable>
            </View>
          ))}
        </ScrollView>
      ) : null}
      <View style={[styles.wrap, { borderColor: theme.border, backgroundColor: theme.surfaceStrong }]}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Attach file"
          disabled={disabled || uploadingAttachments}
          onPress={onAttach}
          style={styles.sideButton}
        >
          <Ionicons name="add" size={25} color={theme.muted} />
        </Pressable>
        <TextInput
          value={draft}
          onChangeText={setDraft}
          editable={!disabled && !uploadingAttachments}
          placeholder={uploadingAttachments ? "Uploading attachments..." : placeholder}
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
    </View>
  );
}

const styles = StyleSheet.create({
  attachmentChip: {
    alignItems: "center",
    borderRadius: 999,
    borderWidth: 1,
    flexDirection: "row",
    gap: 7,
    maxWidth: 210,
    paddingLeft: 10,
    paddingRight: 6,
    paddingVertical: 7
  },
  attachmentName: {
    flexShrink: 1,
    fontSize: 12,
    fontWeight: "700"
  },
  attachmentTray: {
    gap: 8,
    paddingHorizontal: 2
  },
  input: {
    flex: 1,
    fontSize: 16,
    lineHeight: 21,
    maxHeight: 110,
    minHeight: 24,
    paddingVertical: 10
  },
  removeAttachment: {
    alignItems: "center",
    height: 22,
    justifyContent: "center",
    width: 22
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
  shell: {
    gap: 8
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
