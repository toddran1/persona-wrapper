import { useEffect, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View, type LayoutChangeEvent } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import { MAX_CHAT_MESSAGE_CHARACTERS } from "@persona/shared";
import type { MobileTheme } from "../../theme/personaTheme";
import type { MobilePickedFile } from "./types";
import { useLocalization } from "../../localization/LocalizationProvider";

type ChatComposerProps = {
  theme: MobileTheme;
  compact?: boolean;
  disabled?: boolean;
  requestInProgress?: boolean;
  uploadingAttachments?: boolean;
  voiceInputActive?: boolean;
  attachments: MobilePickedFile[];
  draftMessage?: string | undefined;
  placeholder: string;
  onAttach: () => void;
  onQuickMenu: () => void;
  onDraftChange?: (draft: string) => void;
  onMicPress: () => void;
  onHeightChange?: (height: number) => void;
  onRemoveAttachment: (id: string) => void;
  onSubmit: (message: string) => void;
  onStop: () => void;
};

export function ChatComposer({
  theme,
  compact = false,
  disabled,
  requestInProgress = false,
  uploadingAttachments,
  voiceInputActive,
  attachments,
  draftMessage,
  placeholder,
  onAttach,
  onQuickMenu,
  onDraftChange,
  onMicPress,
  onHeightChange,
  onRemoveAttachment,
  onSubmit,
  onStop
}: ChatComposerProps) {
  const { t } = useLocalization();
  const [draft, setDraft] = useState("");
  const [messageError, setMessageError] = useState<string | undefined>();
  const hasDraft = draft.trim().length > 0;
  const hasAttachments = attachments.length > 0;
  const canSend = (hasDraft || hasAttachments) && !disabled && !uploadingAttachments && !requestInProgress;
  const composerLocked = Boolean(disabled || uploadingAttachments || requestInProgress);

  useEffect(() => {
    if (draftMessage === undefined) return;
    setDraft(draftMessage);
  }, [draftMessage]);

  function submit(): void {
    const message = draft.trim();
    if ((!message && !hasAttachments) || disabled || uploadingAttachments || requestInProgress) return;
    if (message.length > MAX_CHAT_MESSAGE_CHARACTERS) {
      setMessageError(t("composer.messageTooLong", {
        count: message.length,
        limit: MAX_CHAT_MESSAGE_CHARACTERS
      }));
      return;
    }
    setDraft("");
    setMessageError(undefined);
    onDraftChange?.("");
    onSubmit(message);
  }

  function updateDraft(nextDraft: string): void {
    setDraft(nextDraft);
    if (nextDraft.length <= MAX_CHAT_MESSAGE_CHARACTERS) {
      setMessageError(undefined);
    }
    onDraftChange?.(nextDraft);
  }

  const quickMenuButton = (
    <Pressable
      accessibilityRole="button"
      testID="mobile-quick-menu"
      accessibilityLabel={t("composer.quickMenu")}
      disabled={Boolean(disabled || uploadingAttachments)}
      hitSlop={6}
      onPress={onQuickMenu}
      style={[
        styles.quickMenuButton,
        compact ? styles.quickMenuButtonCompact : null,
        {
          backgroundColor: theme.accent2,
          borderColor: theme.accent,
          opacity: disabled || uploadingAttachments ? 0.45 : 1,
          shadowColor: theme.accent2
        }
      ]}
    >
      <Ionicons name="options-outline" size={20} color={theme.background} />
    </Pressable>
  );

  return (
    <View
      style={styles.shell}
      onLayout={(event: LayoutChangeEvent) => onHeightChange?.(event.nativeEvent.layout.height)}
    >
      {attachments.length > 0 ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.attachmentTray}>
          {attachments.map((attachment) => (
            <View key={attachment.id} style={[styles.attachmentChip, { borderColor: theme.border, backgroundColor: "rgba(255,255,255,0.055)" }]}>
              <Ionicons name={attachment.kind === "image" ? "image-outline" : "document-text-outline"} size={16} color={theme.accent2} />
              <Text style={[styles.attachmentName, { color: theme.text }]} numberOfLines={1}>{attachment.name}</Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t("composer.removeAttachment", { name: attachment.name })}
                onPress={() => onRemoveAttachment(attachment.id)}
                style={styles.removeAttachment}
              >
                <Ionicons name="close" size={14} color={theme.muted} />
              </Pressable>
            </View>
          ))}
        </ScrollView>
      ) : null}
      <View style={[styles.wrap, compact ? styles.wrapCompact : null, { borderColor: theme.border, backgroundColor: theme.surfaceStrong }]}>
        <Pressable
          accessibilityRole="button"
          testID="mobile-attach-file"
          accessibilityLabel={t("composer.attach")}
          accessibilityState={{ disabled: composerLocked }}
          disabled={composerLocked}
          onPress={onAttach}
          style={styles.sideButton}
        >
          <Ionicons name="add" size={25} color={theme.muted} />
        </Pressable>
        <TextInput
          testID="mobile-chat-composer"
          accessibilityLabel={t("composer.message")}
          value={draft}
          onChangeText={updateDraft}
          editable={!composerLocked}
          placeholder={uploadingAttachments ? t("composer.uploading") : placeholder}
          placeholderTextColor={theme.muted}
          multiline
          style={[styles.input, compact ? styles.inputCompact : null, { color: theme.text }]}
        />
        <View style={styles.trailingControls}>
          {requestInProgress ? (
            <Pressable
              accessibilityRole="button"
              testID="mobile-stop-message"
              accessibilityLabel={t("composer.stop")}
              hitSlop={6}
              onPress={onStop}
              style={[
                styles.sendButton,
                compact ? styles.sendButtonCompact : null,
                styles.stopButton,
                { backgroundColor: theme.danger }
              ]}
            >
              <Ionicons name="stop" size={18} color={theme.background} />
            </Pressable>
          ) : canSend ? (
            <View style={styles.sendControlStack}>
              {quickMenuButton}
              <Pressable
                accessibilityRole="button"
                testID="mobile-send-message"
                accessibilityLabel={t("composer.send")}
                hitSlop={6}
                onPress={submit}
                style={[
                  styles.sendButton,
                  compact ? styles.sendButtonCompact : null,
                  { backgroundColor: theme.text }
                ]}
              >
                <Ionicons name="arrow-up" size={20} color={theme.background} />
              </Pressable>
            </View>
          ) : (
            <>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t("composer.voice")}
                accessibilityState={{ disabled: Boolean(disabled || uploadingAttachments), selected: voiceInputActive }}
                disabled={disabled || uploadingAttachments}
                hitSlop={6}
                onPress={onMicPress}
                style={[
                  styles.micButton,
                  compact ? styles.micButtonCompact : null,
                  {
                    backgroundColor: voiceInputActive ? theme.accent : "rgba(255,255,255,0.08)"
                  }
                ]}
              >
                <Ionicons name={voiceInputActive ? "stop" : "mic-outline"} size={20} color={theme.text} />
              </Pressable>
              {quickMenuButton}
            </>
          )}
        </View>
      </View>
      {messageError ? (
        <Text accessibilityLiveRegion="polite" style={[styles.messageError, { color: theme.danger }]}>
          {messageError}
        </Text>
      ) : null}
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
  quickMenuButton: {
    alignItems: "center",
    borderRadius: 999,
    borderWidth: 1,
    height: 36,
    justifyContent: "center",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.22,
    shadowRadius: 14,
    width: 36
  },
  quickMenuButtonCompact: {
    height: 34,
    width: 34
  },
  input: {
    flex: 1,
    fontSize: 16,
    lineHeight: 21,
    maxHeight: 110,
    minHeight: 24,
    paddingVertical: 10
  },
  inputCompact: {
    fontSize: 15,
    lineHeight: 20
  },
  micButton: {
    alignItems: "center",
    borderRadius: 999,
    height: 36,
    justifyContent: "center",
    width: 36
  },
  micButtonCompact: {
    height: 34,
    width: 34
  },
  messageError: {
    fontSize: 12.5,
    fontWeight: "600",
    paddingHorizontal: 6
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
  sendButtonCompact: {
    height: 34,
    width: 34
  },
  sendControlStack: {
    alignItems: "center",
    gap: 6
  },
  stopButton: {
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.22)"
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
  },
  wrapCompact: {
    gap: 5,
    paddingHorizontal: 6
  }
});
