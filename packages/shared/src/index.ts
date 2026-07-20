import { z } from "zod";
import { initContract } from "@ts-rest/core";

export const providerSchema = z.enum(["openai", "openai_persona", "claude", "local"]);
export type ProviderId = z.infer<typeof providerSchema>;

export const outputTypeSchema = z.enum([
  "text",
  "json",
  "audio",
  "image",
  "video",
  "chart",
  "file",
  "tool_call",
  "tool_result",
  "source_list",
  "table",
  "code",
  "status",
  "action"
]);
export type OutputType = z.infer<typeof outputTypeSchema>;

export const toolNameSchema = z.enum([
  "web_search",
  "file_search",
  "data_analysis",
  "image_generation",
  "current_time"
]);
export type ToolName = z.infer<typeof toolNameSchema>;

export const chatMessageSchema = z.object({
  role: z.enum(["system", "user", "assistant", "tool"]),
  content: z.string(),
  name: z.string().optional()
});
export type ChatMessage = z.infer<typeof chatMessageSchema>;

export const toolDefinitionSchema = z.object({
  name: toolNameSchema,
  description: z.string(),
  inputSchema: z.record(z.string(), z.unknown()),
  owner: z.enum(["openai", "application"]).default("application")
});
export type ToolDefinition = z.infer<typeof toolDefinitionSchema>;

export const chartSeriesSchema = z.object({
  label: z.string(),
  value: z.number()
});
export type ChartSeries = z.infer<typeof chartSeriesSchema>;

export const textOutputSchema = z.object({
  type: z.literal("text"),
  text: z.string()
});

export const jsonOutputSchema = z.object({
  type: z.literal("json"),
  data: z.record(z.string(), z.unknown())
});

export const audioOutputSchema = z.object({
  type: z.literal("audio"),
  url: z.string(),
  mimeType: z.string(),
  transcript: z.string().optional()
});

export const imageOutputSchema = z.object({
  type: z.literal("image"),
  url: z.string(),
  alt: z.string(),
  prompt: z.string().optional(),
  mimeType: z.string().optional(),
  fileId: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).optional()
});

export const videoOutputSchema = z.object({
  type: z.literal("video"),
  url: z.string(),
  mimeType: z.string(),
  title: z.string().optional(),
  fileName: z.string().optional(),
  fileId: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).optional()
});

export const chartOutputSchema = z.object({
  type: z.literal("chart"),
  title: z.string(),
  chartType: z.enum(["bar", "line", "pie"]),
  series: z.array(chartSeriesSchema)
});

export const fileOutputSchema = z.object({
  type: z.literal("file"),
  fileName: z.string(),
  url: z.string(),
  mimeType: z.string(),
  description: z.string().optional(),
  fileId: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).optional()
});

// File artifacts already provide a download control in the client. Some model
// responses also add a standalone "download here" sentence that has no link.
const generatedFileDownloadPromptLine =
  /^\s*(?:download\s+(?:(?:it|the\s+(?:file|spreadsheet|workbook|report))\s+)?(?:right\s+)?(?:here|below)|(?:click|tap)\s+(?:the\s+)?(?:download\s+)?(?:link|file|button)\s+(?:below|above|here)|(?:the\s+)?(?:download|file)\s+(?:is\s+)?(?:attached|below|above))\s*[:.!]*\s*$/gim;

export function stripGeneratedFileDownloadPrompt(text: string): string {
  return text
    .replace(generatedFileDownloadPromptLine, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export const toolCallOutputSchema = z.object({
  type: z.literal("tool_call"),
  toolName: toolNameSchema,
  arguments: z.record(z.string(), z.unknown()),
  status: z.enum(["planned", "completed", "failed"])
});

export const toolResultOutputSchema = z.object({
  type: z.literal("tool_result"),
  toolName: toolNameSchema.or(z.string()),
  status: z.enum(["completed", "failed", "in_progress"]),
  result: z.unknown().optional()
});

export const citationSchema = z.object({
  title: z.string(),
  url: z.string().url(),
  snippet: z.string().optional(),
  publishedAt: z.string().optional(),
  sourceType: z.string().optional()
});
export type Citation = z.infer<typeof citationSchema>;

export const sourceListOutputSchema = z.object({
  type: z.literal("source_list"),
  sources: z.array(citationSchema)
});

export const tableOutputSchema = z.object({
  type: z.literal("table"),
  title: z.string().optional(),
  columns: z.array(z.string()),
  rows: z.array(z.array(z.union([z.string(), z.number(), z.boolean(), z.null()])))
});

export const codeOutputSchema = z.object({
  type: z.literal("code"),
  code: z.string(),
  language: z.string().optional(),
  title: z.string().optional()
});

export const statusOutputSchema = z.object({
  type: z.literal("status"),
  status: z.enum(["queued", "in_progress", "completed", "failed", "cancelled"]),
  message: z.string(),
  progress: z.number().min(0).max(100).optional()
});

export const actionOutputSchema = z.object({
  type: z.literal("action"),
  id: z.string(),
  label: z.string(),
  action: z.string(),
  arguments: z.record(z.string(), z.unknown()).optional(),
  style: z.enum(["primary", "secondary", "danger"]).optional()
});

export const contentBlockSchema = z.discriminatedUnion("type", [
  textOutputSchema,
  jsonOutputSchema,
  audioOutputSchema,
  imageOutputSchema,
  videoOutputSchema,
  chartOutputSchema,
  fileOutputSchema,
  toolCallOutputSchema,
  toolResultOutputSchema,
  sourceListOutputSchema,
  tableOutputSchema,
  codeOutputSchema,
  statusOutputSchema,
  actionOutputSchema
]);
export type ContentBlock = z.infer<typeof contentBlockSchema>;

export const uploadedAssetSchema = z.object({
  id: z.string(),
  kind: z.enum(["image", "file"]),
  fileName: z.string(),
  mimeType: z.string(),
  sizeBytes: z.number().int().nonnegative(),
  url: z.string().optional(),
  openaiFileId: z.string().optional(),
  vectorStoreId: z.string().optional(),
  expiresAt: z.string().optional()
});
export type UploadedAsset = z.infer<typeof uploadedAssetSchema>;

export const toolOptionsSchema = z.object({
  webSearch: z.boolean().default(false),
  fileSearch: z.boolean().default(false),
  codeInterpreter: z.boolean().default(false),
  imageGeneration: z.boolean().default(false),
  appFunctions: z.boolean().default(false),
  background: z.boolean().default(false),
  vectorStoreIds: z.array(z.string()).default([])
});
export type ToolOptions = z.infer<typeof toolOptionsSchema>;

export const clientContextSchema = z.object({
  locale: z.string().optional(),
  timeZone: z.string().optional(),
  currentDateTime: z.string().optional(),
  utcOffsetMinutes: z.number().optional(),
  location: z
    .object({
      latitude: z.number(),
      longitude: z.number(),
      accuracyMeters: z.number().optional()
    })
    .optional()
});
export type ClientContext = z.infer<typeof clientContextSchema>;

export const authClientTypeSchema = z.enum(["web", "desktop", "ios", "android", "unknown"]);
export type AuthClientType = z.infer<typeof authClientTypeSchema>;

export const oauthProviderSchema = z.enum(["google", "facebook"]);
export type OAuthProvider = z.infer<typeof oauthProviderSchema>;

export const authUserSchema = z.object({
  id: z.string(),
  email: z.string().email().nullable().optional(),
  username: z.string().nullable().optional(),
  displayName: z.string().nullable().optional(),
  avatarUrl: z.string().nullable().optional(),
  status: z.string(),
  deletionRequestedAt: z.string().nullable().optional(),
  deletionScheduledFor: z.string().nullable().optional(),
  createdAt: z.string(),
  updatedAt: z.string()
});
export type AuthUser = z.infer<typeof authUserSchema>;

export const authSessionSchema = z.object({
  id: z.string(),
  userId: z.string(),
  clientType: authClientTypeSchema,
  expiresAt: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  userAgent: z.string().nullable().optional(),
  ipAddress: z.string().nullable().optional()
});
export type AuthSession = z.infer<typeof authSessionSchema>;

export const activeSessionSchema = z.object({
  id: z.string(),
  clientType: authClientTypeSchema,
  deviceId: z.string().nullable().optional(),
  userAgent: z.string().nullable().optional(),
  createdAt: z.string(),
  lastActiveAt: z.string(),
  refreshExpiresAt: z.string(),
  current: z.boolean()
});
export type ActiveSession = z.infer<typeof activeSessionSchema>;

export const activeSessionsResponseSchema = z.object({
  sessions: z.array(activeSessionSchema)
});
export type ActiveSessionsResponse = z.infer<typeof activeSessionsResponseSchema>;

export const revokeOtherSessionsResponseSchema = z.object({
  revoked: z.number().int().nonnegative()
});
export type RevokeOtherSessionsResponse = z.infer<typeof revokeOtherSessionsResponseSchema>;

export const registerRequestSchema = z.object({
  email: z.string().email().optional(),
  username: z.string().min(3).max(64).optional(),
  password: z.string().min(8).max(256),
  displayName: z.string().min(1).max(120).optional(),
  clientType: authClientTypeSchema.default("web"),
  deviceId: z.string().max(200).optional()
}).refine((value) => Boolean(value.email || value.username), {
  message: "Either email or username is required.",
  path: ["email"]
});
export type RegisterRequest = z.infer<typeof registerRequestSchema>;

export const loginRequestSchema = z.object({
  identifier: z.string().min(1).max(320),
  password: z.string().min(1).max(256),
  clientType: authClientTypeSchema.default("web"),
  deviceId: z.string().max(200).optional()
});
export type LoginRequest = z.infer<typeof loginRequestSchema>;

export const restoreAccountRequestSchema = loginRequestSchema;
export type RestoreAccountRequest = z.infer<typeof restoreAccountRequestSchema>;

export const deleteAccountRequestSchema = z.object({
  confirmation: z.literal("DELETE"),
  password: z.string().min(1).max(256).optional()
});
export type DeleteAccountRequest = z.infer<typeof deleteAccountRequestSchema>;

export const accountDeletionResponseSchema = z.object({
  status: z.literal("pending_deletion"),
  deletionRequestedAt: z.string(),
  deletionScheduledFor: z.string()
});
export type AccountDeletionResponse = z.infer<typeof accountDeletionResponseSchema>;

export const meResponseSchema = z.object({
  user: authUserSchema,
  session: authSessionSchema.optional()
});
export type MeResponse = z.infer<typeof meResponseSchema>;

export const oauthProviderStatusSchema = z.object({
  provider: oauthProviderSchema,
  enabled: z.boolean()
});
export type OAuthProviderStatus = z.infer<typeof oauthProviderStatusSchema>;

export const connectedAccountSchema = z.object({
  id: z.string(),
  providerId: z.string(),
  accountId: z.string(),
  createdAt: z.string(),
  updatedAt: z.string()
});
export type ConnectedAccount = z.infer<typeof connectedAccountSchema>;

export const chatRequestSchema = z.object({
  personaId: z.string().min(1),
  message: z.string().min(1),
  provider: providerSchema.default("openai"),
  audio: z.boolean().default(false),
  testMode: z.boolean().default(false),
  conversationId: z.string().optional(),
  history: z.array(chatMessageSchema).default([]),
  requestedOutputs: z.array(outputTypeSchema).optional(),
  clientContext: clientContextSchema.optional(),
  attachments: z.array(uploadedAssetSchema).max(10).optional(),
  toolOptions: toolOptionsSchema.optional()
});
export type ChatRequest = z.infer<typeof chatRequestSchema>;

export const personaThemeSchema = z.object({
  mode: z.enum(["dark", "light"]),
  themeName: z.string(),
  background: z.string(),
  backgroundAccent: z.string(),
  backgroundAccentSecondary: z.string(),
  surface: z.string(),
  surfaceStrong: z.string(),
  border: z.string(),
  accent: z.string(),
  accent2: z.string(),
  text: z.string(),
  muted: z.string()
});
export type PersonaTheme = z.infer<typeof personaThemeSchema>;

export const personaVisualStageSchema = z.object({
  loops: z.object({
    idle: z.array(z.string()),
    thinking: z.array(z.string()),
    speaking: z.array(z.string())
  }),
  transitions: z.record(z.string(), z.string()).default({}),
  fallbackImages: z.object({
    idle: z.string(),
    thinking: z.string(),
    speaking: z.string()
  })
});
export type PersonaVisualStage = z.infer<typeof personaVisualStageSchema>;

export const personaSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  shortName: z.string().min(1).max(80).optional(),
  legalName: z.string().optional(),
  age: z.string().optional(),
  height: z.string().optional(),
  weight: z.string().optional(),
  tagline: z.string(),
  description: z.string(),
  avatarColor: z.string(),
  avatarUrl: z.string().optional(),
  visualReference360FullbodyImage: z.string().optional(),
  visualReference360FaceImage: z.string().optional(),
  visualStage: personaVisualStageSchema.optional(),
  theme: personaThemeSchema,
  documentTitle: z.string().default("For the Baddiez"),
  promptPlaceholder: z.string().default("Ask anything"),
  suggestedPrompts: z.array(z.string()).default([]),
  supportedProviders: z.array(providerSchema)
});
export type PersonaSummary = z.infer<typeof personaSummarySchema>;

export const personaDefinitionSchema = personaSummarySchema.extend({
  legalName: z.string(),
  age: z.string(),
  height: z.string(),
  weight: z.string(),
  biography: z.string(),
  personalityTraits: z.array(z.string()),
  speechStyle: z.array(z.string()),
  catchphrases: z.array(z.string()),
  visualStyle: z.array(z.string()),
  safetyBoundaries: z.array(z.string()),
  voiceProfile: z.object({
    defaultVoiceId: z.string(),
    speakingStyle: z.string(),
    elevenLabs: z.object({
      voiceId: z.string().optional(),
      modelId: z.string().optional(),
      outputFormat: z.string().optional(),
      speed: z.number().min(0.7).max(1.2).optional(),
      stability: z.number().min(0).max(1).optional(),
      similarityBoost: z.number().min(0).max(1).optional(),
      style: z.number().min(0).max(1).optional(),
      useSpeakerBoost: z.boolean().optional()
    }).optional()
  }),
  defaultTools: z.array(toolNameSchema)
});
export type PersonaDefinition = z.infer<typeof personaDefinitionSchema>;

export const llmInputSchema = z.object({
  persona: personaDefinitionSchema,
  systemPrompt: z.string(),
  baseSystemPrompt: z.string().optional(),
  messages: z.array(chatMessageSchema),
  baseMessages: z.array(chatMessageSchema).optional(),
  userMessage: z.string(),
  toolDefinitions: z.array(toolDefinitionSchema),
  requestedOutputs: z.array(outputTypeSchema).optional(),
  attachments: z.array(uploadedAssetSchema).optional(),
  toolOptions: toolOptionsSchema.optional(),
  audio: z.boolean().default(false),
  clientContext: clientContextSchema.optional()
});
export type LLMInput = z.infer<typeof llmInputSchema>;

export const llmOutputSchema = z.object({
  provider: providerSchema,
  rawText: z.string(),
  content: z.array(contentBlockSchema),
  usage: z.object({
    inputTokens: z.number().int().nonnegative(),
    outputTokens: z.number().int().nonnegative(),
    totalTokens: z.number().int().nonnegative().optional(),
    cachedInputTokens: z.number().int().nonnegative().optional(),
    reasoningTokens: z.number().int().nonnegative().optional(),
    estimatedCostUsd: z.number().nonnegative().optional()
  }).optional(),
  metadata: z.record(z.string(), z.unknown()).optional()
});
export type LLMOutput = z.infer<typeof llmOutputSchema>;

export const styleTransferInputSchema = z.object({
  neutralText: z.string().min(1),
  persona: personaDefinitionSchema,
  conversationHistory: z.array(chatMessageSchema).default([]),
  userMessage: z.string(),
  provider: providerSchema
});
export type StyleTransferInput = z.infer<typeof styleTransferInputSchema>;

export const styleTransferOutputSchema = z.object({
  provider: z.enum(["stub_style_transfer", "local_style_transfer", "remote_style_transfer"]),
  styledText: z.string(),
  metadata: z.record(z.string(), z.unknown()).optional()
});
export type StyleTransferOutput = z.infer<typeof styleTransferOutputSchema>;

export const ttsInputSchema = z.object({
  text: z.string().min(1),
  persona: personaDefinitionSchema,
  voiceId: z.string().optional(),
  ownerId: z.string().optional(),
  conversationId: z.string().optional(),
  messageId: z.string().optional()
});
export type TTSInput = z.infer<typeof ttsInputSchema>;

export const ttsOutputSchema = z.object({
  provider: z.enum(["openai_tts", "elevenlabs_tts", "local_tts"]),
  url: z.string(),
  mimeType: z.string(),
  durationMs: z.number().int().nonnegative().optional()
});
export type TTSOutput = z.infer<typeof ttsOutputSchema>;

export const chatResponseSchema = z.object({
  persona: personaSummarySchema,
  provider: providerSchema,
  conversationId: z.string(),
  history: z.array(chatMessageSchema),
  outputs: z.array(contentBlockSchema),
  generatedAt: z.string(),
  diagnostics: z.object({
    requestedAudio: z.boolean(),
    toolsAvailable: z.array(toolNameSchema),
    messageCount: z.number().int().nonnegative(),
    testMode: z.boolean().optional(),
    neutralResponse: z.string().optional(),
    responseId: z.string().optional(),
    providerModel: z.string().optional(),
    backgroundJob: z.object({
      id: z.string(),
      status: z.enum(["queued", "running", "completed", "failed", "cancelled"]),
      pollUrl: z.string(),
      providerResponseId: z.string().optional(),
      providerStatus: z.string().optional()
    }).optional(),
    tts: z.object({
      status: z.enum(["not_requested", "skipped_no_text", "generated", "failed"]),
      provider: z.string().optional(),
      url: z.string().optional(),
      mimeType: z.string().optional(),
      error: z.string().optional(),
      reason: z.string().optional(),
      textCharacters: z.number().int().nonnegative().optional(),
      scriptMode: z.enum(["mechanical", "openai_inline"]).optional()
    }).optional()
  }),
  usage: z.object({
    inputTokens: z.number().int().nonnegative(),
    outputTokens: z.number().int().nonnegative(),
    totalTokens: z.number().int().nonnegative().optional(),
    cachedInputTokens: z.number().int().nonnegative().optional(),
    reasoningTokens: z.number().int().nonnegative().optional(),
    estimatedCostUsd: z.number().nonnegative().optional()
  }).optional()
});
export type ChatResponse = z.infer<typeof chatResponseSchema>;

export const chatJobFailureReasonSchema = z.enum([
  "frontend_poll_timeout",
  "openai_background_timeout",
  "manual_cancel",
  "provider_failure"
]);
export type ChatJobFailureReason = z.infer<typeof chatJobFailureReasonSchema>;

export const chatJobResponseSchema = z.object({
  id: z.string(),
  status: z.enum(["queued", "running", "completed", "failed", "cancelled"]),
  response: chatResponseSchema.optional(),
  error: z.string().optional(),
  failureReason: chatJobFailureReasonSchema.optional(),
  providerResponseId: z.string().optional(),
  providerStatus: z.string().optional(),
  updatedAt: z.string()
});
export type ChatJobResponse = z.infer<typeof chatJobResponseSchema>;

export const conversationSummarySchema = z.object({
  id: z.string(),
  personaId: z.string().optional(),
  title: z.string(),
  pinned: z.boolean().default(false),
  messageCount: z.number().int().nonnegative(),
  createdAt: z.string(),
  updatedAt: z.string()
});
export type ConversationSummary = z.infer<typeof conversationSummarySchema>;

export const conversationUserAssetSchema = z.object({
  id: z.string(),
  kind: z.enum(["image", "file"]),
  fileName: z.string(),
  mimeType: z.string(),
  url: z.string().optional()
});
export type ConversationUserAsset = z.infer<typeof conversationUserAssetSchema>;

export const conversationTurnSchema = z.object({
  userMessage: z.string(),
  userAssets: z.array(conversationUserAssetSchema).default([]),
  assistantText: z.string(),
  outputs: z.array(contentBlockSchema),
  provider: providerSchema.optional(),
  providerModel: z.string().optional(),
  responseId: z.string().optional(),
  styleTransferProvider: z.string().optional(),
  usage: chatResponseSchema.shape.usage.optional(),
  backgroundJobId: z.string().optional()
});
export type ConversationTurn = z.infer<typeof conversationTurnSchema>;

export const conversationDetailSchema = conversationSummarySchema.extend({
  history: z.array(chatMessageSchema),
  turns: z.array(conversationTurnSchema).default([])
});
export type ConversationDetail = z.infer<typeof conversationDetailSchema>;

export const conversationListPageSchema = z.object({
  conversations: z.array(conversationSummarySchema),
  nextCursor: z.string().nullable()
});
export type ConversationListPage = z.infer<typeof conversationListPageSchema>;

export const conversationTurnsPageSchema = z.object({
  conversation: conversationSummarySchema,
  turns: z.array(conversationTurnSchema),
  nextCursor: z.string().nullable()
});
export type ConversationTurnsPage = z.infer<typeof conversationTurnsPageSchema>;

export const portableConversationMessageSchema = chatMessageSchema.extend({
  outputs: z.array(contentBlockSchema).max(100).optional(),
  createdAt: z.string().datetime().optional()
});
export type PortableConversationMessage = z.infer<typeof portableConversationMessageSchema>;

export const portableConversationSchema = z.object({
  id: z.string().min(1).max(200).optional(),
  title: z.string().min(1).max(500),
  personaId: z.string().min(1).max(120).optional(),
  pinned: z.boolean().default(false),
  createdAt: z.string().datetime().optional(),
  updatedAt: z.string().datetime().optional(),
  messages: z.array(portableConversationMessageSchema).min(1).max(10000)
});
export type PortableConversation = z.infer<typeof portableConversationSchema>;

export const forTheBaddiezArchiveSchema = z.object({
  format: z.literal("for-the-baddiez-export"),
  version: z.literal(1),
  exportedAt: z.string().datetime(),
  scope: z.enum(["account", "conversations"]),
  account: z.object({
    email: z.string().email().nullable().optional(),
    username: z.string().nullable().optional(),
    displayName: z.string().nullable().optional(),
    avatarUrl: z.string().nullable().optional(),
    createdAt: z.string().datetime().optional()
  }).optional(),
  conversations: z.array(portableConversationSchema).max(10000),
  media: z.array(z.object({
    kind: z.enum(["upload", "generated_media", "generated_audio", "openai_artifact"]),
    fileName: z.string().max(500),
    mimeType: z.string().max(200).optional(),
    createdAt: z.string().datetime().optional()
  })).optional()
});
export type ForTheBaddiezArchive = z.infer<typeof forTheBaddiezArchiveSchema>;

export const dataImportRequestSchema = z.object({
  archive: z.unknown()
});
export type DataImportRequest = z.infer<typeof dataImportRequestSchema>;

export const dataImportResultSchema = z.object({
  source: z.enum(["for-the-baddiez", "chatgpt", "claude"]),
  importedConversations: z.number().int().nonnegative(),
  skippedConversations: z.number().int().nonnegative(),
  conversations: z.array(conversationSummarySchema)
});
export type DataImportResult = z.infer<typeof dataImportResultSchema>;

export const dataTransferJobSchema = z.object({
  id: z.string(),
  kind: z.enum(["import", "export"]),
  status: z.enum(["awaiting_upload", "queued", "running", "completed", "failed", "cancelled"]),
  phase: z.string(),
  progress: z.number().int().min(0).max(100),
  processedItems: z.number().int().nonnegative(),
  totalItems: z.number().int().nonnegative(),
  source: z.enum(["for-the-baddiez", "chatgpt", "claude"]).optional(),
  result: dataImportResultSchema.optional(),
  downloadUrl: z.string().optional(),
  fileName: z.string().optional(),
  sizeBytes: z.number().int().nonnegative().optional(),
  error: z.string().optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  expiresAt: z.string().datetime().optional()
});
export type DataTransferJob = z.infer<typeof dataTransferJobSchema>;

export const dataExportJobRequestSchema = z.object({
  scope: z.enum(["account", "conversations"]),
  conversationIds: z.array(z.string().min(1)).max(10000).optional()
}).superRefine((value, context) => {
  if (value.scope === "conversations" && !value.conversationIds?.length) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["conversationIds"], message: "Select at least one conversation." });
  }
});
export type DataExportJobRequest = z.infer<typeof dataExportJobRequestSchema>;

export const uploadPresignRequestSchema = z.object({
  fileName: z.string().min(1).max(500),
  mimeType: z.string().min(1).max(200),
  sizeBytes: z.number().int().positive()
});
export type UploadPresignRequest = z.infer<typeof uploadPresignRequestSchema>;

export const uploadPresignResponseSchema = z.object({
  assetId: z.string(),
  uploadUrl: z.string().url(),
  headers: z.record(z.string(), z.string()),
  expiresAt: z.string()
});
export type UploadPresignResponse = z.infer<typeof uploadPresignResponseSchema>;

export const dataImportPresignRequestSchema = uploadPresignRequestSchema.extend({
  sha256: z.string().regex(/^[a-f0-9]{64}$/i).optional()
});
export type DataImportPresignRequest = z.infer<typeof dataImportPresignRequestSchema>;

export const dataImportPresignResponseSchema = uploadPresignResponseSchema.extend({
  jobId: z.string()
});
export type DataImportPresignResponse = z.infer<typeof dataImportPresignResponseSchema>;

export const vectorStoreRequestSchema = z.object({
  assetIds: z.array(z.string()).min(1).max(20),
  name: z.string().max(100).optional()
});

export const vectorStoreSchema = z.object({ id: z.string(), expiresAt: z.string() });

export const selectedConversationExportSchema = z.object({
  conversationIds: z.array(z.string().min(1)).min(1).max(100)
});

const contract = initContract();
export const apiErrorSchema = z.object({
  error: z.string(),
  code: z.string().optional(),
  requestId: z.string().optional()
});
const pageQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  query: z.string().max(120).optional()
});

/** Shared runtime contract for the endpoints used by both first-party clients. */
export const apiContract = contract.router({
  personas: contract.router({
    list: {
      method: "GET",
      path: "/api/personas",
      responses: { 200: z.object({ personas: z.array(personaSummarySchema) }) }
    },
    get: {
      method: "GET",
      path: "/api/personas/:id",
      pathParams: z.object({ id: z.string().min(1) }),
      responses: {
        200: z.object({ persona: personaDefinitionSchema }),
        404: apiErrorSchema
      }
    }
  }),
  chat: contract.router({
    create: {
      method: "POST",
      path: "/api/chat",
      body: chatRequestSchema,
      responses: { 200: chatResponseSchema, 202: chatResponseSchema, 400: apiErrorSchema }
    },
    getJob: {
      method: "GET",
      path: "/api/chat/jobs/:jobId",
      pathParams: z.object({ jobId: z.string().min(1) }),
      responses: { 200: chatJobResponseSchema, 404: apiErrorSchema }
    },
    cancelJob: {
      method: "POST",
      path: "/api/chat/jobs/:jobId/cancel",
      pathParams: z.object({ jobId: z.string().min(1) }),
      body: contract.noBody(),
      responses: { 200: chatJobResponseSchema, 404: apiErrorSchema }
    }
  }),
  conversations: contract.router({
    list: {
      method: "GET",
      path: "/api/chat/conversations",
      query: pageQuerySchema,
      responses: { 200: conversationListPageSchema, 400: apiErrorSchema }
    },
    turns: {
      method: "GET",
      path: "/api/chat/conversations/:conversationId/turns",
      pathParams: z.object({ conversationId: z.string().min(1) }),
      query: pageQuerySchema.omit({ query: true }),
      responses: { 200: conversationTurnsPageSchema, 404: apiErrorSchema }
    },
    get: {
      method: "GET",
      path: "/api/chat/conversations/:conversationId",
      pathParams: z.object({ conversationId: z.string().min(1) }),
      responses: { 200: z.object({ conversation: conversationDetailSchema }), 404: apiErrorSchema }
    },
    update: {
      method: "PATCH",
      path: "/api/chat/conversations/:conversationId",
      pathParams: z.object({ conversationId: z.string().min(1) }),
      body: z.object({ title: z.string().trim().min(1).max(120).optional(), pinned: z.boolean().optional() }),
      responses: { 200: z.object({ conversation: conversationSummarySchema }), 404: apiErrorSchema }
    },
    remove: {
      method: "DELETE",
      path: "/api/chat/conversations/:conversationId",
      pathParams: z.object({ conversationId: z.string().min(1) }),
      body: contract.noBody(),
      responses: { 204: contract.noBody(), 404: apiErrorSchema }
    }
  }),
  account: contract.router({
    restore: {
      method: "POST",
      path: "/api/account/restore",
      body: restoreAccountRequestSchema,
      responses: { 200: z.object({ restored: z.literal(true) }), 401: apiErrorSchema, 409: apiErrorSchema }
    },
    remove: {
      method: "DELETE",
      path: "/api/account",
      body: deleteAccountRequestSchema,
      responses: { 202: accountDeletionResponseSchema, 401: apiErrorSchema, 404: apiErrorSchema }
    },
    oauthProviders: {
      method: "GET",
      path: "/api/account/oauth/providers",
      responses: { 200: z.object({ providers: z.array(oauthProviderStatusSchema) }) }
    }
  }),
  uploads: contract.router({
    list: {
      method: "GET",
      path: "/api/uploads",
      responses: { 200: z.object({ assets: z.array(uploadedAssetSchema) }) }
    },
    presign: {
      method: "POST",
      path: "/api/uploads/presign",
      body: uploadPresignRequestSchema,
      responses: { 201: uploadPresignResponseSchema, 409: apiErrorSchema }
    },
    complete: {
      method: "POST",
      path: "/api/uploads/:id/complete",
      pathParams: z.object({ id: z.string().min(1) }),
      body: contract.noBody(),
      responses: { 200: z.object({ asset: uploadedAssetSchema }), 400: apiErrorSchema, 404: apiErrorSchema, 409: apiErrorSchema }
    },
    remove: {
      method: "DELETE",
      path: "/api/uploads/:id",
      pathParams: z.object({ id: z.string().min(1) }),
      body: contract.noBody(),
      responses: { 204: contract.noBody(), 404: apiErrorSchema }
    },
    createVectorStore: {
      method: "POST",
      path: "/api/uploads/vector-stores",
      body: vectorStoreRequestSchema,
      responses: { 201: z.object({ vectorStore: vectorStoreSchema }) }
    },
    removeVectorStore: {
      method: "DELETE",
      path: "/api/uploads/vector-stores/:id",
      pathParams: z.object({ id: z.string().min(1) }),
      body: contract.noBody(),
      responses: { 204: contract.noBody(), 404: apiErrorSchema }
    }
  }),
  data: contract.router({
    exportAccount: {
      method: "GET",
      path: "/api/data/export/account",
      responses: { 200: forTheBaddiezArchiveSchema }
    },
    exportConversations: {
      method: "POST",
      path: "/api/data/export/conversations",
      body: selectedConversationExportSchema,
      responses: { 200: forTheBaddiezArchiveSchema }
    },
    import: {
      method: "POST",
      path: "/api/data/import",
      body: dataImportRequestSchema,
      responses: { 201: dataImportResultSchema }
    },
    startExportJob: {
      method: "POST",
      path: "/api/data/jobs/export",
      body: dataExportJobRequestSchema,
      responses: { 202: dataTransferJobSchema, 400: apiErrorSchema, 409: apiErrorSchema }
    },
    presignImportJob: {
      method: "POST",
      path: "/api/data/jobs/import/presign",
      body: dataImportPresignRequestSchema,
      responses: { 201: dataImportPresignResponseSchema, 400: apiErrorSchema, 409: apiErrorSchema, 413: apiErrorSchema }
    },
    completeImportJob: {
      method: "POST",
      path: "/api/data/jobs/:jobId/import/complete",
      pathParams: z.object({ jobId: z.string().min(1) }),
      body: contract.noBody(),
      responses: { 202: dataTransferJobSchema, 400: apiErrorSchema, 404: apiErrorSchema, 409: apiErrorSchema }
    },
    getJob: {
      method: "GET",
      path: "/api/data/jobs/:jobId",
      pathParams: z.object({ jobId: z.string().min(1) }),
      responses: { 200: dataTransferJobSchema, 404: apiErrorSchema }
    },
    cancelJob: {
      method: "DELETE",
      path: "/api/data/jobs/:jobId",
      pathParams: z.object({ jobId: z.string().min(1) }),
      body: contract.noBody(),
      responses: { 200: dataTransferJobSchema, 404: apiErrorSchema }
    }
  })
});

export type ApiContract = typeof apiContract;
