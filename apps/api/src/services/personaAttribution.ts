import type { ChatMessage, PersonaDefinition } from "@persona/shared";
import { getPersonaById } from "../personas/index.js";

export function personaAttributionInstructions(persona: PersonaDefinition): string[] {
  return [
    "Conversation history can contain assistant replies from multiple personas.",
    "Historical assistant messages may begin with an [Assistant persona: ...] marker identifying who produced that reply.",
    "That marker is private conversation metadata. Never repeat, quote, paraphrase, or include an [Assistant persona: ...] marker in your response.",
    "Keep those replies attributed to that historical persona. Do not treat another persona's opinions, biography, favorites, claims, or speaking style as your own.",
    `Answer the current user only as ${persona.name} (persona id: ${persona.id}), while using relevant factual and conversational context from every prior turn.`,
    "If the user compares personas or refers to what one said earlier, preserve the distinction explicitly."
  ];
}

const PERSONA_ATTRIBUTION_LINE_PATTERN = /^[\t ]*(?:>\s*)?(?:\*\*|__)?\[Assistant persona:[^\]\r\n]*\](?:\*\*|__)?[\t ]*(?:\r?\n|$)/gim;
const LEADING_PERSONA_ATTRIBUTION_PATTERN = /^\s*(?:\*\*|__)?\[Assistant persona:[^\]\r\n]*\](?:\*\*|__)?\s*/i;

export function stripPersonaAttributionMarkers(text: string): string {
  const withoutMarkerLines = text.replace(PERSONA_ATTRIBUTION_LINE_PATTERN, "");
  const sanitized = withoutMarkerLines.replace(LEADING_PERSONA_ATTRIBUTION_PATTERN, "");
  return sanitized === text ? text : sanitized.trimStart();
}

export function formatPersonaAttributedHistoryMessage(message: ChatMessage): ChatMessage {
  if (message.role !== "assistant") return message;
  const content = stripPersonaAttributionMarkers(message.content);
  if (!message.personaId) return { ...message, content };
  const persona = getPersonaById(message.personaId);
  const label = persona?.name ?? "Unavailable or retired persona";
  return {
    role: message.role,
    content: `[Assistant persona: ${label} | id=${message.personaId}]\n${content}`,
    ...(message.name ? { name: message.name } : {})
  };
}

export function personaMemoryLabel(personaId: string | undefined): string {
  if (!personaId) return "Assistant";
  const persona = getPersonaById(personaId);
  return `Assistant (${persona?.name ?? `unavailable persona ${personaId}`})`;
}
