import { relations } from "drizzle-orm";
import { index, integer, jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";

export const conversations = pgTable("conversations", {
  id: text("id").primaryKey(),
  userId: text("user_id"),
  personaId: text("persona_id"),
  title: text("title"),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
}, (table) => ({
  userIdIdx: index("conversations_user_id_idx").on(table.userId),
  updatedAtIdx: index("conversations_updated_at_idx").on(table.updatedAt)
}));

export const messages = pgTable("messages", {
  id: text("id").primaryKey(),
  conversationId: text("conversation_id").notNull().references(() => conversations.id, { onDelete: "cascade" }),
  role: text("role").notNull(),
  content: text("content").notNull(),
  name: text("name"),
  sequence: integer("sequence").notNull(),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
}, (table) => ({
  conversationSequenceIdx: index("messages_conversation_sequence_idx").on(table.conversationId, table.sequence)
}));

export const uploads = pgTable("uploads", {
  id: text("id").primaryKey(),
  ownerId: text("owner_id").notNull(),
  kind: text("kind").notNull(),
  fileName: text("file_name").notNull(),
  mimeType: text("mime_type").notNull(),
  sizeBytes: integer("size_bytes").notNull(),
  localPath: text("local_path"),
  storageKey: text("storage_key"),
  publicUrl: text("public_url"),
  openaiFileId: text("openai_file_id"),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
}, (table) => ({
  ownerIdIdx: index("uploads_owner_id_idx").on(table.ownerId),
  expiresAtIdx: index("uploads_expires_at_idx").on(table.expiresAt)
}));

export const vectorStores = pgTable("vector_stores", {
  id: text("id").primaryKey(),
  ownerId: text("owner_id").notNull(),
  name: text("name"),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
}, (table) => ({
  ownerIdIdx: index("vector_stores_owner_id_idx").on(table.ownerId),
  expiresAtIdx: index("vector_stores_expires_at_idx").on(table.expiresAt)
}));

export const generatedAudio = pgTable("generated_audio", {
  token: text("token").primaryKey(),
  ownerId: text("owner_id"),
  conversationId: text("conversation_id").references(() => conversations.id, { onDelete: "set null" }),
  messageId: text("message_id").references(() => messages.id, { onDelete: "set null" }),
  fileName: text("file_name").notNull(),
  mimeType: text("mime_type").notNull(),
  localPath: text("local_path"),
  storageKey: text("storage_key"),
  publicUrl: text("public_url"),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
}, (table) => ({
  conversationIdIdx: index("generated_audio_conversation_id_idx").on(table.conversationId),
  expiresAtIdx: index("generated_audio_expires_at_idx").on(table.expiresAt)
}));

export const backgroundJobs = pgTable("background_jobs", {
  id: text("id").primaryKey(),
  kind: text("kind").notNull().default("chat"),
  status: text("status").notNull(),
  ownerId: text("owner_id"),
  conversationId: text("conversation_id").references(() => conversations.id, { onDelete: "set null" }),
  provider: text("provider"),
  providerResponseId: text("provider_response_id"),
  providerStatus: text("provider_status"),
  request: jsonb("request").$type<Record<string, unknown>>(),
  response: jsonb("response").$type<Record<string, unknown>>(),
  error: text("error"),
  failureReason: text("failure_reason"),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
}, (table) => ({
  ownerIdIdx: index("background_jobs_owner_id_idx").on(table.ownerId),
  statusIdx: index("background_jobs_status_idx").on(table.status),
  updatedAtIdx: index("background_jobs_updated_at_idx").on(table.updatedAt)
}));

export const conversationRelations = relations(conversations, ({ many }) => ({
  messages: many(messages)
}));

export const messageRelations = relations(messages, ({ one }) => ({
  conversation: one(conversations, {
    fields: [messages.conversationId],
    references: [conversations.id]
  })
}));
