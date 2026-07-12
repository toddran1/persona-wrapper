import type {
  ConversationDetail,
  ConversationSummary,
  DataImportResult,
  ForTheBaddiezArchive,
  PortableConversation,
  PortableConversationMessage
} from "@persona/shared";
import { forTheBaddiezArchiveSchema, portableConversationSchema } from "@persona/shared";
import { eq } from "drizzle-orm";
import { getDatabase } from "../db/client.js";
import { generatedAudio, generatedMedia, openAIArtifacts, uploads, users } from "../db/schema.js";
import { HttpError } from "../utils/httpError.js";
import { ConversationStore } from "./conversationStore.js";

const MAX_IMPORT_CONVERSATIONS = 100;

type ExternalParseResult = {
  source: DataImportResult["source"];
  conversations: PortableConversation[];
  skipped: number;
};

function stringValue(value: unknown, max = 200_000): string | undefined {
  return typeof value === "string" && value.trim() ? value.slice(0, max) : undefined;
}

function iso(value: unknown): string | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return new Date(value * 1000).toISOString();
  if (typeof value === "string" && !Number.isNaN(Date.parse(value))) return new Date(value).toISOString();
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
    const direct = stringValue(item.content ?? item.text);
    const contentParts = Array.isArray((item.content as Record<string, unknown> | undefined)?.parts)
      ? (item.content as { parts: unknown[] }).parts.map((part) => typeof part === "string" ? part : "").filter(Boolean).join("\n")
      : undefined;
    const content = direct ?? contentParts;
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

function parseChatGptExport(value: unknown): ExternalParseResult | undefined {
  if (!Array.isArray(value) || !value.some((item) => item && typeof item === "object" && "mapping" in item)) return undefined;
  const conversations: PortableConversation[] = [];
  let skipped = 0;
  for (const rawConversation of value.slice(0, MAX_IMPORT_CONVERSATIONS)) {
    const conversation = rawConversation as Record<string, unknown>;
    const mapping = conversation.mapping;
    if (!mapping || typeof mapping !== "object") { skipped += 1; continue; }
    const nodes = Object.values(mapping as Record<string, unknown>)
      .filter((node): node is Record<string, unknown> => Boolean(node && typeof node === "object"));
    const parsed = portableFromMessages(stringValue(conversation.title, 500) ?? "Imported ChatGPT conversation", nodes.map((node) => node.message), {
      createdAt: iso(conversation.create_time),
      updatedAt: iso(conversation.update_time)
    });
    if (parsed) conversations.push(parsed); else skipped += 1;
  }
  return { source: "chatgpt", conversations, skipped };
}

function parseClaudeExport(value: unknown): ExternalParseResult | undefined {
  const candidates = Array.isArray(value)
    ? value
    : value && typeof value === "object" && Array.isArray((value as Record<string, unknown>).conversations)
      ? (value as { conversations: unknown[] }).conversations
      : undefined;
  if (!candidates || !candidates.some((item) => item && typeof item === "object" && ("chat_messages" in item || "messages" in item))) return undefined;
  const conversations: PortableConversation[] = [];
  let skipped = 0;
  for (const rawConversation of candidates.slice(0, MAX_IMPORT_CONVERSATIONS)) {
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

export function parseImportArchive(value: unknown): ExternalParseResult {
  const own = forTheBaddiezArchiveSchema.safeParse(value);
  if (own.success) return { source: "for-the-baddiez", conversations: own.data.conversations, skipped: 0 };
  return parseChatGptExport(value) ?? parseClaudeExport(value) ?? (() => { throw new HttpError("Unsupported export file. Upload a For the Baddiez, ChatGPT, or Claude JSON export.", 400); })();
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

export class DataTransferService {
  constructor(private readonly conversationStore: ConversationStore) {}

  async exportConversations(userId: string, conversationIds?: string[]): Promise<ForTheBaddiezArchive> {
    const requestedIds = conversationIds?.length ? [...new Set(conversationIds)] : undefined;
    const details = requestedIds
      ? await Promise.all(requestedIds.map((id) => this.conversationStore.get(id, userId)))
      : await Promise.all((await this.conversationStore.list(userId, 10000)).map((summary) => this.conversationStore.get(summary.id, userId)));
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
    for (const conversation of parsed.conversations.slice(0, MAX_IMPORT_CONVERSATIONS)) {
      try { imported.push(await this.conversationStore.importPortable(conversation, userId)); }
      catch { skipped += 1; }
    }
    if (imported.length === 0) throw new HttpError("No supported conversation messages were found in this export.", 400);
    return { source: parsed.source, importedConversations: imported.length, skippedConversations: skipped, conversations: imported };
  }
}
