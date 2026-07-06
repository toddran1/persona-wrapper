import type { ChatMessage } from "@persona/shared";

const APPROX_CHARS_PER_TOKEN = 4;
const MESSAGE_OVERHEAD_TOKENS = 6;

export function estimateTextTokens(text: string): number {
  if (!text.trim()) return 0;
  return Math.ceil(text.length / APPROX_CHARS_PER_TOKEN);
}

export function estimateChatMessageTokens(message: ChatMessage): number {
  return MESSAGE_OVERHEAD_TOKENS + estimateTextTokens(message.content) + (message.name ? estimateTextTokens(message.name) : 0);
}

export function estimateChatMessagesTokens(messages: ChatMessage[]): number {
  return messages.reduce((total, message) => total + estimateChatMessageTokens(message), 0);
}

export function trimTextToTokenBudget(text: string, maxTokens: number): string {
  if (maxTokens <= 0) return "";
  if (estimateTextTokens(text) <= maxTokens) return text;

  const maxCharacters = Math.max(0, (maxTokens * APPROX_CHARS_PER_TOKEN) - 12);
  const trimmed = text.slice(0, maxCharacters);
  const boundary = Math.max(
    trimmed.lastIndexOf("\n\n"),
    trimmed.lastIndexOf(". "),
    trimmed.lastIndexOf("! "),
    trimmed.lastIndexOf("? ")
  );
  const cut = boundary > Math.floor(maxCharacters * 0.55) ? trimmed.slice(0, boundary + 1) : trimmed;
  return `${cut.trimEnd()}\n[truncated to fit context budget]`;
}
