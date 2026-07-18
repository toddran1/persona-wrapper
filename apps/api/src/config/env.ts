import dotenv from "dotenv";
import { z } from "zod";

dotenv.config();
dotenv.config({ path: "apps/api/.env" });

function emptyStringToUndefined(value: unknown): unknown {
  return value === "" ? undefined : value;
}

function stringToBoolean(value: unknown): unknown {
  if (typeof value !== "string") {
    return value;
  }

  return value.toLowerCase() === "true";
}

function optionalTrimmedString(value: unknown): unknown {
  if (value === "") return undefined;
  if (typeof value === "string") return value.trim() || undefined;
  return value;
}

const reasoningEffortSchema = z.enum(["none", "minimal", "low", "medium", "high", "xhigh"]);
const reasoningSummarySchema = z.enum(["auto", "concise", "detailed"]);
const textVerbositySchema = z.enum(["low", "medium", "high"]);
const ttsProviderSchema = z.enum(["openai", "elevenlabs", "local"]);
const openAIImageModerationSchema = z.enum(["auto", "low"]);
const openAIImageQualitySchema = z.enum(["auto", "low", "medium", "high"]);
const openAIImageSizeSchema = z.enum(["auto", "1024x1024", "1536x1024", "1024x1536"]);

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(4000),
  API_REQUEST_TIMEOUT_MS: z.coerce.number().int().positive().default(120000),
  API_HEADERS_TIMEOUT_MS: z.coerce.number().int().positive().default(60000),
  API_KEEP_ALIVE_TIMEOUT_MS: z.coerce.number().int().positive().default(5000),
  API_SHUTDOWN_TIMEOUT_MS: z.coerce.number().int().positive().default(10000),
  API_TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(5).default(0),
  APP_TEST_MODE: z.preprocess(stringToBoolean, z.boolean().default(false)),
  CORS_ALLOWED_ORIGINS: z.preprocess(emptyStringToUndefined, z.string().optional()),
  OBSERVABILITY_DASHBOARD_TOKEN: z.preprocess(optionalTrimmedString, z.string().min(24).optional()),
  OTEL_EXPORTER_OTLP_ENDPOINT: z.preprocess(optionalTrimmedString, z.string().url().optional()),
  OTEL_EXPORTER_OTLP_HEADERS: z.preprocess(optionalTrimmedString, z.string().min(1).optional()),
  OTEL_SERVICE_NAME: z.preprocess(optionalTrimmedString, z.string().min(1).default("for-the-baddiez-api")),
  OPENAI_API_KEY: z.string().optional(),
  OPENAI_RUN_INTEGRATION_TESTS: z.preprocess(stringToBoolean, z.boolean().default(false)),
  OPENAI_MODEL: z.string().default("gpt-5.6-luna"),
  OPENAI_REQUEST_TIMEOUT_MS: z.coerce.number().int().positive().default(120000),
  OPENAI_MAX_OUTPUT_TOKENS: z.coerce.number().int().positive().default(8192),
  OPENAI_TEMPERATURE: z.preprocess(emptyStringToUndefined, z.coerce.number().min(0).max(2).optional()),
  OPENAI_TOP_P: z.preprocess(emptyStringToUndefined, z.coerce.number().min(0).max(1).optional()),
  OPENAI_PRESENCE_PENALTY: z.preprocess(emptyStringToUndefined, z.coerce.number().min(-2).max(2).optional()),
  OPENAI_FREQUENCY_PENALTY: z.preprocess(emptyStringToUndefined, z.coerce.number().min(-2).max(2).optional()),
  OPENAI_REASONING_EFFORT: z.preprocess(emptyStringToUndefined, reasoningEffortSchema.optional()),
  OPENAI_REASONING_SUMMARY: z.preprocess(emptyStringToUndefined, reasoningSummarySchema.optional()),
  OPENAI_TEXT_VERBOSITY: z.preprocess(emptyStringToUndefined, textVerbositySchema.optional()),
  OPENAI_PERSONA_TEMPERATURE: z.preprocess(emptyStringToUndefined, z.coerce.number().min(0).max(2).optional()),
  OPENAI_PERSONA_TOP_P: z.preprocess(emptyStringToUndefined, z.coerce.number().min(0).max(1).optional()),
  OPENAI_PERSONA_PRESENCE_PENALTY: z.preprocess(emptyStringToUndefined, z.coerce.number().min(-2).max(2).optional()),
  OPENAI_PERSONA_FREQUENCY_PENALTY: z.preprocess(emptyStringToUndefined, z.coerce.number().min(-2).max(2).optional()),
  OPENAI_PERSONA_REASONING_EFFORT: z.preprocess(emptyStringToUndefined, reasoningEffortSchema.default("medium")),
  OPENAI_PERSONA_REASONING_SUMMARY: z.preprocess(emptyStringToUndefined, reasoningSummarySchema.optional()),
  OPENAI_PERSONA_TEXT_VERBOSITY: z.preprocess(emptyStringToUndefined, textVerbositySchema.default("high")),
  OPENAI_MAX_RETRIES: z.coerce.number().int().min(0).max(6).default(3),
  OPENAI_IMAGE_REQUEST_TIMEOUT_MS: z.coerce.number().int().positive().default(900000),
  OPENAI_BACKGROUND_POLL_TIMEOUT_MS: z.coerce.number().int().positive().default(900000),
  OPENAI_BACKGROUND_POLL_INTERVAL_MS: z.coerce.number().int().positive().default(1500),
  OPENAI_MAX_TOOL_ITERATIONS: z.coerce.number().int().min(1).max(10).default(4),
  OPENAI_MAX_CONTEXT_MESSAGES: z.coerce.number().int().min(2).max(100).default(16),
  OPENAI_MAX_CONTEXT_CHARACTERS: z.coerce.number().int().min(1000).default(35000),
  OPENAI_MAX_CONTEXT_TOKENS: z.coerce.number().int().min(500).default(8000),
  CONVERSATION_MEMORY_SUMMARY_ENABLED: z.preprocess(stringToBoolean, z.boolean().default(true)),
  CONVERSATION_MEMORY_SUMMARY_AFTER_MESSAGES: z.coerce.number().int().min(4).max(200).default(16),
  CONVERSATION_MEMORY_SUMMARY_MAX_CHARACTERS: z.coerce.number().int().min(500).max(20000).default(2500),
  CONVERSATION_MEMORY_SUMMARY_MAX_TOKENS: z.coerce.number().int().min(100).max(5000).default(800),
  OPENAI_STYLE_REFERENCE_SYNTHETIC_LIMIT: z.coerce.number().int().min(0).max(100).default(20),
  OPENAI_STYLE_REFERENCE_GOLDEN_LIMIT: z.coerce.number().int().min(0).max(100).default(5),
  OPENAI_STYLE_REFERENCE_MAX_TOKENS: z.coerce.number().int().min(500).max(30000).default(9000),
  OPENAI_TOOL_ROUTER_ENABLED: z.preprocess(stringToBoolean, z.boolean().default(true)),
  OPENAI_TOOL_ROUTER_MODEL: z.string().default("gpt-5.4-nano"),
  OPENAI_ENABLE_WEB_SEARCH: z.preprocess(stringToBoolean, z.boolean().default(true)),
  OPENAI_ENABLE_FILE_SEARCH: z.preprocess(stringToBoolean, z.boolean().default(true)),
  OPENAI_ENABLE_CODE_INTERPRETER: z.preprocess(stringToBoolean, z.boolean().default(true)),
  OPENAI_ENABLE_IMAGE_GENERATION: z.preprocess(stringToBoolean, z.boolean().default(true)),
  OPENAI_DIRECT_IMAGE_API_ENABLED: z.preprocess(stringToBoolean, z.boolean().default(true)),
  OPENAI_IMAGE_MODEL: z.string().default("gpt-image-1"),
  OPENAI_IMAGE_MODERATION: z.preprocess(emptyStringToUndefined, openAIImageModerationSchema.default("low")),
  OPENAI_IMAGE_SIZE: z.preprocess(emptyStringToUndefined, openAIImageSizeSchema.default("auto")),
  OPENAI_IMAGE_QUALITY: z.preprocess(emptyStringToUndefined, openAIImageQualitySchema.default("auto")),
  OPENAI_TTS_SCRIPT_ENABLED: z.preprocess(stringToBoolean, z.boolean().default(false)),
  OPENAI_INPUT_COST_PER_MILLION: z.coerce.number().nonnegative().default(0),
  OPENAI_OUTPUT_COST_PER_MILLION: z.coerce.number().nonnegative().default(0),
  OPENAI_DAILY_SPEND_LIMIT_USD: z.coerce.number().nonnegative().default(5),
  OPENAI_DAILY_TOKEN_LIMIT: z.coerce.number().int().nonnegative().default(1000000),
  CHAT_RATE_LIMIT_REQUESTS: z.coerce.number().int().positive().default(30),
  CHAT_RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60000),
  AUTH_RATE_LIMIT_REQUESTS: z.coerce.number().int().positive().default(20),
  AUTH_RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(15 * 60 * 1000),
  API_JSON_MAX_BYTES: z.coerce.number().int().min(64 * 1024).max(2 * 1024 * 1024).default(1024 * 1024),
  DATA_TRANSFER_MAX_BYTES: z.coerce.number().int().min(1024 * 1024).max(25 * 1024 * 1024).default(25 * 1024 * 1024),
  DATABASE_URL: z.preprocess(emptyStringToUndefined, z.string().url().optional()),
  AUTH_REQUIRED: z.preprocess(stringToBoolean, z.boolean().default(false)),
  AUTH_REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(30),
  AUTH_PASSWORD_MIN_LENGTH: z.coerce.number().int().min(8).max(128).default(10),
  BETTER_AUTH_SECRET: z.preprocess(optionalTrimmedString, z.string().min(32).optional()),
  AUTH_ACCOUNT_DELETION_GRACE_DAYS: z.coerce.number().int().min(1).max(90).default(30),
  AUTH_REQUIRE_OWNED_MEDIA_ACCESS: z.preprocess(stringToBoolean, z.boolean().default(false)),
  WEB_APP_URL: z.preprocess(optionalTrimmedString, z.string().url().default("http://localhost:5173")),
  BETTER_AUTH_URL: z.preprocess(optionalTrimmedString, z.string().url().optional()),
  GOOGLE_OAUTH_CLIENT_ID: z.preprocess(optionalTrimmedString, z.string().optional()),
  GOOGLE_OAUTH_CLIENT_SECRET: z.preprocess(optionalTrimmedString, z.string().optional()),
  FACEBOOK_OAUTH_CLIENT_ID: z.preprocess(optionalTrimmedString, z.string().optional()),
  FACEBOOK_OAUTH_CLIENT_SECRET: z.preprocess(optionalTrimmedString, z.string().optional()),
  STORAGE_DRIVER: z.enum(["local", "s3"]).default("local"),
  STORAGE_LOCAL_ROOT: z.preprocess(emptyStringToUndefined, z.string().optional()),
  STORAGE_S3_BUCKET: z.preprocess(optionalTrimmedString, z.string().optional()),
  STORAGE_S3_REGION: z.preprocess(optionalTrimmedString, z.string().optional()),
  STORAGE_S3_PREFIX: z.preprocess(optionalTrimmedString, z.string().optional()),
  STORAGE_S3_ENDPOINT: z.preprocess(optionalTrimmedString, z.string().url().optional()),
  STORAGE_S3_FORCE_PATH_STYLE: z.preprocess(stringToBoolean, z.boolean().default(false)),
  UPLOAD_DIR: z.string().default("apps/api/uploads"),
  GENERATED_MEDIA_DIR: z.preprocess(emptyStringToUndefined, z.string().optional()),
  GENERATED_MEDIA_TTL_HOURS: z.coerce.number().int().nonnegative().default(0),
  OPENAI_ARTIFACT_TTL_HOURS: z.coerce.number().int().nonnegative().default(0),
  GENERATED_AUDIO_DIR: z.preprocess(emptyStringToUndefined, z.string().optional()),
  GENERATED_AUDIO_TTL_HOURS: z.coerce.number().int().nonnegative().default(236),
  UPLOAD_MAX_BYTES: z.coerce.number().int().positive().default(25 * 1024 * 1024),
  UPLOAD_TTL_HOURS: z.coerce.number().int().nonnegative().default(24),
  STORAGE_CLEANUP_INTERVAL_MS: z.coerce.number().int().nonnegative().default(15 * 60 * 1000),
  STORAGE_CLEANUP_CRON: z.string().min(1).default("*/15 * * * *"),
  ANTHROPIC_API_KEY: z.string().optional(),
  LOCAL_LLM_ENDPOINT: z.preprocess(emptyStringToUndefined, z.string().url().optional()),
  LOCAL_LLM_MODEL: z.string().default("llama3.2:3b"),
  LOCAL_LLM_NUM_CTX: z.coerce.number().int().positive().default(8192),
  LOCAL_LLM_NUM_PREDICT: z.coerce.number().int().positive().default(1024),
  TTS_PROVIDER: z.preprocess(emptyStringToUndefined, ttsProviderSchema.default("openai")),
  OPENAI_TTS_VOICE: z.string().default("alloy"),
  ELEVENLABS_API_KEY: z.preprocess(emptyStringToUndefined, z.string().optional()),
  ELEVENLABS_VOICE_ID: z.preprocess(emptyStringToUndefined, z.string().optional()),
  ELEVENLABS_VOICE_ID_LARAE: z.preprocess(emptyStringToUndefined, z.string().optional()),
  ELEVENLABS_MODEL_ID: z.string().default("eleven_flash_v2_5"),
  ELEVENLABS_OUTPUT_FORMAT: z.string().default("mp3_44100_128"),
  ELEVENLABS_SPEED: z.coerce.number().min(0.7).max(1.2).default(1.06),
  ELEVENLABS_STABILITY: z.coerce.number().min(0).max(1).default(0.3),
  ELEVENLABS_SIMILARITY_BOOST: z.coerce.number().min(0).max(1).default(0.6),
  ELEVENLABS_STYLE: z.coerce.number().min(0).max(1).default(0.1),
  ELEVENLABS_USE_SPEAKER_BOOST: z.preprocess(stringToBoolean, z.boolean().default(true)),
  ELEVENLABS_MAX_RETRIES: z.coerce.number().int().min(0).max(5).default(2),
  ELEVENLABS_RETRY_BASE_MS: z.coerce.number().int().positive().default(400),
  STYLE_TRANSFER_PROVIDER: z.enum(["stub", "local", "runpod", "huggingface"]).default("stub"),
  STYLE_TRANSFER_ENDPOINT: z.preprocess(emptyStringToUndefined, z.string().url().optional()),
  STYLE_TRANSFER_MODEL_ID: z.preprocess(emptyStringToUndefined, z.string().optional())
}).superRefine((value, context) => {
  if (value.NODE_ENV === "production" && !value.AUTH_REQUIRED) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["AUTH_REQUIRED"],
      message: "AUTH_REQUIRED must be true in production."
    });
  }
  if (value.NODE_ENV === "production" && !value.AUTH_REQUIRE_OWNED_MEDIA_ACCESS) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["AUTH_REQUIRE_OWNED_MEDIA_ACCESS"],
      message: "AUTH_REQUIRE_OWNED_MEDIA_ACCESS must be true in production."
    });
  }
  if (value.NODE_ENV === "production" && !value.CORS_ALLOWED_ORIGINS) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["CORS_ALLOWED_ORIGINS"],
      message: "CORS_ALLOWED_ORIGINS is required in production."
    });
  }
  if (value.NODE_ENV === "production" && value.APP_TEST_MODE) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["APP_TEST_MODE"],
      message: "APP_TEST_MODE must be disabled in production."
    });
  }
  if (Boolean(value.OTEL_EXPORTER_OTLP_ENDPOINT) !== Boolean(value.OTEL_EXPORTER_OTLP_HEADERS)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["OTEL_EXPORTER_OTLP_ENDPOINT"],
      message: "OTEL_EXPORTER_OTLP_ENDPOINT and OTEL_EXPORTER_OTLP_HEADERS must be configured together."
    });
  }
  if (value.CORS_ALLOWED_ORIGINS) {
    for (const origin of value.CORS_ALLOWED_ORIGINS.split(",").map((item) => item.trim()).filter(Boolean)) {
      try {
        const parsed = new URL(origin);
        if (parsed.origin !== origin || (value.NODE_ENV === "production" && parsed.protocol !== "https:")) {
          throw new Error("invalid origin");
        }
      } catch {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["CORS_ALLOWED_ORIGINS"],
          message: `Invalid allowed origin: ${origin}`
        });
      }
    }
  }
  if (value.NODE_ENV === "production" && new URL(value.WEB_APP_URL).protocol !== "https:") {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["WEB_APP_URL"],
      message: "WEB_APP_URL must use HTTPS in production."
    });
  }
  if (value.NODE_ENV === "production" && value.BETTER_AUTH_URL && new URL(value.BETTER_AUTH_URL).protocol !== "https:") {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["BETTER_AUTH_URL"],
      message: "BETTER_AUTH_URL must use HTTPS in production."
    });
  }
  if (value.AUTH_REQUIRED && !value.DATABASE_URL) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["DATABASE_URL"],
      message: "DATABASE_URL is required when AUTH_REQUIRED=true."
    });
  }
  if (value.NODE_ENV === "production" && !value.BETTER_AUTH_SECRET) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["BETTER_AUTH_SECRET"],
      message: "BETTER_AUTH_SECRET is required in production and must be at least 32 characters."
    });
  }
  if (Boolean(value.GOOGLE_OAUTH_CLIENT_ID) !== Boolean(value.GOOGLE_OAUTH_CLIENT_SECRET)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["GOOGLE_OAUTH_CLIENT_ID"],
      message: "GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET must be configured together."
    });
  }
  if (Boolean(value.FACEBOOK_OAUTH_CLIENT_ID) !== Boolean(value.FACEBOOK_OAUTH_CLIENT_SECRET)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["FACEBOOK_OAUTH_CLIENT_ID"],
      message: "FACEBOOK_OAUTH_CLIENT_ID and FACEBOOK_OAUTH_CLIENT_SECRET must be configured together."
    });
  }
  if (value.STORAGE_DRIVER === "s3") {
    if (value.NODE_ENV !== "production") {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["STORAGE_DRIVER"],
        message: "STORAGE_DRIVER=s3 is only supported when NODE_ENV=production."
      });
    }
    if (!value.STORAGE_S3_BUCKET) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["STORAGE_S3_BUCKET"],
        message: "STORAGE_S3_BUCKET is required when STORAGE_DRIVER=s3."
      });
    }
    if (!value.STORAGE_S3_REGION) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["STORAGE_S3_REGION"],
        message: "STORAGE_S3_REGION is required when STORAGE_DRIVER=s3."
      });
    }
  }
});

export const env = envSchema.parse(process.env);
