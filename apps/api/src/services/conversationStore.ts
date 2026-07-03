import { randomUUID } from "node:crypto";
import type { ChatMessage, ConversationDetail, ConversationSummary, ConversationTurn } from "@persona/shared";
import { and, asc, desc, eq, isNull, or } from "drizzle-orm";
import { env } from "../config/env.js";
import { getDatabase } from "../db/client.js";
import { conversations, messages as dbMessages } from "../db/schema.js";

type ConversationRecord = {
  id: string;
  userId?: string | null;
  personaId?: string | null;
  title?: string | null;
  createdAt?: Date;
  updatedAt?: Date;
  messages: ChatMessage[];
  turns?: ConversationTurn[];
};

type ConversationMessageMetadata = {
  outputs?: ConversationTurn["outputs"];
  usage?: ConversationTurn["usage"];
  userAssets?: ConversationTurn["userAssets"];
  backgroundJobId?: string;
};

type ConversationAppendMessage = ChatMessage & {
  metadata?: ConversationMessageMetadata;
};

type ConversationOptions = {
  userId?: string;
  personaId?: string;
  titleSeed?: string;
};

export class ConversationStore {
  private readonly conversations = new Map<string, ConversationRecord>();

  async getOrCreate(conversationId?: string, seedHistory: ChatMessage[] = [], options: ConversationOptions = {}): Promise<ConversationRecord> {
    const db = getDatabase();
    if (db) {
      return this.getOrCreateFromDatabase(conversationId, seedHistory, options);
    }

    if (conversationId) {
      const existing = this.conversations.get(conversationId);
      if (existing) {
        if (options.userId && existing.userId && existing.userId !== options.userId) {
          throw new Error("Conversation belongs to another owner.");
        }
        return existing;
      }
    }

    const id = conversationId ?? `conv_${randomUUID()}`;
    const now = new Date();
    const record: ConversationRecord = {
      id,
      userId: options.userId ?? null,
      personaId: options.personaId ?? null,
      title: titleFromMessage(options.titleSeed) ?? "New conversation",
      createdAt: now,
      updatedAt: now,
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

  async appendTurn(record: ConversationRecord, messages: ConversationAppendMessage[]): Promise<ConversationRecord> {
    const db = getDatabase();
    if (db) {
      const firstSequence = record.messages.length;
      if (messages.length > 0) {
        await db.insert(dbMessages).values(messages.map((message, index) => ({
          id: `msg_${randomUUID()}`,
          conversationId: record.id,
          role: message.role,
          content: message.content,
          name: message.name,
          sequence: firstSequence + index,
          metadata: message.metadata ?? {}
        })));
        const nextTitle = record.title || titleFromMessages([...record.messages, ...messages]) || "New conversation";
        await db.update(conversations)
          .set({ title: nextTitle, updatedAt: new Date() })
          .where(eq(conversations.id, record.id));
      }
      return {
        ...record,
        title: record.title || titleFromMessages([...record.messages, ...messages]) || "New conversation",
        updatedAt: new Date(),
        messages: [...record.messages, ...messages.map(stripMessageMetadata)],
        turns: appendRenderedTurns(record.turns ?? buildConversationTurns(record.messages), messages)
      };
    }

    const nextMessages = messages.map(stripMessageMetadata);
    const updated: ConversationRecord = {
      ...record,
      title: record.title || titleFromMessages([...record.messages, ...nextMessages]) || "New conversation",
      updatedAt: new Date(),
      messages: [...record.messages, ...nextMessages],
      turns: appendRenderedTurns(record.turns ?? buildConversationTurns(record.messages), messages)
    };

    this.conversations.set(record.id, updated);
    return updated;
  }

  async clear(conversationId: string): Promise<void> {
    const db = getDatabase();
    if (db) {
      await db.delete(conversations).where(eq(conversations.id, conversationId));
      return;
    }
    this.conversations.delete(conversationId);
  }

  async list(userId?: string): Promise<ConversationSummary[]> {
    const db = getDatabase();
    if (db) {
      const rows = await db.query.conversations.findMany({
        where: userId ? eq(conversations.userId, userId) : isNull(conversations.userId),
        with: {
          messages: {
            columns: {
              id: true
            }
          }
        },
        orderBy: desc(conversations.updatedAt),
        limit: 100
      });

      return rows.map((row) => ({
        id: row.id,
        ...(row.personaId ? { personaId: row.personaId } : {}),
        title: row.title || titleFromMessages([]) || "New conversation",
        messageCount: row.messages.length,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString()
      }));
    }

    return [...this.conversations.values()]
      .filter((conversation) => userId ? conversation.userId === userId : !conversation.userId)
      .sort((left, right) => (right.updatedAt?.getTime() ?? 0) - (left.updatedAt?.getTime() ?? 0))
      .slice(0, 100)
      .map((conversation) => ({
        id: conversation.id,
        ...(conversation.personaId ? { personaId: conversation.personaId } : {}),
        title: conversation.title || titleFromMessages(conversation.messages) || "New conversation",
        messageCount: conversation.messages.length,
        createdAt: (conversation.createdAt ?? new Date()).toISOString(),
        updatedAt: (conversation.updatedAt ?? new Date()).toISOString()
      }));
  }

  async get(conversationId: string, userId?: string): Promise<ConversationDetail | undefined> {
    const db = getDatabase();
    if (db) {
      const row = await db.query.conversations.findFirst({
        where: and(
          eq(conversations.id, conversationId),
          userId ? eq(conversations.userId, userId) : isNull(conversations.userId)
        ),
        with: {
          messages: {
            orderBy: asc(dbMessages.sequence)
          }
        }
      });
      if (!row) return undefined;
      const history = row.messages.map(rowToChatMessage);
      return {
        id: row.id,
        ...(row.personaId ? { personaId: row.personaId } : {}),
        title: row.title || titleFromMessages(history) || "New conversation",
        messageCount: history.length,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
        history,
        turns: buildConversationTurns(history, row.messages.map(rowToMessageMetadata))
      };
    }

    const conversation = this.conversations.get(conversationId);
    if (!conversation) return undefined;
    if (userId && conversation.userId && conversation.userId !== userId) return undefined;
    return {
      id: conversation.id,
      ...(conversation.personaId ? { personaId: conversation.personaId } : {}),
      title: conversation.title || titleFromMessages(conversation.messages) || "New conversation",
      messageCount: conversation.messages.length,
      createdAt: (conversation.createdAt ?? new Date()).toISOString(),
      updatedAt: (conversation.updatedAt ?? new Date()).toISOString(),
      history: conversation.messages,
      turns: conversation.turns ?? buildConversationTurns(conversation.messages)
    };
  }

  async delete(conversationId: string, userId?: string): Promise<boolean> {
    const db = getDatabase();
    if (db) {
      const deleted = await db.delete(conversations)
        .where(and(
          eq(conversations.id, conversationId),
          userId ? eq(conversations.userId, userId) : isNull(conversations.userId)
        ))
        .returning({ id: conversations.id });
      return deleted.length > 0;
    }

    const conversation = this.conversations.get(conversationId);
    if (!conversation) return false;
    if (userId && conversation.userId && conversation.userId !== userId) return false;
    return this.conversations.delete(conversationId);
  }

  async rename(conversationId: string, title: string, userId?: string): Promise<ConversationSummary | undefined> {
    const normalizedTitle = normalizeTitle(title);
    const db = getDatabase();
    if (db) {
      const updated = await db.update(conversations)
        .set({ title: normalizedTitle, updatedAt: new Date() })
        .where(and(
          eq(conversations.id, conversationId),
          userId ? eq(conversations.userId, userId) : isNull(conversations.userId)
        ))
        .returning({
          id: conversations.id,
          personaId: conversations.personaId,
          title: conversations.title,
          createdAt: conversations.createdAt,
          updatedAt: conversations.updatedAt
        });
      const row = updated[0];
      if (!row) return undefined;
      const messageCount = await db.query.messages.findMany({
        where: eq(dbMessages.conversationId, conversationId),
        columns: { id: true }
      });
      return {
        id: row.id,
        ...(row.personaId ? { personaId: row.personaId } : {}),
        title: row.title || normalizedTitle,
        messageCount: messageCount.length,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString()
      };
    }

    const conversation = this.conversations.get(conversationId);
    if (!conversation) return undefined;
    if (userId && conversation.userId && conversation.userId !== userId) return undefined;
    const updated: ConversationRecord = {
      ...conversation,
      title: normalizedTitle,
      updatedAt: new Date()
    };
    this.conversations.set(conversationId, updated);
    return {
      id: updated.id,
      ...(updated.personaId ? { personaId: updated.personaId } : {}),
      title: updated.title || normalizedTitle,
      messageCount: updated.messages.length,
      createdAt: (updated.createdAt ?? new Date()).toISOString(),
      updatedAt: (updated.updatedAt ?? new Date()).toISOString()
    };
  }

  private async getOrCreateFromDatabase(conversationId?: string, seedHistory: ChatMessage[] = [], options: ConversationOptions = {}): Promise<ConversationRecord> {
    const db = getDatabase();
    if (!db) throw new Error("Database is not configured.");

    if (conversationId) {
      const existing = await db.query.conversations.findFirst({
        where: and(
          eq(conversations.id, conversationId),
          options.userId
            ? or(eq(conversations.userId, options.userId), isNull(conversations.userId))
            : isNull(conversations.userId)
        ),
        with: {
          messages: {
            orderBy: asc(dbMessages.sequence)
          }
        }
      });
      if (existing) {
        if (options.userId && !existing.userId) {
          await db.update(conversations)
            .set({ userId: options.userId, personaId: existing.personaId ?? options.personaId ?? null })
            .where(eq(conversations.id, existing.id));
        }
        return {
          id: existing.id,
          userId: existing.userId ?? options.userId ?? null,
          personaId: existing.personaId ?? options.personaId ?? null,
          title: existing.title,
          createdAt: existing.createdAt,
          updatedAt: existing.updatedAt,
          messages: existing.messages.map(rowToChatMessage),
          turns: buildConversationTurns(existing.messages.map(rowToChatMessage), existing.messages.map(rowToMessageMetadata))
        };
      }
    }

    const id = conversationId ?? `conv_${randomUUID()}`;
    await db.insert(conversations).values({
      id,
      userId: options.userId,
      personaId: options.personaId,
      title: titleFromMessage(options.titleSeed) ?? titleFromMessages(seedHistory) ?? "New conversation"
    });
    if (seedHistory.length > 0) {
      await db.insert(dbMessages).values(seedHistory.map((message, index) => ({
        id: `msg_${randomUUID()}`,
        conversationId: id,
        role: message.role,
        content: message.content,
        name: message.name,
        sequence: index,
        metadata: {}
      })));
    }

    return {
      id,
      userId: options.userId ?? null,
      personaId: options.personaId ?? null,
      title: titleFromMessage(options.titleSeed) ?? titleFromMessages(seedHistory) ?? "New conversation",
      messages: [...seedHistory],
      turns: buildConversationTurns(seedHistory)
    };
  }
}

function rowToChatMessage(message: { role: string; content: string; name: string | null }): ChatMessage {
  return {
    role: message.role as ChatMessage["role"],
    content: message.content,
    ...(message.name ? { name: message.name } : {})
  };
}

function rowToMessageMetadata(message: { metadata?: Record<string, unknown> | null }): ConversationMessageMetadata | undefined {
  if (!message.metadata || typeof message.metadata !== "object") return undefined;
  return message.metadata as ConversationMessageMetadata;
}

function stripMessageMetadata(message: ConversationAppendMessage): ChatMessage {
  return {
    role: message.role,
    content: message.content,
    ...(message.name ? { name: message.name } : {})
  };
}

function appendRenderedTurns(existingTurns: ConversationTurn[], messages: ConversationAppendMessage[]): ConversationTurn[] {
  if (messages.length < 2) return existingTurns;
  const user = messages.find((message) => message.role === "user");
  const assistant = messages.find((message) => message.role === "assistant");
  if (!user || !assistant) return existingTurns;
  return [
    ...existingTurns,
    {
      userMessage: user.content,
      userAssets: user.metadata?.userAssets ?? [],
      assistantText: assistant.content,
      outputs: assistant.metadata?.outputs ?? (assistant.content ? [{ type: "text", text: assistant.content }] : []),
      ...(assistant.metadata?.usage ? { usage: assistant.metadata.usage } : {}),
      ...(assistant.metadata?.backgroundJobId ? { backgroundJobId: assistant.metadata.backgroundJobId } : {})
    }
  ];
}

function buildConversationTurns(history: ChatMessage[], metadata: Array<ConversationMessageMetadata | undefined> = []): ConversationTurn[] {
  const turns: ConversationTurn[] = [];
  for (let index = 0; index < history.length; index += 1) {
    const message = history[index];
    if (!message || message.role !== "user") continue;
    const userMetadata = metadata[index];
    let assistant: ChatMessage | undefined;
    let assistantMetadata: ConversationMessageMetadata | undefined;
    for (let nextIndex = index + 1; nextIndex < history.length; nextIndex += 1) {
      const candidate = history[nextIndex];
      if (!candidate || candidate.role === "user") break;
      if (candidate.role === "assistant") {
        assistant = candidate;
        assistantMetadata = metadata[nextIndex];
        break;
      }
    }
    turns.push({
      userMessage: message.content,
      userAssets: userMetadata?.userAssets ?? [],
      assistantText: assistant?.content ?? "",
      outputs: assistantMetadata?.outputs ?? (assistant?.content ? [{ type: "text", text: assistant.content }] : []),
      ...(assistantMetadata?.usage ? { usage: assistantMetadata.usage } : {}),
      ...(assistantMetadata?.backgroundJobId ? { backgroundJobId: assistantMetadata.backgroundJobId } : {})
    });
  }
  return turns;
}

function titleFromMessages(messages: ChatMessage[]): string | undefined {
  return titleFromMessage(messages.find((message) => message.role === "user")?.content);
}

function titleFromMessage(message: string | undefined): string | undefined {
  const normalized = message?.replace(/\s+/g, " ").trim();
  if (!normalized) return undefined;
  return normalized.length > 48 ? `${normalized.slice(0, 45).trim()}...` : normalized;
}

function normalizeTitle(title: string): string {
  const normalized = title.replace(/\s+/g, " ").trim();
  if (!normalized) return "New conversation";
  return normalized.length > 120 ? normalized.slice(0, 117).trim() + "..." : normalized;
}
