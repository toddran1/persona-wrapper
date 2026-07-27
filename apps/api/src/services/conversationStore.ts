import { randomUUID } from "node:crypto";
import {
  chatMessageSchema,
  contentBlockSchema,
  conversationMediaClarificationSchema,
  conversationUserAssetSchema,
  providerSchema,
  type ChatMessage,
  type ConversationDetail,
  type ConversationMediaClarification,
  type ConversationSummary,
  type ConversationTurn,
  type ConversationListPage,
  type ConversationTurnsPage,
  type PortableConversation
} from "@persona/shared";
import { z } from "zod";
import { and, asc, desc, eq, gte, ilike, inArray, isNull, lt, or, sql } from "drizzle-orm";
import { env } from "../config/env.js";
import { getDatabase } from "../db/client.js";
import { conversations, messages as dbMessages } from "../db/schema.js";
import { HttpError } from "../utils/httpError.js";
import { estimateChatMessageTokens, estimateTextTokens, trimTextToTokenBudget } from "../utils/tokenBudget.js";

type ConversationRecord = {
  id: string;
  userId?: string | null;
  personaId?: string | null;
  title?: string | null;
  pinned?: boolean;
  metadata?: Record<string, unknown> | null;
  createdAt?: Date;
  updatedAt?: Date;
  messages: ChatMessage[];
  turns?: ConversationTurn[];
};

type ConversationMessageMetadata = {
  personaId?: string;
  outputs?: ConversationTurn["outputs"];
  usage?: ConversationTurn["usage"];
  userAssets?: ConversationTurn["userAssets"];
  visualClarification?: ConversationMediaClarification;
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

type Database = NonNullable<ReturnType<typeof getDatabase>>;
type ConversationSummaryRow = Pick<
  typeof conversations.$inferSelect,
  "id" | "personaId" | "title" | "pinned" | "createdAt" | "updatedAt"
>;

const conversationCursorSchema = z.object({
  version: z.literal(1),
  pinned: z.boolean(),
  updatedAt: z.string().datetime(),
  id: z.string().min(1).max(256),
  query: z.string().max(120)
}).strict();

type ConversationCursor = z.infer<typeof conversationCursorSchema>;

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
        if (options.userId && !existing.userId) existing.userId = options.userId;
        if (options.personaId && options.personaId !== existing.personaId) {
          const legacyPersonaId = legacyTurnPersonaId(existing.metadata, existing.personaId);
          if (legacyPersonaId) {
            existing.metadata = {
              ...(existing.metadata ?? {}),
              legacyPersonaId
            };
            existing.turns = (existing.turns ?? buildConversationTurns(existing.messages))
              .map((turn) => turn.personaId ? turn : { ...turn, personaId: legacyPersonaId });
          }
          existing.personaId = options.personaId;
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
      pinned: false,
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
        turns: appendRenderedTurns(
          record.turns ?? buildConversationTurns(
            record.messages,
            [],
            legacyTurnPersonaId(record.metadata, record.personaId)
          ),
          messages
        )
      };
    }

    const nextMessages = messages.map(stripMessageMetadata);
    const updated: ConversationRecord = {
      ...record,
      title: record.title || titleFromMessages([...record.messages, ...nextMessages]) || "New conversation",
      metadata: buildConversationMetadata(record.metadata, [...record.messages, ...nextMessages]),
      updatedAt: new Date(),
      messages: [...record.messages, ...nextMessages],
      turns: appendRenderedTurns(
        record.turns ?? buildConversationTurns(
          record.messages,
          [],
          legacyTurnPersonaId(record.metadata, record.personaId)
        ),
        messages
      )
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

  async list(userId?: string, limit = 100, query?: string): Promise<ConversationSummary[]> {
    const boundedLimit = Math.max(1, Math.min(limit, 10000));
    const normalizedQuery = normalizeConversationQuery(query);
    const db = getDatabase();
    if (db) {
      const rows = await db.query.conversations.findMany({
        where: and(
          userId ? eq(conversations.userId, userId) : isNull(conversations.userId),
          normalizedQuery ? ilike(conversations.title, `%${escapeLikePattern(normalizedQuery)}%`) : undefined
        ),
        orderBy: [
          desc(conversations.pinned),
          desc(conversations.updatedAt),
          desc(conversations.id)
        ],
        limit: boundedLimit
      });
      return databaseConversationSummaries(db, rows);
    }

    return [...this.conversations.values()]
      .filter((conversation) => userId ? conversation.userId === userId : !conversation.userId)
      .filter((conversation) => !normalizedQuery || (conversation.title ?? titleFromMessages(conversation.messages) ?? "New conversation").toLocaleLowerCase().includes(normalizedQuery))
      .sort(compareConversationRecords)
      .slice(0, boundedLimit)
      .map(memoryConversationSummary);
  }

  async listPage(userId?: string, limit = 50, cursor?: string, query?: string): Promise<ConversationListPage> {
    const boundedLimit = Math.max(1, Math.min(limit, 100));
    const normalizedQuery = normalizeConversationQuery(query);
    const decodedCursor = decodeConversationCursor(cursor, normalizedQuery);
    const db = getDatabase();
    let rows: ConversationSummary[];

    if (db) {
      const cursorDate = decodedCursor ? new Date(decodedCursor.updatedAt) : undefined;
      const cursorWithinPinnedGroup = decodedCursor && cursorDate
        ? or(
            lt(conversations.updatedAt, cursorDate),
            and(
              eq(conversations.updatedAt, cursorDate),
              lt(conversations.id, decodedCursor.id)
            )
          )
        : undefined;
      const cursorCondition = decodedCursor && cursorWithinPinnedGroup
        ? decodedCursor.pinned
          ? or(
              and(eq(conversations.pinned, true), cursorWithinPinnedGroup),
              eq(conversations.pinned, false)
            )
          : and(eq(conversations.pinned, false), cursorWithinPinnedGroup)
        : undefined;
      const databaseRows = await db.query.conversations.findMany({
        where: and(
          userId ? eq(conversations.userId, userId) : isNull(conversations.userId),
          normalizedQuery ? ilike(conversations.title, `%${escapeLikePattern(normalizedQuery)}%`) : undefined,
          cursorCondition
        ),
        orderBy: [
          desc(conversations.pinned),
          desc(conversations.updatedAt),
          desc(conversations.id)
        ],
        limit: boundedLimit + 1
      });
      rows = await databaseConversationSummaries(db, databaseRows);
    } else {
      rows = [...this.conversations.values()]
        .filter((conversation) => userId ? conversation.userId === userId : !conversation.userId)
        .filter((conversation) => !normalizedQuery || (conversation.title ?? titleFromMessages(conversation.messages) ?? "New conversation").toLocaleLowerCase().includes(normalizedQuery))
        .sort(compareConversationRecords)
        .filter((conversation) => !decodedCursor || conversationFallsAfterCursor(conversation, decodedCursor))
        .slice(0, boundedLimit + 1)
        .map(memoryConversationSummary);
    }

    const hasMore = rows.length > boundedLimit;
    const selected = rows.slice(0, boundedLimit);
    return {
      conversations: selected,
      nextCursor: hasMore && selected.length > 0
        ? encodeConversationCursor(selected[selected.length - 1]!, normalizedQuery)
        : null
    };
  }

  async getTurnsPage(conversationId: string, userId?: string, limit = 40, cursor?: string): Promise<ConversationTurnsPage | undefined> {
    const boundedLimit = Math.max(1, Math.min(limit, 100));
    const beforeSequence = cursor === undefined ? undefined : parseSequenceCursor(cursor);
    const db = getDatabase();
    if (db) {
      const row = await db.query.conversations.findFirst({
        where: and(
          eq(conversations.id, conversationId),
          userId ? eq(conversations.userId, userId) : isNull(conversations.userId)
        )
      });
      if (!row) return undefined;
      const userRows = await db
        .select({ sequence: dbMessages.sequence })
        .from(dbMessages)
        .where(and(
          eq(dbMessages.conversationId, conversationId),
          eq(dbMessages.role, "user"),
          ...(beforeSequence === undefined ? [] : [lt(dbMessages.sequence, beforeSequence)])
        ))
        .orderBy(desc(dbMessages.sequence))
        .limit(boundedLimit + 1);
      const selected = userRows.slice(0, boundedLimit);
      const lowerSequence = selected.at(-1)?.sequence;
      const messageCountRows = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(dbMessages)
        .where(eq(dbMessages.conversationId, conversationId));
      const summary: ConversationSummary = {
        id: row.id,
        ...(row.personaId ? { personaId: row.personaId } : {}),
        title: row.title || "New conversation",
        pinned: row.pinned,
        messageCount: Number(messageCountRows[0]?.count ?? 0),
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString()
      };
      if (lowerSequence === undefined) {
        return { conversation: summary, turns: [], nextCursor: null };
      }
      const pageRows = await db.query.messages.findMany({
        where: and(
          eq(dbMessages.conversationId, conversationId),
          gte(dbMessages.sequence, lowerSequence),
          ...(beforeSequence === undefined ? [] : [lt(dbMessages.sequence, beforeSequence)])
        ),
        orderBy: asc(dbMessages.sequence)
      });
      const history = pageRows.map(rowToChatMessage);
      return {
        conversation: summary,
        turns: buildConversationTurns(
          history,
          pageRows.map(rowToMessageMetadata),
          legacyTurnPersonaId(row.metadata, row.personaId)
        ),
        nextCursor: userRows.length > boundedLimit ? String(lowerSequence) : null
      };
    }

    const record = this.conversations.get(conversationId);
    if (!record || (userId && record.userId && record.userId !== userId)) return undefined;
    const allTurns = record.turns ?? buildConversationTurns(
      record.messages,
      [],
      legacyTurnPersonaId(record.metadata, record.personaId)
    );
    const end = beforeSequence ?? allTurns.length;
    const start = Math.max(0, end - boundedLimit);
    return {
      conversation: {
        id: record.id,
        ...(record.personaId ? { personaId: record.personaId } : {}),
        title: record.title || "New conversation",
        pinned: record.pinned ?? false,
        messageCount: record.messages.length,
        createdAt: (record.createdAt ?? new Date()).toISOString(),
        updatedAt: (record.updatedAt ?? new Date()).toISOString()
      },
      turns: allTurns.slice(start, end),
      nextCursor: start > 0 ? String(start) : null
    };
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
        pinned: row.pinned,
        messageCount: history.length,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
        history,
        turns: buildConversationTurns(
          history,
          row.messages.map(rowToMessageMetadata),
          legacyTurnPersonaId(row.metadata, row.personaId)
        )
      };
    }

    const conversation = this.conversations.get(conversationId);
    if (!conversation) return undefined;
    if (userId && conversation.userId && conversation.userId !== userId) return undefined;
    return {
      id: conversation.id,
      ...(conversation.personaId ? { personaId: conversation.personaId } : {}),
      title: conversation.title || titleFromMessages(conversation.messages) || "New conversation",
      pinned: conversation.pinned ?? false,
      messageCount: conversation.messages.length,
      createdAt: (conversation.createdAt ?? new Date()).toISOString(),
      updatedAt: (conversation.updatedAt ?? new Date()).toISOString(),
      history: conversation.messages,
      turns: conversation.turns ?? buildConversationTurns(
        conversation.messages,
        [],
        legacyTurnPersonaId(conversation.metadata, conversation.personaId)
      )
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
          pinned: conversations.pinned,
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
        pinned: row.pinned,
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
      pinned: updated.pinned ?? false,
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
      const updated = await db.update(conversations)
        .set({ pinned })
        .where(and(
          eq(conversations.id, conversationId),
          userId ? eq(conversations.userId, userId) : isNull(conversations.userId)
        ))
        .returning({
          id: conversations.id,
          personaId: conversations.personaId,
          title: conversations.title,
          pinned: conversations.pinned,
          createdAt: conversations.createdAt,
          updatedAt: conversations.updatedAt
        });
      const updatedRow = updated[0];
      if (!updatedRow) return undefined;
      return {
        id: updatedRow.id,
        ...(updatedRow.personaId ? { personaId: updatedRow.personaId } : {}),
        title: updatedRow.title || "New conversation",
        pinned: updatedRow.pinned,
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
      pinned
    };
    this.conversations.set(conversationId, updated);
    return {
      id: updated.id,
      ...(updated.personaId ? { personaId: updated.personaId } : {}),
      title: updated.title || titleFromMessages(updated.messages) || "New conversation",
      pinned: updated.pinned ?? false,
      messageCount: updated.messages.length,
      createdAt: (updated.createdAt ?? new Date()).toISOString(),
      updatedAt: (updated.updatedAt ?? new Date()).toISOString()
    };
  }

  async importPortable(conversation: PortableConversation, userId: string): Promise<ConversationSummary> {
    const id = `conv_${randomUUID()}`;
    const createdAt = parseImportedDate(conversation.createdAt);
    const updatedAt = parseImportedDate(conversation.updatedAt) ?? createdAt;
    const title = normalizeTitle(conversation.title);
    const importedMessages: ConversationAppendMessage[] = conversation.messages.map((message) => ({
      role: message.role,
      content: message.content,
      ...(message.name ? { name: message.name } : {}),
      ...(message.personaId || message.outputs?.length ? {
        metadata: {
          ...(message.personaId ? { personaId: message.personaId } : {}),
          ...(message.outputs?.length ? { outputs: message.outputs } : {})
        }
      } : {})
    }));
    const metadata = {
      imported: true,
      importedAt: new Date().toISOString()
    };
    const db = getDatabase();
    if (db) {
      await db.transaction(async (tx) => {
        await tx.insert(conversations).values({
          id,
          userId,
          ...(conversation.personaId ? { personaId: conversation.personaId } : {}),
          title,
          pinned: conversation.pinned,
          metadata,
          ...(createdAt ? { createdAt } : {}),
          ...(updatedAt ? { updatedAt } : {})
        });
        await tx.insert(dbMessages).values(importedMessages.map((message, index) => ({
          id: `msg_${randomUUID()}`,
          conversationId: id,
          role: message.role,
          content: message.content,
          name: message.name,
          sequence: index,
          metadata: sanitizeMessageMetadata(message.metadata) ?? {}
        })));
      });
    } else {
      this.conversations.set(id, {
        id,
        userId,
        ...(conversation.personaId ? { personaId: conversation.personaId } : {}),
        title,
        pinned: conversation.pinned,
        metadata,
        createdAt: createdAt ?? new Date(),
        updatedAt: updatedAt ?? new Date(),
        messages: importedMessages.map(stripMessageMetadata),
        turns: buildConversationTurns(importedMessages.map(stripMessageMetadata), importedMessages.map((message) => message.metadata))
      });
    }
    return {
      id,
      ...(conversation.personaId ? { personaId: conversation.personaId } : {}),
      title,
      pinned: conversation.pinned,
      messageCount: conversation.messages.length,
      createdAt: (createdAt ?? new Date()).toISOString(),
      updatedAt: (updatedAt ?? new Date()).toISOString()
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
        const nextUserId = existing.userId ?? options.userId ?? null;
        const nextPersonaId = options.personaId ?? existing.personaId ?? null;
        const existingMetadata = metadataRecord(existing.metadata) ?? {};
        const shouldPreserveLegacyPersona = Boolean(
          existing.personaId &&
          nextPersonaId &&
          nextPersonaId !== existing.personaId &&
          typeof existingMetadata.legacyPersonaId !== "string"
        );
        const nextMetadata = shouldPreserveLegacyPersona
          ? { ...existingMetadata, legacyPersonaId: existing.personaId }
          : existingMetadata;
        if (
          nextUserId !== existing.userId ||
          nextPersonaId !== existing.personaId ||
          shouldPreserveLegacyPersona
        ) {
          await db.update(conversations)
            .set({ userId: nextUserId, personaId: nextPersonaId, metadata: nextMetadata })
            .where(eq(conversations.id, existing.id));
        }
        return {
          id: existing.id,
          userId: nextUserId,
          personaId: nextPersonaId,
          title: existing.title,
          pinned: existing.pinned,
          metadata: nextMetadata,
          createdAt: existing.createdAt,
          updatedAt: existing.updatedAt,
          messages: existing.messages.map(rowToChatMessage),
          turns: buildConversationTurns(
            existing.messages.map(rowToChatMessage),
            existing.messages.map(rowToMessageMetadata),
            legacyTurnPersonaId(nextMetadata, existing.personaId)
          )
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
      pinned: false,
      metadata: {},
      messages: [...seedHistory],
      turns: buildConversationTurns(seedHistory)
    };
  }
}

function parseImportedDate(value: string | undefined): Date | undefined {
  if (!value) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function getMemorySummary(metadata: Record<string, unknown> | null | undefined): string | undefined {
  const value = metadata?.memorySummary;
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function metadataRecord(metadata: unknown): Record<string, unknown> | null {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return null;
  return metadata as Record<string, unknown>;
}

async function databaseConversationSummaries(
  db: Database,
  rows: ConversationSummaryRow[]
): Promise<ConversationSummary[]> {
  const counts = rows.length === 0 ? [] : await db
    .select({ conversationId: dbMessages.conversationId, count: sql<number>`count(*)::int` })
    .from(dbMessages)
    .where(inArray(dbMessages.conversationId, rows.map((row) => row.id)))
    .groupBy(dbMessages.conversationId);
  const countsByConversation = new Map(counts.map((row) => [row.conversationId, Number(row.count)]));

  return rows.map((row) => ({
    id: row.id,
    ...(row.personaId ? { personaId: row.personaId } : {}),
    title: row.title || "New conversation",
    pinned: row.pinned,
    messageCount: countsByConversation.get(row.id) ?? 0,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString()
  }));
}

function memoryConversationSummary(conversation: ConversationRecord): ConversationSummary {
  return {
    id: conversation.id,
    ...(conversation.personaId ? { personaId: conversation.personaId } : {}),
    title: conversation.title || titleFromMessages(conversation.messages) || "New conversation",
    pinned: conversation.pinned ?? false,
    messageCount: conversation.messages.length,
    createdAt: (conversation.createdAt ?? new Date(0)).toISOString(),
    updatedAt: (conversation.updatedAt ?? new Date(0)).toISOString()
  };
}

function compareConversationRecords(left: ConversationRecord, right: ConversationRecord): number {
  const pinnedDelta = Number(right.pinned ?? false) - Number(left.pinned ?? false);
  if (pinnedDelta !== 0) return pinnedDelta;
  const updatedAtDelta = (right.updatedAt?.getTime() ?? 0) - (left.updatedAt?.getTime() ?? 0);
  if (updatedAtDelta !== 0) return updatedAtDelta;
  return compareDescendingText(left.id, right.id);
}

function compareDescendingText(left: string, right: string): number {
  if (left === right) return 0;
  return left < right ? 1 : -1;
}

function normalizeConversationQuery(query: string | undefined): string {
  return query?.trim().toLocaleLowerCase() ?? "";
}

function encodeConversationCursor(summary: ConversationSummary, query: string): string {
  const cursor: ConversationCursor = {
    version: 1,
    pinned: summary.pinned,
    updatedAt: summary.updatedAt,
    id: summary.id,
    query
  };
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

function decodeConversationCursor(cursor: string | undefined, query: string): ConversationCursor | undefined {
  if (!cursor) return undefined;
  if (cursor.length > 1024) throw new HttpError("Invalid conversation cursor.", 400);
  try {
    const decoded = conversationCursorSchema.parse(
      JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"))
    );
    if (decoded.query !== query || Number.isNaN(Date.parse(decoded.updatedAt))) {
      throw new Error("Cursor does not match the current query.");
    }
    return decoded;
  } catch {
    throw new HttpError("Invalid conversation cursor.", 400);
  }
}

function conversationFallsAfterCursor(record: ConversationRecord, cursor: ConversationCursor): boolean {
  const pinned = record.pinned ?? false;
  if (pinned !== cursor.pinned) {
    return cursor.pinned && !pinned;
  }
  const updatedAt = record.updatedAt?.getTime() ?? 0;
  const cursorUpdatedAt = Date.parse(cursor.updatedAt);
  if (updatedAt !== cursorUpdatedAt) return updatedAt < cursorUpdatedAt;
  return record.id < cursor.id;
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
      ...(assistantMetadata?.personaId ? { personaId: assistantMetadata.personaId } : {}),
      userMessage: user.content,
      userAssets: userMetadata?.userAssets ?? [],
      assistantText: assistant.content,
      outputs: assistantMetadata?.outputs ?? (assistant.content ? [{ type: "text", text: assistant.content }] : []),
      ...(assistantMetadata?.visualClarification ? { visualClarification: assistantMetadata.visualClarification } : {}),
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

  const visualClarification = conversationMediaClarificationSchema.safeParse(raw.visualClarification);
  if (visualClarification.success) normalized.visualClarification = visualClarification.data;

  if (typeof raw.backgroundJobId === "string") {
    normalized.backgroundJobId = raw.backgroundJobId;
  }

  if (typeof raw.personaId === "string" && raw.personaId.trim()) {
    normalized.personaId = raw.personaId.trim();
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

function buildConversationTurns(
  history: ChatMessage[],
  metadata: Array<ConversationMessageMetadata | undefined> = [],
  fallbackPersonaId?: string
): ConversationTurn[] {
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
      ...(assistantMetadata?.personaId || fallbackPersonaId
        ? { personaId: assistantMetadata?.personaId ?? fallbackPersonaId }
        : {}),
      userMessage: message.content,
      userAssets: userMetadata?.userAssets ?? [],
      assistantText: assistant?.content ?? "",
      outputs: assistantMetadata?.outputs ?? (assistant?.content ? [{ type: "text", text: assistant.content }] : []),
      ...(assistantMetadata?.visualClarification ? { visualClarification: assistantMetadata.visualClarification } : {}),
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

function legacyTurnPersonaId(
  metadata: Record<string, unknown> | null | undefined,
  conversationPersonaId: string | null | undefined
): string | undefined {
  const saved = metadata?.legacyPersonaId;
  if (typeof saved === "string" && saved.trim()) return saved.trim();
  return conversationPersonaId?.trim() || undefined;
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

function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, "\\$&");
}

function parseSequenceCursor(cursor: string): number {
  const value = Number(cursor);
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new HttpError("Invalid conversation turn cursor.", 400);
  }
  return value;
}
