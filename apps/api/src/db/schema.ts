import { relations, sql } from "drizzle-orm";
import { boolean, check, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

export const users = pgTable("users", {
  id: text("id").primaryKey(),
  email: text("email").notNull(),
  role: text("role").notNull().default("user"),
  username: text("username"),
  displayUsername: text("display_username"),
  displayName: text("display_name").notNull(),
  avatarUrl: text("avatar_url"),
  preferredName: text("preferred_name"),
  gender: text("gender"),
  birthMonth: integer("birth_month"),
  birthDay: integer("birth_day"),
  memoryEnabled: boolean("memory_enabled").notNull().default(true),
  conciseAudioResponses: boolean("concise_audio_responses").notNull().default(true),
  modelProvider: text("model_provider").notNull().default("openai"),
  imageProvider: text("image_provider").notNull().default("openai"),
  personaInfluenceLevel: text("persona_influence_level").notNull().default("uncensored"),
  termsVersionAccepted: text("terms_version_accepted"),
  termsAcceptedAt: timestamp("terms_accepted_at", { withTimezone: true }),
  privacyVersionAccepted: text("privacy_version_accepted"),
  privacyAcceptedAt: timestamp("privacy_accepted_at", { withTimezone: true }),
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
  roleIdx: index("users_role_idx").on(table.role),
  usernameUnique: uniqueIndex("users_username_unique").on(table.username),
  statusIdx: index("users_status_idx").on(table.status),
  deletionScheduledForIdx: index("users_deletion_scheduled_for_idx").on(table.deletionScheduledFor),
  personaInfluenceLevelCheck: check(
    "users_persona_influence_level_check",
    sql`${table.personaInfluenceLevel} in ('uncensored', 'professional')`
  ),
  imageProviderCheck: check(
    "users_image_provider_check",
    sql`${table.imageProvider} in ('openai', 'flux')`
  )
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
  pinned: boolean("pinned").notNull().default(false),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
}, (table) => ({
  userIdIdx: index("conversations_user_id_idx").on(table.userId),
  updatedAtIdx: index("conversations_updated_at_idx").on(table.updatedAt),
  userUpdatedAtIdx: index("conversations_user_updated_at_desc_idx")
    .on(table.userId, table.updatedAt.desc(), table.id.desc()),
  userPinnedUpdatedAtIdx: index("conversations_user_pinned_updated_at_desc_idx")
    .on(table.userId, table.pinned.desc(), table.updatedAt.desc(), table.id.desc()),
  titleTrigramIdx: index("conversations_title_trgm_idx")
    .using("gin", table.title.op("gin_trgm_ops"))
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

export const userPlanAssignments = pgTable("user_plan_assignments", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  planId: text("plan_id").notNull(),
  planVersion: integer("plan_version").notNull(),
  status: text("status").notNull().default("active"),
  source: text("source").notNull().default("system"),
  effectiveAt: timestamp("effective_at", { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
}, (table) => ({
  userEffectiveIdx: index("user_plan_assignments_user_effective_idx")
    .on(table.userId, table.effectiveAt.desc()),
  statusExpiresIdx: index("user_plan_assignments_status_expires_idx")
    .on(table.status, table.expiresAt)
}));

export const billingSubscriptions = pgTable("billing_subscriptions", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  provider: text("provider").notNull(),
  externalSubscriptionId: text("external_subscription_id").notNull(),
  planAssignmentId: text("plan_assignment_id").notNull().references(() => userPlanAssignments.id, { onDelete: "cascade" }),
  productId: text("product_id").notNull(),
  planId: text("plan_id").notNull(),
  status: text("status").notNull(),
  store: text("store"),
  environment: text("environment").notNull(),
  currentPeriodEndsAt: timestamp("current_period_ends_at", { withTimezone: true }),
  lastEventId: text("last_event_id").notNull(),
  lastEventAt: timestamp("last_event_at", { withTimezone: true }).notNull(),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
}, (table) => ({
  providerExternalUnique: uniqueIndex("billing_subscriptions_provider_external_unique")
    .on(table.provider, table.externalSubscriptionId),
  userStatusIdx: index("billing_subscriptions_user_status_idx").on(table.userId, table.status),
  periodEndIdx: index("billing_subscriptions_period_end_idx").on(table.currentPeriodEndsAt)
}));

export const billingWebhookEvents = pgTable("billing_webhook_events", {
  id: text("id").primaryKey(),
  provider: text("provider").notNull(),
  eventType: text("event_type").notNull(),
  appUserId: text("app_user_id"),
  environment: text("environment"),
  status: text("status").notNull().default("received"),
  error: text("error"),
  payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
  receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
  processedAt: timestamp("processed_at", { withTimezone: true }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
}, (table) => ({
  statusReceivedIdx: index("billing_webhook_events_status_received_idx").on(table.status, table.receivedAt),
  appUserIdx: index("billing_webhook_events_app_user_idx").on(table.appUserId)
}));

export const customerUsageBalances = pgTable("customer_usage_balances", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  meterKey: text("meter_key").notNull(),
  periodStart: timestamp("period_start", { withTimezone: true }).notNull(),
  periodEnd: timestamp("period_end", { withTimezone: true }).notNull(),
  usedQuantity: integer("used_quantity").notNull().default(0),
  reservedQuantity: integer("reserved_quantity").notNull().default(0),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
}, (table) => ({
  userMeterPeriodUnique: uniqueIndex("customer_usage_balances_user_meter_period_unique")
    .on(table.userId, table.meterKey, table.periodStart),
  periodEndIdx: index("customer_usage_balances_period_end_idx").on(table.periodEnd)
}));

export const customerUsageEvents = pgTable("customer_usage_events", {
  id: text("id").primaryKey(),
  operationId: text("operation_id").notNull(),
  idempotencyKey: text("idempotency_key").notNull(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  meterKey: text("meter_key").notNull(),
  quantity: integer("quantity").notNull().default(0),
  status: text("status").notNull(),
  planId: text("plan_id").notNull(),
  planVersion: integer("plan_version").notNull(),
  provider: text("provider"),
  model: text("model"),
  estimatedCostMicroUsd: integer("estimated_cost_micro_usd").notNull().default(0),
  actualCostMicroUsd: integer("actual_cost_micro_usd").notNull().default(0),
  conversationId: text("conversation_id").references(() => conversations.id, { onDelete: "set null" }),
  messageId: text("message_id").references(() => messages.id, { onDelete: "set null" }),
  periodStart: timestamp("period_start", { withTimezone: true }).notNull(),
  periodEnd: timestamp("period_end", { withTimezone: true }).notNull(),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  settledAt: timestamp("settled_at", { withTimezone: true })
}, (table) => ({
  userIdempotencyMeterUnique: uniqueIndex("customer_usage_events_user_idempotency_meter_unique")
    .on(table.userId, table.idempotencyKey, table.meterKey),
  operationIdx: index("customer_usage_events_operation_idx").on(table.operationId),
  userPeriodIdx: index("customer_usage_events_user_period_idx")
    .on(table.userId, table.periodStart, table.meterKey),
  statusCreatedIdx: index("customer_usage_events_status_created_idx")
    .on(table.status, table.createdAt)
}));

/**
 * Provider-neutral analyses of public media. These rows never contain user,
 * conversation, or persona context, so one expensive public-video inspection
 * can be safely reused across users and personas.
 */
export const publicMediaAnalyses = pgTable("public_media_analyses", {
  id: text("id").primaryKey(),
  mediaKind: text("media_kind").notNull(),
  mediaId: text("media_id").notNull(),
  provider: text("provider").notNull(),
  model: text("model").notNull(),
  resolution: text("resolution").notNull(),
  analysisVersion: text("analysis_version").notNull(),
  analysisText: text("analysis_text").notNull(),
  inputTokens: integer("input_tokens").notNull().default(0),
  outputTokens: integer("output_tokens").notNull().default(0),
  reasoningTokens: integer("reasoning_tokens").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull()
}, (table) => ({
  lookupUnique: uniqueIndex("public_media_analyses_lookup_unique")
    .on(table.mediaKind, table.mediaId, table.provider, table.model, table.resolution, table.analysisVersion),
  expiresAtIdx: index("public_media_analyses_expires_at_idx").on(table.expiresAt)
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
