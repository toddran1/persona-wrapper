import { env } from "../config/env.js";
import { HttpError } from "../utils/httpError.js";

type UsageRecord = { timestamps: number[]; day: string; spendUsd: number; tokens: number };

export class UsageControlService {
  private readonly records = new Map<string, UsageRecord>();

  check(identity: string): void {
    const now = Date.now();
    const day = new Date(now).toISOString().slice(0, 10);
    const record = this.records.get(identity) ?? { timestamps: [], day, spendUsd: 0, tokens: 0 };
    if (record.day !== day) {
      record.day = day;
      record.spendUsd = 0;
      record.tokens = 0;
    }
    record.timestamps = record.timestamps.filter((timestamp) => now - timestamp < env.CHAT_RATE_LIMIT_WINDOW_MS);
    if (record.timestamps.length >= env.CHAT_RATE_LIMIT_REQUESTS) {
      throw new HttpError("Too many requests. Please wait and try again.", 429);
    }
    if (env.OPENAI_DAILY_SPEND_LIMIT_USD > 0 && record.spendUsd >= env.OPENAI_DAILY_SPEND_LIMIT_USD) {
      throw new HttpError("Daily OpenAI usage limit reached.", 429);
    }
    if (env.OPENAI_DAILY_TOKEN_LIMIT > 0 && record.tokens >= env.OPENAI_DAILY_TOKEN_LIMIT) {
      throw new HttpError("Daily OpenAI token limit reached.", 429);
    }
    record.timestamps.push(now);
    this.records.set(identity, record);
  }

  recordUsage(identity: string, tokens?: number, costUsd?: number): void {
    const record = this.records.get(identity);
    if (!record) return;
    if (tokens && tokens > 0) record.tokens += tokens;
    if (costUsd && costUsd > 0) record.spendUsd += costUsd;
  }
}

export const usageControlService = new UsageControlService();
