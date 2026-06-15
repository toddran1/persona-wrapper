import { randomUUID } from "node:crypto";
import type { ChatMessage } from "@persona/shared";
import { env } from "../config/env.js";

type ConversationRecord = {
  id: string;
  messages: ChatMessage[];
};

export class ConversationStore {
  private readonly conversations = new Map<string, ConversationRecord>();

  getOrCreate(conversationId?: string, seedHistory: ChatMessage[] = []): ConversationRecord {
    if (conversationId) {
      const existing = this.conversations.get(conversationId);
      if (existing) {
        return existing;
      }
    }

    const id = conversationId ?? `conv_${randomUUID()}`;
    const record: ConversationRecord = {
      id,
      messages: [...seedHistory]
    };

    this.conversations.set(id, record);
    return record;
  }

  getPromptHistory(record: ConversationRecord): ChatMessage[] {
    const selected: ChatMessage[] = [];
    let characters = 0;
    for (let index = record.messages.length - 1; index >= 0; index -= 1) {
      const message = record.messages[index];
      if (!message) continue;
      if (selected.length >= env.OPENAI_MAX_CONTEXT_MESSAGES) break;
      if (selected.length > 0 && characters + message.content.length > env.OPENAI_MAX_CONTEXT_CHARACTERS) break;
      selected.unshift(message);
      characters += message.content.length;
    }
    while (selected[0]?.role === "assistant" || selected[0]?.role === "tool") selected.shift();
    return selected;
  }

  appendTurn(record: ConversationRecord, messages: ChatMessage[]): ConversationRecord {
    const updated: ConversationRecord = {
      ...record,
      messages: [...record.messages, ...messages]
    };

    this.conversations.set(record.id, updated);
    return updated;
  }

  clear(conversationId: string): void {
    this.conversations.delete(conversationId);
  }
}
