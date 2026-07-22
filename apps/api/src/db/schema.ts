import { relations } from "drizzle-orm";
import { boolean, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

export const users = pgTable("users", {
  id: text("id").primaryKey(),
  email: text("email").notNull(),
  username: text("username"),
  displayUsername: text("display_username"),
  displayName: text("display_name").notNull(),
  avatarUrl: text("avatar_url"),
  emailVerified: boolean("email_verified").notNull().default(false),
  status: text("status").notNull().default("active"),
  deletionRequestedAt: timestamp("deletion_requested_at", { withTimezone: true }),
  deletionScheduledFor: timestamp("deletion_scheduled_for", { withTimezone: true }),
  emailVerifiedAt: timestamp("email_verified_at", { withTimezone: true }),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
}, (table) => ({
  emailUnique: uniqueIndex("users_email_unique").on(table.email),
  usernameUnique: uniqueIndex("users_username_unique").on(table.username),
  statusIdx: index("users_status_idx").on(table.status),
  deletionScheduledForIdx: index("users_deletion_scheduled_for_idx").on(table.deletionScheduledFor)
}));

export const betterAuthAccounts = pgTable("better_auth_accounts", {
  id: text("id").primaryKey(),
  accountId: text("account_id").notNull(),
  providerId: text("provider_id").notNull(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  idToken: text("id_token"),
  accessTokenExpiresAt: timestamp("access_token_expires_at", { withTimezone: true }),
  refreshTokenExpiresAt: timestamp("refresh_token_expires_at", { withTimezone: true }),
  scope: text("scope"),
  password: text("password"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
}, (table) => ({
  userIdIdx: index("better_auth_accounts_user_id_idx").on(table.userId),
  providerAccountUnique: uniqueIndex("better_auth_accounts_provider_account_unique").on(table.providerId, table.accountId)
}));

export const betterAuthSessions = pgTable("better_auth_sessions", {
  id: text("id").primaryKey(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  token: text("token").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  clientType: text("client_type").notNull().default("unknown")
}, (table) => ({
  tokenUnique: uniqueIndex("better_auth_sessions_token_unique").on(table.token),
  userIdIdx: index("better_auth_sessions_user_id_idx").on(table.userId),
  expiresAtIdx: index("better_auth_sessions_expires_at_idx").on(table.expiresAt)
}));

export const betterAuthVerifications = pgTable("better_auth_verifications", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
}, (table) => ({
  identifierIdx: index("better_auth_verifications_identifier_idx").on(table.identifier),
  expiresAtIdx: index("better_auth_verifications_expires_at_idx").on(table.expiresAt)
}));

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

export const unsafeOutputReports = pgTable("unsafe_output_reports", {
  id: text("id").primaryKey(),
  userId: text("user_id").references(() => users.id, { onDelete: "set null" }),
  conversationId: text("conversation_id").references(() => conversations.id, { onDelete: "set null" }),
  category: text("category").notNull(),
  outputExcerpt: text("output_excerpt").notNull(),
  details: text("details"),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
}, (table) => ({
  userIdIdx: index("unsafe_output_reports_user_id_idx").on(table.userId),
  conversationIdIdx: index("unsafe_output_reports_conversation_id_idx").on(table.conversationId),
  categoryIdx: index("unsafe_output_reports_category_idx").on(table.category),
  createdAtIdx: index("unsafe_output_reports_created_at_idx").on(table.createdAt)
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
  ownerIdIdx: index("generated_audio_owner_id_idx").on(table.ownerId),
  conversationIdIdx: index("generated_audio_conversation_id_idx").on(table.conversationId),
  expiresAtIdx: index("generated_audio_expires_at_idx").on(table.expiresAt)
}));

export const generatedMedia = pgTable("generated_media", {
  id: text("id").primaryKey(),
  ownerId: text("owner_id"),
  conversationId: text("conversation_id").references(() => conversations.id, { onDelete: "set null" }),
  messageId: text("message_id").references(() => messages.id, { onDelete: "set null" }),
  fileName: text("file_name").notNull(),
  mimeType: text("mime_type").notNull(),
  sizeBytes: integer("size_bytes").notNull(),
  localPath: text("local_path"),
  storageKey: text("storage_key"),
  publicUrl: text("public_url"),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
}, (table) => ({
  ownerIdIdx: index("generated_media_owner_id_idx").on(table.ownerId),
  conversationIdIdx: index("generated_media_conversation_id_idx").on(table.conversationId),
  expiresAtIdx: index("generated_media_expires_at_idx").on(table.expiresAt)
}));

export const openAIArtifacts = pgTable("openai_artifacts", {
  id: text("id").primaryKey(),
  ownerId: text("owner_id"),
  conversationId: text("conversation_id").references(() => conversations.id, { onDelete: "set null" }),
  messageId: text("message_id").references(() => messages.id, { onDelete: "set null" }),
  containerId: text("container_id").notNull(),
  fileId: text("file_id").notNull(),
  fileName: text("file_name").notNull(),
  mimeType: text("mime_type").notNull(),
  sizeBytes: integer("size_bytes"),
  localPath: text("local_path"),
  storageKey: text("storage_key"),
  publicUrl: text("public_url"),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
}, (table) => ({
  ownerIdIdx: index("openai_artifacts_owner_id_idx").on(table.ownerId),
  fileIdIdx: index("openai_artifacts_file_id_idx").on(table.fileId),
  expiresAtIdx: index("openai_artifacts_expires_at_idx").on(table.expiresAt)
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

export const usageEvents = pgTable("usage_events", {
  id: text("id").primaryKey(),
  identity: text("identity").notNull(),
  eventType: text("event_type").notNull(),
  tokens: integer("tokens").notNull().default(0),
  costMicroUsd: integer("cost_micro_usd").notNull().default(0),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
}, (table) => ({
  identityCreatedAtIdx: index("usage_events_identity_created_at_idx").on(table.identity, table.createdAt),
  eventTypeIdx: index("usage_events_event_type_idx").on(table.eventType)
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

export const userRelations = relations(users, ({ many }) => ({
  accounts: many(betterAuthAccounts),
  sessions: many(betterAuthSessions)
}));

export const betterAuthAccountRelations = relations(betterAuthAccounts, ({ one }) => ({
  user: one(users, {
    fields: [betterAuthAccounts.userId],
    references: [users.id]
  })
}));

export const betterAuthSessionRelations = relations(betterAuthSessions, ({ one }) => ({
  user: one(users, {
    fields: [betterAuthSessions.userId],
    references: [users.id]
  })
}));
