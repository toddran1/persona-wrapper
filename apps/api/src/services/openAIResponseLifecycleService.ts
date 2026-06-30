import OpenAI from "openai";
import { env } from "../config/env.js";
import { logger } from "../utils/logger.js";

export class OpenAIResponseLifecycleService {
  async cancel(responseId: string): Promise<void> {
    if (!env.OPENAI_API_KEY) return;

    const client = new OpenAI({
      apiKey: env.OPENAI_API_KEY,
      timeout: env.OPENAI_REQUEST_TIMEOUT_MS,
      maxRetries: 0
    });

    try {
      await client.responses.cancel(responseId);
    } catch (error) {
      logger.warn("OpenAI background response cancel failed", {
        responseId,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }
}

export const openAIResponseLifecycleService = new OpenAIResponseLifecycleService();
