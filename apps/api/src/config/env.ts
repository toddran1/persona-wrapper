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

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(4000),
  APP_TEST_MODE: z.preprocess(stringToBoolean, z.boolean().default(false)),
  OPENAI_API_KEY: z.string().optional(),
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
