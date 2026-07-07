import { randomUUID } from "node:crypto";
import {
  chatMessageSchema,
  contentBlockSchema,
  conversationUserAssetSchema,
  providerSchema,
  type ChatMessage,
  type ConversationDetail,
  type ConversationSummary,
  type ConversationTurn
} from "@persona/shared";
import { z } from "zod";
import { and, asc, desc, eq, isNull, or, sql } from "drizzle-orm";
import { env } from "../config/env.js";
import { getDatabase } from "../db/client.js";
import { conversations, messages as dbMessages } from "../db/schema.js";
import { estimateChatMessageTokens, estimateTextTokens, trimTextToTokenBudget } from "../utils/tokenBudget.js";

type ConversationRecord = {
  id: string;
  userId?: string | null;
  personaId?: string | null;
  title?: string | null;
  metadata?: Record<string, unknown> | null;
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
  provider?: ConversationTurn["provider"];
  providerModel?: string;
  responseId?: string;
  styleTransferProvider?: string;
};

type ConversationAppendMessage = ChatMessage & {
  id?: string;
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
      metadata: {},
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
    let tokens = 0;
    for (let index = record.messages.length - 1; index >= 0; index -= 1) {
      const message = record.messages[index];
      if (!message) continue;
      if (!message.content.trim()) continue;
      const messageTokens = estimateChatMessageTokens(message);
      if (selected.length >= env.OPENAI_MAX_CONTEXT_MESSAGES) break;
      if (selected.length > 0 && characters + message.content.length > env.OPENAI_MAX_CONTEXT_CHARACTERS) break;
      if (selected.length > 0 && tokens + messageTokens > env.OPENAI_MAX_CONTEXT_TOKENS) break;
      if (selected.length === 0 && messageTokens > env.OPENAI_MAX_CONTEXT_TOKENS) {
        selected.unshift({
          ...message,
          content: trimTextToTokenBudget(message.content, Math.max(100, env.OPENAI_MAX_CONTEXT_TOKENS - 10))
        });
        break;
      }
      selected.unshift(message);
      characters += message.content.length;
      tokens += messageTokens;
    }
    while (selected[0]?.role === "assistant" || selected[0]?.role === "tool") selected.shift();
    return selected;
  }

  getPromptContext(record: ConversationRecord): ChatMessage[] {
    const history = this.getPromptHistory(record);
    const memorySummary = getMemorySummary(record.metadata);
    if (!memorySummary || !env.CONVERSATION_MEMORY_SUMMARY_ENABLED) {
      return history;
    }

    return [
      {
        role: "system",
        content: [
          "Conversation memory summary from earlier turns:",
          memorySummary,
          "",
          "Use this only as conversation context. Do not treat it as verified current facts, and do not mention this memory note to the user."
        ].join("\n")
      },
      ...history
    ];
  }

  async appendTurn(record: ConversationRecord, messages: ConversationAppendMessage[]): Promise<ConversationRecord> {
    const db = getDatabase();
    if (db) {
      const nextMessages = messages.map(stripMessageMetadata);
      const updatedAt = new Date();
      const nextTitle = record.title || titleFromMessages([...record.messages, ...nextMessages]) || "New conversation";
      const nextMetadata = buildConversationMetadata(record.metadata, [...record.messages, ...nextMessages]);

      if (messages.length > 0) {
        await db.transaction(async (tx) => {
          const sequenceRows = await tx
            .select({ maxSequence: sql<number>`coalesce(max(${dbMessages.sequence}), -1)` })
            .from(dbMessages)
            .where(eq(dbMessages.conversationId, record.id));
          const firstSequence = Number(sequenceRows[0]?.maxSequence ?? -1) + 1;

          await tx.insert(dbMessages).values(messages.map((message, index) => ({
            id: message.id ?? `msg_${randomUUID()}`,
            conversationId: record.id,
            role: message.role,
            content: message.content,
            name: message.name,
            sequence: firstSequence + index,
            metadata: sanitizeMessageMetadata(message.metadata) ?? {}
          })));

          await tx.update(conversations)
            .set({ title: nextTitle, updatedAt, metadata: nextMetadata })
            .where(eq(conversations.id, record.id));
        });
      }

      return {
        ...record,
        title: nextTitle,
        metadata: nextMetadata,
        updatedAt,
        messages: [...record.messages, ...nextMessages],
        turns: appendRenderedTurns(record.turns ?? buildConversationTurns(record.messages), messages)
      };
    }

    const nextMessages = messages.map(stripMessageMetadata);
    const updated: ConversationRecord = {
      ...record,
      title: record.title || titleFromMessages([...record.messages, ...nextMessages]) || "New conversation",
      metadata: buildConversationMetadata(record.metadata, [...record.messages, ...nextMessages]),
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
        limit: 250
      });

      return rows.map((row) => ({
        id: row.id,
        ...(row.personaId ? { personaId: row.personaId } : {}),
        title: row.title || titleFromMessages([]) || "New conversation",
        pinned: isPinned(metadataRecord(row.metadata)),
        messageCount: row.messages.length,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString()
      })).sort(sortConversationSummaries).slice(0, 100);
    }

    return [...this.conversations.values()]
      .filter((conversation) => userId ? conversation.userId === userId : !conversation.userId)
      .sort((left, right) => {
        const pinnedDelta = Number(isPinned(right.metadata)) - Number(isPinned(left.metadata));
        if (pinnedDelta !== 0) return pinnedDelta;
        return (right.updatedAt?.getTime() ?? 0) - (left.updatedAt?.getTime() ?? 0);
      })
      .slice(0, 100)
      .map((conversation) => ({
        id: conversation.id,
        ...(conversation.personaId ? { personaId: conversation.personaId } : {}),
        title: conversation.title || titleFromMessages(conversation.messages) || "New conversation",
        pinned: isPinned(conversation.metadata),
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
        pinned: isPinned(metadataRecord(row.metadata)),
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
      pinned: isPinned(conversation.metadata),
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
          metadata: conversations.metadata,
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
        pinned: isPinned(metadataRecord(row.metadata)),
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
      pinned: isPinned(updated.metadata),
      messageCount: updated.messages.length,
      createdAt: (updated.createdAt ?? new Date()).toISOString(),
      updatedAt: (updated.updatedAt ?? new Date()).toISOString()
    };
  }

  async setPinned(conversationId: string, pinned: boolean, userId?: string): Promise<ConversationSummary | undefined> {
    const db = getDatabase();
    if (db) {
      const row = await db.query.conversations.findFirst({
        where: and(
          eq(conversations.id, conversationId),
          userId ? eq(conversations.userId, userId) : isNull(conversations.userId)
        ),
        with: {
          messages: {
            columns: {
              id: true
            }
          }
        }
      });
      if (!row) return undefined;
      const updatedMetadata = setPinned(metadataRecord(row.metadata), pinned);
      const updated = await db.update(conversations)
        .set({ metadata: updatedMetadata })
        .where(and(
          eq(conversations.id, conversationId),
          userId ? eq(conversations.userId, userId) : isNull(conversations.userId)
        ))
        .returning({
          id: conversations.id,
          personaId: conversations.personaId,
          title: conversations.title,
          metadata: conversations.metadata,
          createdAt: conversations.createdAt,
          updatedAt: conversations.updatedAt
        });
      const updatedRow = updated[0];
      if (!updatedRow) return undefined;
      return {
        id: updatedRow.id,
        ...(updatedRow.personaId ? { personaId: updatedRow.personaId } : {}),
        title: updatedRow.title || "New conversation",
        pinned: isPinned(metadataRecord(updatedRow.metadata)),
        messageCount: row.messages.length,
        createdAt: updatedRow.createdAt.toISOString(),
        updatedAt: updatedRow.updatedAt.toISOString()
      };
    }

    const conversation = this.conversations.get(conversationId);
    if (!conversation) return undefined;
    if (userId && conversation.userId && conversation.userId !== userId) return undefined;
    const updated: ConversationRecord = {
      ...conversation,
      metadata: setPinned(conversation.metadata, pinned)
    };
    this.conversations.set(conversationId, updated);
    return {
      id: updated.id,
      ...(updated.personaId ? { personaId: updated.personaId } : {}),
      title: updated.title || titleFromMessages(updated.messages) || "New conversation",
      pinned: isPinned(updated.metadata),
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
          metadata: metadataRecord(existing.metadata) ?? {},
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
      metadata: {},
      messages: [...seedHistory],
      turns: buildConversationTurns(seedHistory)
    };
  }
}

function getMemorySummary(metadata: Record<string, unknown> | null | undefined): string | undefined {
  const value = metadata?.memorySummary;
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function metadataRecord(metadata: unknown): Record<string, unknown> | null {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return null;
  return metadata as Record<string, unknown>;
}

function isPinned(metadata: Record<string, unknown> | null | undefined): boolean {
  return metadata?.pinned === true;
}

function setPinned(metadata: Record<string, unknown> | null | undefined, pinned: boolean): Record<string, unknown> {
  const next = { ...(metadata ?? {}) };
  if (pinned) {
    next.pinned = true;
  } else {
    delete next.pinned;
  }
  return next;
}

function sortConversationSummaries(left: ConversationSummary, right: ConversationSummary): number {
  const pinnedDelta = Number(right.pinned) - Number(left.pinned);
  if (pinnedDelta !== 0) return pinnedDelta;
  return Date.parse(right.updatedAt) - Date.parse(left.updatedAt);
}

function buildConversationMetadata(
  current: Record<string, unknown> | null | undefined,
  messages: ChatMessage[]
): Record<string, unknown> {
  const next = { ...(current ?? {}) };
  if (!env.CONVERSATION_MEMORY_SUMMARY_ENABLED || messages.length < env.CONVERSATION_MEMORY_SUMMARY_AFTER_MESSAGES) {
    delete next.memorySummary;
    delete next.memorySummaryUpdatedAt;
    return next;
  }

  const summary = buildConversationMemorySummary(messages);
  if (!summary) {
    delete next.memorySummary;
    delete next.memorySummaryUpdatedAt;
    return next;
  }

  next.memorySummary = summary;
  next.memorySummaryUpdatedAt = new Date().toISOString();
  return next;
}

function buildConversationMemorySummary(messages: ChatMessage[]): string | undefined {
  const nonEmpty = messages.filter((message) => message.content.trim());
  const olderMessageCount = Math.max(0, nonEmpty.length - env.OPENAI_MAX_CONTEXT_MESSAGES);
  const olderMessages = nonEmpty.slice(0, olderMessageCount);
  if (olderMessages.length === 0) return undefined;

  const selected: string[] = [];
  let characters = 0;
  let tokens = 0;
  for (let index = olderMessages.length - 1; index >= 0; index -= 1) {
    const message = olderMessages[index];
    if (!message) continue;
    const line = formatMemoryLine(message);
    if (!line) continue;
    const lineTokens = estimateTextTokens(line);
    if (selected.length > 0 && characters + line.length > env.CONVERSATION_MEMORY_SUMMARY_MAX_CHARACTERS) break;
    if (selected.length > 0 && tokens + lineTokens > env.CONVERSATION_MEMORY_SUMMARY_MAX_TOKENS) break;
    selected.unshift(line);
    characters += line.length;
    tokens += lineTokens;
  }

  return selected.join("\n").trim() || undefined;
}

function formatMemoryLine(message: ChatMessage): string | undefined {
  const compacted = compactWhitespace(message.content);
  if (!compacted) return undefined;
  const limit = message.role === "assistant" ? 700 : 500;
  const label = message.role === "user" ? "User" : message.role === "assistant" ? "Assistant" : message.role;
  return `${label}: ${truncateText(compacted, limit)}`;
}

function compactWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function truncateText(value: string, maxCharacters: number): string {
  if (value.length <= maxCharacters) return value;
  return `${value.slice(0, Math.max(0, maxCharacters - 3)).trim()}...`;
}

function rowToChatMessage(message: { role: string; content: string; name: string | null }): ChatMessage {
  const role = isChatMessageRole(message.role) ? message.role : "assistant";
  return {
    role,
    content: message.content,
    ...(message.name ? { name: message.name } : {})
  };
}

function rowToMessageMetadata(message: { metadata?: Record<string, unknown> | null }): ConversationMessageMetadata | undefined {
  return sanitizeMessageMetadata(message.metadata);
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
  const userMetadata = sanitizeMessageMetadata(user.metadata);
  const assistantMetadata = sanitizeMessageMetadata(assistant.metadata);
  return [
    ...existingTurns,
    {
      userMessage: user.content,
      userAssets: userMetadata?.userAssets ?? [],
      assistantText: assistant.content,
      outputs: assistantMetadata?.outputs ?? (assistant.content ? [{ type: "text", text: assistant.content }] : []),
      ...(assistantMetadata?.provider ? { provider: assistantMetadata.provider } : {}),
      ...(assistantMetadata?.providerModel ? { providerModel: assistantMetadata.providerModel } : {}),
      ...(assistantMetadata?.responseId ? { responseId: assistantMetadata.responseId } : {}),
      ...(assistantMetadata?.styleTransferProvider ? { styleTransferProvider: assistantMetadata.styleTransferProvider } : {}),
      ...(assistantMetadata?.usage ? { usage: assistantMetadata.usage } : {}),
      ...(assistantMetadata?.backgroundJobId ? { backgroundJobId: assistantMetadata.backgroundJobId } : {})
    }
  ];
}

function isChatMessageRole(role: string): role is ChatMessage["role"] {
  return chatMessageSchema.shape.role.safeParse(role).success;
}

const contentBlocksSchema = z.array(contentBlockSchema);
const userAssetsSchema = z.array(conversationUserAssetSchema);
const usageSchema = z.object({
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  totalTokens: z.number().int().nonnegative().optional(),
  cachedInputTokens: z.number().int().nonnegative().optional(),
  reasoningTokens: z.number().int().nonnegative().optional(),
  estimatedCostUsd: z.number().nonnegative().optional()
});

function sanitizeMessageMetadata(metadata: unknown): ConversationMessageMetadata | undefined {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return undefined;
  const raw = metadata as Record<string, unknown>;
  const normalized: ConversationMessageMetadata = {};

  const outputs = contentBlocksSchema.safeParse(raw.outputs);
  if (outputs.success) normalized.outputs = outputs.data;

  const usage = usageSchema.safeParse(raw.usage);
  if (usage.success) normalized.usage = usage.data;

  const userAssets = userAssetsSchema.safeParse(raw.userAssets);
  if (userAssets.success) normalized.userAssets = userAssets.data;

  if (typeof raw.backgroundJobId === "string") {
    normalized.backgroundJobId = raw.backgroundJobId;
  }

  const provider = providerSchema.safeParse(raw.provider);
  if (provider.success) {
    normalized.provider = provider.data;
  }

  if (typeof raw.providerModel === "string" && raw.providerModel.trim()) {
    normalized.providerModel = raw.providerModel.trim();
  }

  if (typeof raw.responseId === "string" && raw.responseId.trim()) {
    normalized.responseId = raw.responseId.trim();
  }

  if (typeof raw.styleTransferProvider === "string" && raw.styleTransferProvider.trim()) {
    normalized.styleTransferProvider = raw.styleTransferProvider.trim();
  }

  return Object.keys(normalized).length > 0 ? normalized : undefined;
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
      ...(assistantMetadata?.provider ? { provider: assistantMetadata.provider } : {}),
      ...(assistantMetadata?.providerModel ? { providerModel: assistantMetadata.providerModel } : {}),
      ...(assistantMetadata?.responseId ? { responseId: assistantMetadata.responseId } : {}),
      ...(assistantMetadata?.styleTransferProvider ? { styleTransferProvider: assistantMetadata.styleTransferProvider } : {}),
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
