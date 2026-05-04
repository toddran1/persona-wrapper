import { randomUUID } from "node:crypto";
import type { ChatMessage } from "@persona/shared";

type ConversationRecord = {
  id: string;
  messages: ChatMessage[];
};

const MAX_PROMPT_HISTORY_MESSAGES = 12;

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
    return record.messages.slice(-MAX_PROMPT_HISTORY_MESSAGES);
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

