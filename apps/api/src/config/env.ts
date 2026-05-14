import dotenv from "dotenv";
import { z } from "zod";

dotenv.config();

function emptyStringToUndefined(value: unknown): unknown {
  return value === "" ? undefined : value;
}

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(4000),
  OPENAI_API_KEY: z.string().optional(),
  ANTHROPIC_API_KEY: z.string().optional(),
  LOCAL_LLM_ENDPOINT: z.preprocess(emptyStringToUndefined, z.string().url().optional()),
  LOCAL_LLM_MODEL: z.string().default("llama3.2:3b"),
  OPENAI_TTS_VOICE: z.string().default("alloy"),
  STYLE_TRANSFER_PROVIDER: z.enum(["stub", "local", "runpod", "huggingface"]).default("stub"),
  STYLE_TRANSFER_ENDPOINT: z.preprocess(emptyStringToUndefined, z.string().url().optional()),
  STYLE_TRANSFER_MODEL_ID: z.preprocess(emptyStringToUndefined, z.string().optional())
});

export const env = envSchema.parse(process.env);
