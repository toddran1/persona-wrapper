import dotenv from "dotenv";
import { z } from "zod";

dotenv.config();

function emptyStringToUndefined(value: unknown): unknown {
  return value === "" ? undefined : value;
}

function stringToBoolean(value: unknown): unknown {
  if (typeof value !== "string") {
    return value;
  }

  return value.toLowerCase() === "true";
}

const reasoningEffortSchema = z.enum(["none", "minimal", "low", "medium", "high", "xhigh"]);
const reasoningSummarySchema = z.enum(["auto", "concise", "detailed"]);
const textVerbositySchema = z.enum(["low", "medium", "high"]);

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(4000),
  APP_TEST_MODE: z.preprocess(stringToBoolean, z.boolean().default(false)),
  OPENAI_API_KEY: z.string().optional(),
  OPENAI_RUN_INTEGRATION_TESTS: z.preprocess(stringToBoolean, z.boolean().default(false)),
  OPENAI_MODEL: z.string().default("gpt-5.4-mini"),
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
  OPENAI_MAX_TOOL_ITERATIONS: z.coerce.number().int().min(1).max(10).default(4),
  OPENAI_MAX_CONTEXT_MESSAGES: z.coerce.number().int().min(2).max(100).default(24),
  OPENAI_MAX_CONTEXT_CHARACTERS: z.coerce.number().int().min(1000).default(60000),
  OPENAI_TOOL_ROUTER_ENABLED: z.preprocess(stringToBoolean, z.boolean().default(true)),
  OPENAI_TOOL_ROUTER_MODEL: z.string().default("gpt-5.4-nano"),
  OPENAI_ENABLE_WEB_SEARCH: z.preprocess(stringToBoolean, z.boolean().default(true)),
  OPENAI_ENABLE_FILE_SEARCH: z.preprocess(stringToBoolean, z.boolean().default(true)),
  OPENAI_ENABLE_CODE_INTERPRETER: z.preprocess(stringToBoolean, z.boolean().default(true)),
  OPENAI_ENABLE_IMAGE_GENERATION: z.preprocess(stringToBoolean, z.boolean().default(true)),
  OPENAI_INPUT_COST_PER_MILLION: z.coerce.number().nonnegative().default(0),
  OPENAI_OUTPUT_COST_PER_MILLION: z.coerce.number().nonnegative().default(0),
  OPENAI_DAILY_SPEND_LIMIT_USD: z.coerce.number().nonnegative().default(5),
  OPENAI_DAILY_TOKEN_LIMIT: z.coerce.number().int().nonnegative().default(1000000),
  CHAT_RATE_LIMIT_REQUESTS: z.coerce.number().int().positive().default(30),
  CHAT_RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60000),
  UPLOAD_DIR: z.string().default("apps/api/uploads"),
  UPLOAD_MAX_BYTES: z.coerce.number().int().positive().default(25 * 1024 * 1024),
  UPLOAD_TTL_HOURS: z.coerce.number().int().positive().default(24),
  ANTHROPIC_API_KEY: z.string().optional(),
  LOCAL_LLM_ENDPOINT: z.preprocess(emptyStringToUndefined, z.string().url().optional()),
  LOCAL_LLM_MODEL: z.string().default("llama3.2:3b"),
  LOCAL_LLM_NUM_CTX: z.coerce.number().int().positive().default(8192),
  LOCAL_LLM_NUM_PREDICT: z.coerce.number().int().positive().default(1024),
  OPENAI_TTS_VOICE: z.string().default("alloy"),
  STYLE_TRANSFER_PROVIDER: z.enum(["stub", "local", "runpod", "huggingface"]).default("stub"),
  STYLE_TRANSFER_ENDPOINT: z.preprocess(emptyStringToUndefined, z.string().url().optional()),
  STYLE_TRANSFER_MODEL_ID: z.preprocess(emptyStringToUndefined, z.string().optional())
});

export const env = envSchema.parse(process.env);
