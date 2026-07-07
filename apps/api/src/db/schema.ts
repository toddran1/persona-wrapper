import { relations } from "drizzle-orm";
import { index, integer, jsonb, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

export const users = pgTable("users", {
  id: text("id").primaryKey(),
  email: text("email"),
  username: text("username"),
  displayName: text("display_name"),
  avatarUrl: text("avatar_url"),
  status: text("status").notNull().default("active"),
  emailVerifiedAt: timestamp("email_verified_at", { withTimezone: true }),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
}, (table) => ({
  emailUnique: uniqueIndex("users_email_unique").on(table.email),
  usernameUnique: uniqueIndex("users_username_unique").on(table.username),
  statusIdx: index("users_status_idx").on(table.status)
}));

export const userPasswordCredentials = pgTable("user_password_credentials", {
  userId: text("user_id").primaryKey().references(() => users.id, { onDelete: "cascade" }),
  passwordHash: text("password_hash").notNull(),
  algorithm: text("algorithm").notNull().default("scrypt"),
  passwordUpdatedAt: timestamp("password_updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
});

export const userOAuthAccounts = pgTable("user_oauth_accounts", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  provider: text("provider").notNull(),
  providerAccountId: text("provider_account_id").notNull(),
  email: text("email"),
  displayName: text("display_name"),
  avatarUrl: text("avatar_url"),
  accessTokenHash: text("access_token_hash"),
  refreshTokenHash: text("refresh_token_hash"),
  scopes: jsonb("scopes").$type<string[]>().notNull().default([]),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
}, (table) => ({
  userIdIdx: index("user_oauth_accounts_user_id_idx").on(table.userId),
  providerAccountUnique: uniqueIndex("user_oauth_accounts_provider_account_unique").on(table.provider, table.providerAccountId)
}));

export const authSessions = pgTable("auth_sessions", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  accessTokenHash: text("access_token_hash").notNull(),
  refreshTokenHash: text("refresh_token_hash").notNull(),
  clientType: text("client_type").notNull().default("web"),
  deviceId: text("device_id"),
  userAgent: text("user_agent"),
  ipAddress: text("ip_address"),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  refreshExpiresAt: timestamp("refresh_expires_at", { withTimezone: true }).notNull(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
}, (table) => ({
  userIdIdx: index("auth_sessions_user_id_idx").on(table.userId),
  accessTokenHashUnique: uniqueIndex("auth_sessions_access_token_hash_unique").on(table.accessTokenHash),
  refreshTokenHashUnique: uniqueIndex("auth_sessions_refresh_token_hash_unique").on(table.refreshTokenHash),
  expiresAtIdx: index("auth_sessions_expires_at_idx").on(table.expiresAt),
  refreshExpiresAtIdx: index("auth_sessions_refresh_expires_at_idx").on(table.refreshExpiresAt)
}));

export const oauthStates = pgTable("oauth_states", {
  id: text("id").primaryKey(),
  stateHash: text("state_hash").notNull(),
  provider: text("provider").notNull(),
  redirectUri: text("redirect_uri"),
  codeVerifier: text("code_verifier"),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
}, (table) => ({
  stateHashUnique: uniqueIndex("oauth_states_state_hash_unique").on(table.stateHash),
  expiresAtIdx: index("oauth_states_expires_at_idx").on(table.expiresAt)
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

export const userRelations = relations(users, ({ many, one }) => ({
  passwordCredential: one(userPasswordCredentials),
  oauthAccounts: many(userOAuthAccounts),
  sessions: many(authSessions)
}));

export const userPasswordCredentialRelations = relations(userPasswordCredentials, ({ one }) => ({
  user: one(users, {
    fields: [userPasswordCredentials.userId],
    references: [users.id]
  })
}));

export const userOAuthAccountRelations = relations(userOAuthAccounts, ({ one }) => ({
  user: one(users, {
    fields: [userOAuthAccounts.userId],
    references: [users.id]
  })
}));

export const authSessionRelations = relations(authSessions, ({ one }) => ({
  user: one(users, {
    fields: [authSessions.userId],
    references: [users.id]
  })
}));
