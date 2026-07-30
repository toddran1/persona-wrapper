import { memo, useMemo } from "react";
import { Pressable, StyleSheet, Text, View, type LayoutChangeEvent } from "react-native";
import { stripGeneratedFileDownloadPrompt, type ContentBlock } from "@persona/shared";
import Ionicons from "@expo/vector-icons/Ionicons";
import type { MobileTheme } from "../../theme/personaTheme";
import { OutputBlocks } from "./OutputBlocks";
import type { RenderedTurn } from "./types";

type OutputAction = Extract<ContentBlock, { type: "action" }>;

export type ChatTurnProps = {
  turn: RenderedTurn;
  personaLabel: string;
  personaAccent: string;
  theme: MobileTheme;
  expanded: boolean;
  checkingBackgroundJob: boolean;
  checkingLabel: string;
  checkStatusLabel: string;
  onCopyPrompt: (turn: RenderedTurn) => void;
  onEditPrompt: (turn: RenderedTurn) => void;
  onShowPromptActions: (turn: RenderedTurn) => void;
  onOutputAction: (action: OutputAction) => void;
  onResumeBackgroundJob: (turn: RenderedTurn) => void;
  onCopyResponse: (turn: RenderedTurn) => void;
  onShowResponseActions: (turn: RenderedTurn) => void;
  onAssistantLayout: (turnId: string, offsetY: number) => void;
};

type MessageAction = {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
};

function responseTextForDisplay(turn: Pick<RenderedTurn, "assistantText" | "outputs">): string {
  return turn.outputs.some((output) => output.type === "file")
    ? stripGeneratedFileDownloadPrompt(turn.assistantText)
    : turn.assistantText;
}

function isStillRunningTurn(turn: RenderedTurn): boolean {
  return Boolean(
    turn.backgroundJobId
    && turn.outputs.some((output) => output.type === "status" && output.status === "in_progress")
  );
}

function MessageActionRow({
  actions,
  align,
  theme
}: {
  actions: MessageAction[];
  align: "left" | "right";
  theme: MobileTheme;
}) {
  if (actions.length === 0) return null;
  return (
    <View style={[styles.messageActions, align === "right" ? styles.messageActionsRight : styles.messageActionsLeft]}>
      {actions.map((action) => (
        <Pressable
          key={action.label}
          accessibilityRole="button"
          accessibilityLabel={action.label}
          onPress={action.onPress}
          style={styles.messageActionButton}
        >
          <Ionicons name={action.icon} size={15} color={theme.muted} />
        </Pressable>
      ))}
    </View>
  );
}

function ChatTurnView({
  turn,
  personaLabel,
  personaAccent,
  theme,
  expanded,
  checkingBackgroundJob,
  checkingLabel,
  checkStatusLabel,
  onCopyPrompt,
  onEditPrompt,
  onShowPromptActions,
  onOutputAction,
  onResumeBackgroundJob,
  onCopyResponse,
  onShowResponseActions,
  onAssistantLayout
}: ChatTurnProps) {
  const responseText = responseTextForDisplay(turn);
  const promptActions = useMemo<MessageAction[]>(() => [
    { icon: "copy-outline", label: "Copy prompt", onPress: () => onCopyPrompt(turn) },
    { icon: "create-outline", label: "Edit prompt", onPress: () => onEditPrompt(turn) },
    { icon: "ellipsis-horizontal", label: "More prompt actions", onPress: () => onShowPromptActions(turn) }
  ], [onCopyPrompt, onEditPrompt, onShowPromptActions, turn]);
  const responseActions = useMemo<MessageAction[]>(() => [
    ...(responseText.trim()
      ? [{ icon: "copy-outline" as const, label: "Copy response", onPress: () => onCopyResponse(turn) }]
      : []),
    { icon: "ellipsis-horizontal", label: "More response actions", onPress: () => onShowResponseActions(turn) }
  ], [onCopyResponse, onShowResponseActions, responseText, turn]);
  const showCheckStatus = isStillRunningTurn(turn)
    && !turn.outputs.some((output) => (
      output.type === "status"
      && output.status === "in_progress"
      && /\bthinking\b/i.test(output.message)
    ));

  return (
    <View style={styles.turn}>
      <View style={[styles.userBubble, expanded ? styles.expandedUserBubble : styles.defaultUserBubble]}>
        <Text selectable style={[styles.userText, { color: theme.text }]}>{turn.userMessage}</Text>
        {turn.userAssets && turn.userAssets.length > 0 ? (
          <View style={styles.sentAssetStack}>
            {turn.userAssets.map((asset) => (
              <View key={asset.id} style={styles.sentAsset}>
                <Ionicons name={asset.kind === "image" ? "image-outline" : "document-text-outline"} size={14} color={theme.accent2} />
                <Text style={[styles.sentAssetText, { color: theme.muted }]} numberOfLines={1}>{asset.fileName}</Text>
              </View>
            ))}
          </View>
        ) : null}
      </View>
      <MessageActionRow align="right" theme={theme} actions={promptActions} />
      <View
        style={styles.assistantRow}
        onLayout={(event: LayoutChangeEvent) => onAssistantLayout(turn.id, event.nativeEvent.layout.y)}
      >
        <View style={[styles.assistantMark, { backgroundColor: personaAccent }]}>
          <Text style={[styles.assistantMarkText, { color: theme.text }]}>{personaLabel[0] ?? "P"}</Text>
        </View>
        <View style={[styles.assistantContent, expanded ? styles.expandedAssistantBubble : null]}>
          <OutputBlocks outputs={turn.outputs} theme={theme} onAction={onOutputAction} />
          {showCheckStatus ? (
            <Pressable
              accessibilityRole="button"
              disabled={checkingBackgroundJob}
              onPress={() => onResumeBackgroundJob(turn)}
              style={[
                styles.checkStatusButton,
                {
                  borderColor: theme.border,
                  backgroundColor: checkingBackgroundJob ? "rgba(255,255,255,0.05)" : "rgba(214,181,94,0.12)"
                }
              ]}
            >
              <Ionicons name="refresh" size={16} color={theme.accent2} />
              <Text style={[styles.checkStatusText, { color: theme.text }]}>
                {checkingBackgroundJob ? checkingLabel : checkStatusLabel}
              </Text>
            </Pressable>
          ) : null}
          <MessageActionRow align="left" theme={theme} actions={responseActions} />
        </View>
      </View>
    </View>
  );
}

export const ChatTurn = memo(ChatTurnView);

const styles = StyleSheet.create({
  assistantContent: {
    flex: 1,
    gap: 8,
    minWidth: 0
  },
  assistantMark: {
    alignItems: "center",
    borderRadius: 999,
    height: 30,
    justifyContent: "center",
    marginTop: 2,
    width: 30
  },
  assistantMarkText: {
    fontSize: 13,
    fontWeight: "900",
    textTransform: "uppercase"
  },
  assistantRow: {
    flexDirection: "row",
    gap: 10
  },
  checkStatusButton: {
    alignItems: "center",
    alignSelf: "flex-start",
    borderRadius: 999,
    borderWidth: 1,
    flexDirection: "row",
    gap: 7,
    marginTop: 2,
    paddingHorizontal: 12,
    paddingVertical: 8
  },
  checkStatusText: {
    fontSize: 13,
    fontWeight: "800"
  },
  defaultUserBubble: {
    backgroundColor: "rgba(255,255,255,0.10)"
  },
  expandedAssistantBubble: {
    backgroundColor: "rgba(9,7,14,0.34)",
    borderRadius: 22,
    paddingHorizontal: 13,
    paddingVertical: 11
  },
  expandedUserBubble: {
    backgroundColor: "rgba(255,255,255,0.18)"
  },
  messageActionButton: {
    alignItems: "center",
    backgroundColor: "rgba(255,255,255,0.065)",
    borderRadius: 999,
    height: 31,
    justifyContent: "center",
    width: 31
  },
  messageActions: {
    flexDirection: "row",
    gap: 7,
    marginTop: -8
  },
  messageActionsLeft: {
    alignSelf: "flex-start",
    marginLeft: 2
  },
  messageActionsRight: {
    alignSelf: "flex-end",
    marginRight: 8
  },
  sentAsset: {
    alignItems: "center",
    flexDirection: "row",
    gap: 6,
    minWidth: 0
  },
  sentAssetStack: {
    gap: 6,
    marginTop: 9
  },
  sentAssetText: {
    flexShrink: 1,
    fontSize: 12,
    fontWeight: "700"
  },
  turn: {
    gap: 14
  },
  userBubble: {
    alignSelf: "flex-end",
    borderRadius: 22,
    maxWidth: "84%",
    paddingHorizontal: 15,
    paddingVertical: 11
  },
  userText: {
    fontSize: 16,
    lineHeight: 22
  }
});
