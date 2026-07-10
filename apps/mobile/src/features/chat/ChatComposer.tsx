import { useEffect, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import type { MobileTheme } from "../../theme/personaTheme";
import type { MobilePickedFile } from "./types";

type ChatComposerProps = {
  theme: MobileTheme;
  disabled?: boolean;
  uploadingAttachments?: boolean;
  voiceInputActive?: boolean;
  attachments: MobilePickedFile[];
  draftMessage?: string | undefined;
  placeholder: string;
  onAttach: () => void;
  onAudioMenu: () => void;
  onDraftChange?: (draft: string) => void;
  onMicPress: () => void;
  onRemoveAttachment: (id: string) => void;
  onSubmit: (message: string) => void;
};

export function ChatComposer({
  theme,
  disabled,
  uploadingAttachments,
  voiceInputActive,
  attachments,
  draftMessage,
  placeholder,
  onAttach,
  onAudioMenu,
  onDraftChange,
  onMicPress,
  onRemoveAttachment,
  onSubmit
}: ChatComposerProps) {
  const [draft, setDraft] = useState("");
  const canSend = draft.trim().length > 0 && !disabled && !uploadingAttachments;

  useEffect(() => {
    if (draftMessage === undefined) return;
    setDraft(draftMessage);
  }, [draftMessage]);

  function submit(): void {
    const message = draft.trim();
    if (!message || disabled || uploadingAttachments) return;
    setDraft("");
    onDraftChange?.("");
    onSubmit(message);
  }

  function updateDraft(nextDraft: string): void {
    setDraft(nextDraft);
    onDraftChange?.(nextDraft);
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
          onChangeText={updateDraft}
          editable={!disabled && !uploadingAttachments}
          placeholder={uploadingAttachments ? "Uploading attachments..." : placeholder}
          placeholderTextColor={theme.muted}
          multiline
          maxLength={4000}
          style={[styles.input, { color: theme.text }]}
        />
        <View style={styles.trailingControls}>
          {canSend ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Send message"
              onPress={submit}
              style={[styles.sendButton, { backgroundColor: theme.text }]}
            >
              <Ionicons name="arrow-up" size={20} color={theme.background} />
            </Pressable>
          ) : (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Voice input"
              disabled={disabled || uploadingAttachments}
              onPress={onMicPress}
              style={[
                styles.micButton,
                {
                  backgroundColor: voiceInputActive ? theme.accent : "rgba(255,255,255,0.08)"
                }
              ]}
            >
              <Ionicons name={voiceInputActive ? "stop" : "mic-outline"} size={20} color={theme.text} />
            </Pressable>
          )}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Persona audio options"
            onPress={onAudioMenu}
            style={[styles.audioButton, { backgroundColor: theme.accent }]}
          >
            <View style={styles.audioGlyph}>
              <View style={[styles.audioBar, styles.audioBarShort, { backgroundColor: theme.text }]} />
              <View style={[styles.audioBar, styles.audioBarTall, { backgroundColor: theme.text }]} />
              <View style={[styles.audioBar, styles.audioBarMedium, { backgroundColor: theme.text }]} />
            </View>
          </Pressable>
        </View>
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
  audioBar: {
    borderRadius: 999,
    width: 3
  },
  audioBarMedium: {
    height: 16
  },
  audioBarShort: {
    height: 10
  },
  audioBarTall: {
    height: 22
  },
  audioButton: {
    alignItems: "center",
    borderRadius: 999,
    height: 46,
    justifyContent: "center",
    width: 46
  },
  audioGlyph: {
    alignItems: "center",
    flexDirection: "row",
    gap: 4,
    justifyContent: "center"
  },
  input: {
    flex: 1,
    fontSize: 16,
    lineHeight: 21,
    maxHeight: 110,
    minHeight: 24,
    paddingVertical: 10
  },
  micButton: {
    alignItems: "center",
    borderRadius: 999,
    height: 36,
    justifyContent: "center",
    width: 36
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
  trailingControls: {
    alignItems: "center",
    flexDirection: "row",
    gap: 6
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
