import type { ChatResponse, ClientContext, ConversationSummary, ConversationTurn } from "@persona/shared";
import type { RenderedTurn } from "./types";

export function sortConversationSummaries(left: ConversationSummary, right: ConversationSummary): number {
  const pinnedDelta = Number(right.pinned) - Number(left.pinned);
  if (pinnedDelta !== 0) return pinnedDelta;
  return Date.parse(right.updatedAt) - Date.parse(left.updatedAt);
}

export function turnsFromConversationTurns(turns: ConversationTurn[]): RenderedTurn[] {
  return turns.map((turn, index) => ({
    id: turn.assistantMessageId ?? `${index}-${turn.userMessage.slice(0, 16)}`,
    ...(turn.userMessageId ? { userMessageId: turn.userMessageId } : {}),
    ...(turn.assistantMessageId ? { assistantMessageId: turn.assistantMessageId } : {}),
    ...(turn.personaId ? { personaId: turn.personaId } : {}),
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
    id: response.assistantMessageId ?? `${response.conversationId}-${response.generatedAt}`,
    ...(response.userMessageId ? { userMessageId: response.userMessageId } : {}),
    ...(response.assistantMessageId ? { assistantMessageId: response.assistantMessageId } : {}),
    personaId: response.persona.id,
    userMessage: prompt,
    assistantText,
    outputs: response.outputs
  };
}

function turnSyncKey(turn: RenderedTurn): string {
  return turn.assistantMessageId ?? turn.userMessageId ?? turn.backgroundJobId ?? turn.id;
}

// Merges a freshly fetched latest page of turns over the local list: fresh
// turns replace their local copies (updating status/output), while older
// paginated turns and unsynced local turns are kept. Used when another
// session may have appended messages (cross-session sync on foreground).
export function mergeCrossSessionTurns(current: RenderedTurn[], fresh: RenderedTurn[]): RenderedTurn[] {
  const freshKeys = new Set(fresh.map(turnSyncKey));
  return [...current.filter((turn) => !freshKeys.has(turnSyncKey(turn))), ...fresh];
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

export function formatConversationTime(value: string, locale?: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString(locale, { month: "short", day: "numeric" });
}
