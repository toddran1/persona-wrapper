import { z } from "zod";

export const providerSchema = z.enum(["openai", "claude", "local"]);
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
  inputSchema: z.record(z.unknown()),
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
  data: z.record(z.unknown())
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
  metadata: z.record(z.unknown()).optional()
});

export const videoOutputSchema = z.object({
  type: z.literal("video"),
  url: z.string(),
  mimeType: z.string(),
  title: z.string().optional(),
  fileName: z.string().optional(),
  fileId: z.string().optional(),
  metadata: z.record(z.unknown()).optional()
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
  metadata: z.record(z.unknown()).optional()
});

export const toolCallOutputSchema = z.object({
  type: z.literal("tool_call"),
  toolName: toolNameSchema,
  arguments: z.record(z.unknown()),
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
  status: z.enum(["queued", "in_progress", "completed", "failed"]),
  message: z.string(),
  progress: z.number().min(0).max(100).optional()
});

export const actionOutputSchema = z.object({
  type: z.literal("action"),
  id: z.string(),
  label: z.string(),
  action: z.string(),
  arguments: z.record(z.unknown()).optional(),
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

export const personaSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  tagline: z.string(),
  description: z.string(),
  avatarColor: z.string(),
  theme: personaThemeSchema,
  supportedProviders: z.array(providerSchema)
});
export type PersonaSummary = z.infer<typeof personaSummarySchema>;

export const personaDefinitionSchema = personaSummarySchema.extend({
  biography: z.string(),
  personalityTraits: z.array(z.string()),
  speechStyle: z.array(z.string()),
  catchphrases: z.array(z.string()),
  visualStyle: z.array(z.string()),
  safetyBoundaries: z.array(z.string()),
  voiceProfile: z.object({
    defaultVoiceId: z.string(),
    speakingStyle: z.string()
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
  metadata: z.record(z.unknown()).optional()
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
  metadata: z.record(z.unknown()).optional()
});
export type StyleTransferOutput = z.infer<typeof styleTransferOutputSchema>;

export const ttsInputSchema = z.object({
  text: z.string().min(1),
  persona: personaDefinitionSchema,
  voiceId: z.string().optional()
});
export type TTSInput = z.infer<typeof ttsInputSchema>;

export const ttsOutputSchema = z.object({
  provider: z.enum(["openai_tts", "local_tts"]),
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
    providerModel: z.string().optional()
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
