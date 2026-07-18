import type {
  ConversationDetail,
  ConversationSummary,
  DataImportResult,
  ForTheBaddiezArchive,
  PortableConversation,
  PortableConversationMessage
} from "@persona/shared";
import { forTheBaddiezArchiveSchema, portableConversationSchema } from "@persona/shared";
import { createHash, randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { getDatabase } from "../db/client.js";
import { conversations as dbConversations, messages as dbMessages, generatedAudio, generatedMedia, openAIArtifacts, uploads, users } from "../db/schema.js";
import { HttpError } from "../utils/httpError.js";
import { logger } from "../utils/logger.js";
import type { ConversationStore } from "./conversationStore.js";

const MAX_IMPORT_CONVERSATIONS = 100;
const EXPORT_READ_CONCURRENCY = 10;
const IMPORT_MESSAGE_BATCH_SIZE = 500;

type ExternalParseResult = {
  source: DataImportResult["source"];
  conversations: PortableConversation[];
  skipped: number;
};

function stringValue(value: unknown, max = 200_000): string | undefined {
  return typeof value === "string" && value.trim() ? value.slice(0, max) : undefined;
}

function contentText(value: unknown, depth = 0): string | undefined {
  if (depth > 5) return undefined;
  const direct = stringValue(value);
  if (direct) return direct;
  if (Array.isArray(value)) {
    const joined = value.map((item) => contentText(item, depth + 1)).filter((item): item is string => Boolean(item)).join("\n");
    return stringValue(joined);
  }
  if (!value || typeof value !== "object") return undefined;
  const item = value as Record<string, unknown>;
  for (const candidate of [item.text, item.value, item.parts, item.content]) {
    const extracted = contentText(candidate, depth + 1);
    if (extracted) return extracted;
  }
  return undefined;
}

function iso(value: unknown): string | undefined {
  const date = typeof value === "number" && Number.isFinite(value)
    ? new Date(value * 1000)
    : typeof value === "string"
      ? new Date(value)
      : undefined;
  if (date && !Number.isNaN(date.getTime())) {
    try { return date.toISOString(); } catch { return undefined; }
  }
  return undefined;
}

function portableFromMessages(title: string, rawMessages: unknown[], options: Partial<PortableConversation> = {}): PortableConversation | undefined {
  const messages: PortableConversationMessage[] = [];
  for (const raw of rawMessages) {
    if (!raw || typeof raw !== "object") continue;
    const item = raw as Record<string, unknown>;
    const rawRole = stringValue(item.role ?? item.sender ?? (item.author as Record<string, unknown> | undefined)?.role)?.toLowerCase();
    const role = rawRole === "human" ? "user" : rawRole === "ai" ? "assistant" : rawRole;
    if (role !== "user" && role !== "assistant" && role !== "system") continue;
    const content = contentText(item.content ?? item.text);
    if (!content) continue;
    messages.push({ role, content, ...(iso(item.create_time ?? item.created_at ?? item.createdAt) ? { createdAt: iso(item.create_time ?? item.created_at ?? item.createdAt) } : {}) });
  }
  if (messages.length === 0) return undefined;
  messages.sort((left, right) => {
    if (!left.createdAt || !right.createdAt) return 0;
    return Date.parse(left.createdAt) - Date.parse(right.createdAt);
  });
  return portableConversationSchema.parse({ title: title.slice(0, 500) || "Imported conversation", messages, ...options });
}

function chatGptBranchMessages(conversation: Record<string, unknown>, mapping: Record<string, unknown>): unknown[] {
  const currentNode = stringValue(conversation.current_node, 200);
  if (!currentNode) {
    return Object.values(mapping)
      .filter((node): node is Record<string, unknown> => Boolean(node && typeof node === "object"))
      .map((node) => node.message);
  }

  const branch: unknown[] = [];
  const visited = new Set<string>();
  let nodeId: string | undefined = currentNode;
  while (nodeId && !visited.has(nodeId)) {
    visited.add(nodeId);
    const rawNode = mapping[nodeId];
    if (!rawNode || typeof rawNode !== "object") break;
    const node = rawNode as Record<string, unknown>;
    if (node.message) branch.unshift(node.message);
    nodeId = stringValue(node.parent, 200);
  }
  return branch.length > 0 ? branch : Object.values(mapping)
    .filter((node): node is Record<string, unknown> => Boolean(node && typeof node === "object"))
    .map((node) => node.message);
}

function parseChatGptExport(value: unknown, limit: number): ExternalParseResult | undefined {
  if (!Array.isArray(value) || !value.some((item) => item && typeof item === "object" && "mapping" in item)) return undefined;
  const conversations: PortableConversation[] = [];
  let skipped = Math.max(0, value.length - limit);
  for (const rawConversation of value.slice(0, limit)) {
    const conversation = rawConversation as Record<string, unknown>;
    const mapping = conversation.mapping;
    if (!mapping || typeof mapping !== "object") { skipped += 1; continue; }
    const parsed = portableFromMessages(stringValue(conversation.title, 500) ?? "Imported ChatGPT conversation", chatGptBranchMessages(conversation, mapping as Record<string, unknown>), {
      createdAt: iso(conversation.create_time),
      updatedAt: iso(conversation.update_time)
    });
    if (parsed) conversations.push(parsed); else skipped += 1;
  }
  return { source: "chatgpt", conversations, skipped };
}

function parseClaudeExport(value: unknown, limit: number): ExternalParseResult | undefined {
  const candidates = Array.isArray(value)
    ? value
    : value && typeof value === "object" && Array.isArray((value as Record<string, unknown>).conversations)
      ? (value as { conversations: unknown[] }).conversations
      : undefined;
  if (!candidates || !candidates.some((item) => item && typeof item === "object" && ("chat_messages" in item || "messages" in item))) return undefined;
  const conversations: PortableConversation[] = [];
  let skipped = Math.max(0, candidates.length - limit);
  for (const rawConversation of candidates.slice(0, limit)) {
    const conversation = rawConversation as Record<string, unknown>;
    const messages = Array.isArray(conversation.chat_messages) ? conversation.chat_messages : Array.isArray(conversation.messages) ? conversation.messages : [];
    const parsed = portableFromMessages(stringValue(conversation.name ?? conversation.title, 500) ?? "Imported Claude conversation", messages, {
      createdAt: iso(conversation.created_at ?? conversation.createdAt),
      updatedAt: iso(conversation.updated_at ?? conversation.updatedAt)
    });
    if (parsed) conversations.push(parsed); else skipped += 1;
  }
  return { source: "claude", conversations, skipped };
}

export function parseImportArchive(value: unknown, limit = MAX_IMPORT_CONVERSATIONS): ExternalParseResult {
  const own = forTheBaddiezArchiveSchema.safeParse(value);
  if (own.success) return { source: "for-the-baddiez", conversations: own.data.conversations, skipped: 0 };
  return parseChatGptExport(value, limit) ?? parseClaudeExport(value, limit) ?? (() => { throw new HttpError("Unsupported export file. Upload a For the Baddiez, ChatGPT, or Claude JSON export.", 400); })();
}

function importFingerprint(conversation: PortableConversation): string {
  return createHash("sha256").update(JSON.stringify({
    title: conversation.title.trim(),
    createdAt: conversation.createdAt ?? null,
    messages: conversation.messages.map((message) => ({ role: message.role, content: message.content, name: message.name ?? null, outputs: message.outputs ?? null }))
  })).digest("hex");
}

function rewriteMediaReferences(value: unknown, mediaIds: Map<string, string>): unknown {
  if (mediaIds.size === 0) return value;
  if (typeof value === "string") {
    return value.replace(/\/api\/(?:uploads|generated-media|generated-audio|openai-artifacts)\/([^?#/\s"']+)/g, (match, encodedKey: string) => {
      let key = encodedKey;
      try { key = decodeURIComponent(encodedKey); } catch { /* Keep the encoded value when malformed. */ }
      const id = mediaIds.get(key);
      return id ? `/api/uploads/${id}` : match;
    });
  }
  if (Array.isArray(value)) return value.map((item) => rewriteMediaReferences(item, mediaIds));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, rewriteMediaReferences(item, mediaIds)]));
  }
  return value;
}

function portableFromDetail(detail: ConversationDetail): PortableConversation {
  let assistantTurnIndex = 0;
  return portableConversationSchema.parse({
    id: detail.id,
    title: detail.title,
    ...(detail.personaId ? { personaId: detail.personaId } : {}),
    pinned: detail.pinned,
    createdAt: detail.createdAt,
    updatedAt: detail.updatedAt,
    messages: detail.history.map((message) => {
      if (message.role !== "assistant") return message;
      const outputs = detail.turns[assistantTurnIndex]?.outputs;
      assistantTurnIndex += 1;
      return { ...message, ...(outputs?.length ? { outputs } : {}) };
    })
  });
}

async function mapWithConcurrency<T, R>(items: T[], concurrency: number, mapper: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await mapper(items[index]!);
    }
  });
  await Promise.all(workers);
  return results;
}

export class DataTransferService {
  constructor(private readonly conversationStore: ConversationStore) {}

  async exportConversations(userId: string, conversationIds?: string[]): Promise<ForTheBaddiezArchive> {
    const requestedIds = conversationIds?.length ? [...new Set(conversationIds)] : undefined;
    const ids = requestedIds ?? (await this.conversationStore.list(userId, 10000)).map((summary) => summary.id);
    const details = await mapWithConcurrency(ids, EXPORT_READ_CONCURRENCY, (id) => this.conversationStore.get(id, userId));
    if (requestedIds && details.some((detail) => !detail)) throw new HttpError("One or more selected conversations were not found.", 404);
    return {
      format: "for-the-baddiez-export",
      version: 1,
      exportedAt: new Date().toISOString(),
      scope: requestedIds?.length ? "conversations" : "account",
      conversations: details.filter((detail): detail is ConversationDetail => Boolean(detail)).map(portableFromDetail)
    };
  }

  async exportAccount(userId: string): Promise<ForTheBaddiezArchive> {
    const archive = await this.exportConversations(userId);
    const db = getDatabase();
    if (!db) return archive;
    const [user, ownedUploads, media, audio, artifacts] = await Promise.all([
      db.query.users.findFirst({ where: eq(users.id, userId) }),
      db.select().from(uploads).where(eq(uploads.ownerId, userId)),
      db.select().from(generatedMedia).where(eq(generatedMedia.ownerId, userId)),
      db.select().from(generatedAudio).where(eq(generatedAudio.ownerId, userId)),
      db.select().from(openAIArtifacts).where(eq(openAIArtifacts.ownerId, userId))
    ]);
    return forTheBaddiezArchiveSchema.parse({
      ...archive,
      scope: "account",
      ...(user ? { account: { email: user.email, username: user.username, displayName: user.displayName, avatarUrl: user.avatarUrl, createdAt: user.createdAt.toISOString() } } : {}),
      media: [
        ...ownedUploads.map((item) => ({ kind: "upload" as const, fileName: item.fileName, mimeType: item.mimeType, createdAt: item.createdAt.toISOString() })),
        ...media.map((item) => ({ kind: "generated_media" as const, fileName: item.fileName, mimeType: item.mimeType, createdAt: item.createdAt.toISOString() })),
        ...audio.map((item) => ({ kind: "generated_audio" as const, fileName: item.fileName, mimeType: item.mimeType, createdAt: item.createdAt.toISOString() })),
        ...artifacts.map((item) => ({ kind: "openai_artifact" as const, fileName: item.fileName, mimeType: item.mimeType, createdAt: item.createdAt.toISOString() }))
      ]
    });
  }

  async importArchive(userId: string, value: unknown): Promise<DataImportResult> {
    const parsed = parseImportArchive(value);
    const imported: ConversationSummary[] = [];
    let skipped = parsed.skipped + Math.max(0, parsed.conversations.length - MAX_IMPORT_CONVERSATIONS);
    let firstImportError: unknown;
    for (const conversation of parsed.conversations.slice(0, MAX_IMPORT_CONVERSATIONS)) {
      try { imported.push(await this.conversationStore.importPortable(conversation, userId)); }
      catch (error) {
        firstImportError ??= error;
        skipped += 1;
        logger.warn("Conversation import failed", {
          userId,
          title: conversation.title,
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }
    if (imported.length === 0 && firstImportError) {
      throw new HttpError("The export was valid, but its conversations could not be saved. Please try again.", 500);
    }
    if (imported.length === 0) throw new HttpError("No supported conversation messages were found in this export.", 400);
    return { source: parsed.source, importedConversations: imported.length, skippedConversations: skipped, conversations: imported };
  }

  async importArchiveAtomically(
    userId: string,
    value: unknown,
    options: {
      signal?: AbortSignal;
      onProgress?: (processed: number, total: number) => Promise<void> | void;
      media?: Array<{ id: string; sourceKeys: string[]; fileName: string; mimeType: string; sizeBytes: number; storageKey: string; sha256: string }>;
      onMediaCommitted?: (ids: string[]) => void;
    } = {}
  ): Promise<DataImportResult> {
    const parsed = parseImportArchive(value, 10_000);
    if (parsed.conversations.length === 0) throw new HttpError("No supported conversation messages were found in this export.", 400);
    const db = getDatabase();
    if (!db) throw new HttpError("Atomic imports require database-backed storage.", 409);

    const summaries: ConversationSummary[] = [];
    const committedMediaIds: string[] = [];
    let duplicates = parsed.skipped;
    await db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`data-import:${userId}`}, 0))`);
      const mediaIds = new Map<string, string>();
      if (options.media?.length) {
        const existingMedia = await tx.select({ id: uploads.id, metadata: uploads.metadata }).from(uploads).where(eq(uploads.ownerId, userId));
        const existingByHash = new Map(existingMedia.flatMap((row) => typeof row.metadata.sha256 === "string" ? [[row.metadata.sha256, row.id] as const] : []));
        const newMedia = options.media.filter((media) => {
          const existingId = existingByHash.get(media.sha256);
          const resolvedId = existingId ?? media.id;
          media.sourceKeys.forEach((key) => mediaIds.set(key, resolvedId));
          if (existingId) return false;
          existingByHash.set(media.sha256, media.id);
          return true;
        });
        committedMediaIds.push(...newMedia.map((media) => media.id));
        if (newMedia.length) await tx.insert(uploads).values(newMedia.map((media) => ({
          id: media.id,
          ownerId: userId,
          kind: "imported_media",
          fileName: media.fileName,
          mimeType: media.mimeType,
          sizeBytes: media.sizeBytes,
          storageKey: media.storageKey,
          publicUrl: `/api/uploads/${media.id}`,
          metadata: { imported: true, importSource: parsed.source, sha256: media.sha256, uploadStatus: "ready" }
        })));
      }
      const existing = await tx.select({ metadata: dbConversations.metadata }).from(dbConversations).where(eq(dbConversations.userId, userId));
      const fingerprints = new Set(existing.flatMap((row) => typeof row.metadata.importFingerprint === "string" ? [row.metadata.importFingerprint] : []));

      for (let index = 0; index < parsed.conversations.length; index += 1) {
        if (options.signal?.aborted) throw new HttpError("Import cancelled.", 409);
        const conversation = rewriteMediaReferences(parsed.conversations[index]!, mediaIds) as PortableConversation;
        const fingerprint = importFingerprint(conversation);
        if (fingerprints.has(fingerprint)) {
          duplicates += 1;
          await options.onProgress?.(index + 1, parsed.conversations.length);
          continue;
        }
        fingerprints.add(fingerprint);
        const id = `conv_${randomUUID()}`;
        const createdAt = conversation.createdAt ? new Date(conversation.createdAt) : new Date();
        const updatedAt = conversation.updatedAt ? new Date(conversation.updatedAt) : createdAt;
        const title = conversation.title.trim().slice(0, 500) || "Imported conversation";
        await tx.insert(dbConversations).values({
          id,
          userId,
          personaId: conversation.personaId,
          title,
          metadata: { imported: true, importedAt: new Date().toISOString(), importSource: parsed.source, importFingerprint: fingerprint, ...(conversation.pinned ? { pinned: true } : {}) },
          createdAt,
          updatedAt
        });
        for (let offset = 0; offset < conversation.messages.length; offset += IMPORT_MESSAGE_BATCH_SIZE) {
          if (options.signal?.aborted) throw new HttpError("Import cancelled.", 409);
          await tx.insert(dbMessages).values(conversation.messages.slice(offset, offset + IMPORT_MESSAGE_BATCH_SIZE).map((message, batchIndex) => ({
            id: `msg_${randomUUID()}`,
            conversationId: id,
            role: message.role,
            content: message.content,
            name: message.name,
            sequence: offset + batchIndex,
            metadata: message.outputs?.length ? { outputs: message.outputs } : {},
            ...(message.createdAt ? { createdAt: new Date(message.createdAt) } : {})
          })));
        }
        summaries.push({ id, ...(conversation.personaId ? { personaId: conversation.personaId } : {}), title, pinned: conversation.pinned, messageCount: conversation.messages.length, createdAt: createdAt.toISOString(), updatedAt: updatedAt.toISOString() });
        await options.onProgress?.(index + 1, parsed.conversations.length);
      }
      if (options.signal?.aborted) throw new HttpError("Import cancelled.", 409);
    });
    options.onMediaCommitted?.(committedMediaIds);
    return { source: parsed.source, importedConversations: summaries.length, skippedConversations: duplicates, conversations: summaries };
  }
}
