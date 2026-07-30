import type { ChatMessage, PersonaDefinition } from "@persona/shared";
import { getPersonaById } from "../personas/index.js";

export function personaAttributionInstructions(persona: PersonaDefinition): string[] {
  return [
    "Conversation history can contain assistant replies from multiple personas.",
    "Historical assistant messages may begin with an [Assistant persona: ...] marker identifying who produced that reply.",
    "Keep those replies attributed to that historical persona. Do not treat another persona's opinions, biography, favorites, claims, or speaking style as your own.",
    `Answer the current user only as ${persona.name} (persona id: ${persona.id}), while using relevant factual and conversational context from every prior turn.`,
    "If the user compares personas or refers to what one said earlier, preserve the distinction explicitly."
  ];
}

export function formatPersonaAttributedHistoryMessage(message: ChatMessage): ChatMessage {
  if (message.role !== "assistant" || !message.personaId) return message;
  const persona = getPersonaById(message.personaId);
  const label = persona?.name ?? "Unavailable or retired persona";
  return {
    role: message.role,
    content: `[Assistant persona: ${label} | id=${message.personaId}]\n${message.content}`,
    ...(message.name ? { name: message.name } : {})
  };
}

export function personaMemoryLabel(personaId: string | undefined): string {
  if (!personaId) return "Assistant";
  const persona = getPersonaById(personaId);
  return `Assistant (${persona?.name ?? `unavailable persona ${personaId}`})`;
}
