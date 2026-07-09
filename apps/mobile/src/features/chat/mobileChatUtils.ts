import type { ChatResponse, ClientContext, ConversationSummary, ConversationTurn } from "@persona/shared";
import type { RenderedTurn } from "./types";

export function sortConversationSummaries(left: ConversationSummary, right: ConversationSummary): number {
  const pinnedDelta = Number(right.pinned) - Number(left.pinned);
  if (pinnedDelta !== 0) return pinnedDelta;
  return Date.parse(right.updatedAt) - Date.parse(left.updatedAt);
}

export function turnsFromConversationTurns(turns: ConversationTurn[]): RenderedTurn[] {
  return turns.map((turn, index) => ({
    id: `${index}-${turn.userMessage.slice(0, 16)}`,
    userMessage: turn.userMessage,
    userAssets: turn.userAssets,
    assistantText: turn.assistantText,
    outputs: turn.outputs,
    backgroundJobId: turn.backgroundJobId
  }));
}

export function turnFromChatResponse(prompt: string, response: ChatResponse): RenderedTurn {
  const assistantText = response.outputs
    .filter((output) => output.type === "text")
    .map((output) => output.text)
    .join("\n\n");
  return {
    id: `${response.conversationId}-${response.generatedAt}`,
    userMessage: prompt,
    assistantText,
    outputs: response.outputs
  };
}

export function getClientContext(): ClientContext {
  const now = new Date();
  const offsetMinutes = -now.getTimezoneOffset();
  return {
    locale: Intl.DateTimeFormat().resolvedOptions().locale,
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    currentDateTime: now.toISOString(),
    utcOffsetMinutes: offsetMinutes
  };
}

export function formatConversationTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString([], { month: "short", day: "numeric" });
}
