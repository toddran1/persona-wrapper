import { z } from "zod";
export const providerSchema = z.enum(["openai", "claude", "local"]);
export const outputTypeSchema = z.enum([
    "text",
    "json",
    "audio",
    "image",
    "chart",
    "file",
    "tool_call"
]);
export const toolNameSchema = z.enum([
    "web_search",
    "file_search",
    "data_analysis",
    "image_generation"
]);
export const chatMessageSchema = z.object({
    role: z.enum(["system", "user", "assistant", "tool"]),
    content: z.string(),
    name: z.string().optional()
});
export const toolDefinitionSchema = z.object({
    name: toolNameSchema,
    description: z.string(),
    inputSchema: z.record(z.unknown())
});
export const chartSeriesSchema = z.object({
    label: z.string(),
    value: z.number()
});
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
    prompt: z.string().optional()
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
    description: z.string().optional()
});
export const toolCallOutputSchema = z.object({
    type: z.literal("tool_call"),
    toolName: toolNameSchema,
    arguments: z.record(z.unknown()),
    status: z.enum(["planned", "completed", "failed"])
});
export const contentBlockSchema = z.discriminatedUnion("type", [
    textOutputSchema,
    jsonOutputSchema,
    audioOutputSchema,
    imageOutputSchema,
    chartOutputSchema,
    fileOutputSchema,
    toolCallOutputSchema
]);
export const chatRequestSchema = z.object({
    personaId: z.string().min(1),
    message: z.string().min(1),
    provider: providerSchema.default("local"),
    audio: z.boolean().default(false),
    conversationId: z.string().optional(),
    history: z.array(chatMessageSchema).default([]),
    requestedOutputs: z.array(outputTypeSchema).optional()
});
export const personaSummarySchema = z.object({
    id: z.string(),
    name: z.string(),
    legalName: z.string().optional(),
    age: z.string().optional(),
    height: z.string().optional(),
    weight: z.string().optional(),
    tagline: z.string(),
    description: z.string(),
    avatarColor: z.string(),
    avatarUrl: z.string().optional(),
    theme: personaThemeSchema,
    documentTitle: z.string().default("Persona Wrapper"),
    promptPlaceholder: z.string().default("Ask anything"),
    suggestedPrompts: z.array(z.string()).default([]),
    supportedProviders: z.array(providerSchema)
});
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
export const llmInputSchema = z.object({
    persona: personaDefinitionSchema,
    systemPrompt: z.string(),
    messages: z.array(chatMessageSchema),
    userMessage: z.string(),
    toolDefinitions: z.array(toolDefinitionSchema),
    requestedOutputs: z.array(outputTypeSchema).optional()
});
export const llmOutputSchema = z.object({
    provider: providerSchema,
    rawText: z.string(),
    content: z.array(contentBlockSchema),
    usage: z.object({
        inputTokens: z.number().int().nonnegative(),
        outputTokens: z.number().int().nonnegative()
    }).optional(),
    metadata: z.record(z.unknown()).optional()
});
export const ttsInputSchema = z.object({
    text: z.string().min(1),
    persona: personaDefinitionSchema,
    voiceId: z.string().optional()
});
export const ttsOutputSchema = z.object({
    provider: z.enum(["openai_tts", "elevenlabs_tts", "local_tts"]),
    url: z.string(),
    mimeType: z.string(),
    durationMs: z.number().int().nonnegative().optional()
});
export const chatResponseSchema = z.object({
    persona: personaSummarySchema,
    provider: providerSchema,
    conversationId: z.string(),
    outputs: z.array(contentBlockSchema),
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
            status: z.enum(["queued", "running", "completed", "failed"]),
            pollUrl: z.string()
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
        outputTokens: z.number().int().nonnegative()
    }).optional()
});
export const chatJobResponseSchema = z.object({
    id: z.string(),
    status: z.enum(["queued", "running", "completed", "failed"]),
    response: chatResponseSchema.optional(),
    error: z.string().optional(),
    updatedAt: z.string()
});
