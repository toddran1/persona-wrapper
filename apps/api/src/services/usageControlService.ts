import { randomUUID } from "node:crypto";
import { and, eq, gte, sql } from "drizzle-orm";
import { env } from "../config/env.js";
import { getDatabase } from "../db/client.js";
import { usageEvents } from "../db/schema.js";
import { HttpError } from "../utils/httpError.js";

type UsageRecord = { timestamps: number[]; day: string; spendUsd: number; tokens: number };

function todayUtcStart(): Date {
  return new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00.000Z`);
}

function costUsdToMicroUsd(costUsd?: number): number {
  if (!costUsd || costUsd <= 0) return 0;
  return Math.ceil(costUsd * 1_000_000);
}

export class UsageControlService {
  private readonly records = new Map<string, UsageRecord>();

  async check(identity: string): Promise<void> {
    const db = getDatabase();
    if (db) {
      const windowStart = new Date(Date.now() - env.CHAT_RATE_LIMIT_WINDOW_MS);
      const dayStart = todayUtcStart();
      const [requestRow] = await db.select({
        count: sql<number>`count(*)::int`
      }).from(usageEvents).where(and(
        eq(usageEvents.identity, identity),
        eq(usageEvents.eventType, "request"),
        gte(usageEvents.createdAt, windowStart)
      ));
      const requestCount = Number(requestRow?.count ?? 0);
      if (requestCount >= env.CHAT_RATE_LIMIT_REQUESTS) {
        throw new HttpError("Too many requests. Please wait and try again.", 429);
      }

      const [usageRow] = await db.select({
        tokens: sql<number>`coalesce(sum(${usageEvents.tokens}), 0)::int`,
        costMicroUsd: sql<number>`coalesce(sum(${usageEvents.costMicroUsd}), 0)::int`
      }).from(usageEvents).where(and(
        eq(usageEvents.identity, identity),
        eq(usageEvents.eventType, "usage"),
        gte(usageEvents.createdAt, dayStart)
      ));
      const tokens = Number(usageRow?.tokens ?? 0);
      const spendUsd = Number(usageRow?.costMicroUsd ?? 0) / 1_000_000;
      if (env.OPENAI_DAILY_SPEND_LIMIT_USD > 0 && spendUsd >= env.OPENAI_DAILY_SPEND_LIMIT_USD) {
        throw new HttpError("Daily OpenAI usage limit reached.", 429);
      }
      if (env.OPENAI_DAILY_TOKEN_LIMIT > 0 && tokens >= env.OPENAI_DAILY_TOKEN_LIMIT) {
        throw new HttpError("Daily OpenAI token limit reached.", 429);
      }

      await db.insert(usageEvents).values({
        id: `usage_${randomUUID()}`,
        identity,
        eventType: "request"
      });
      return;
    }

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

  async recordUsage(identity: string, tokens?: number, costUsd?: number): Promise<void> {
    const db = getDatabase();
    if (db) {
      const normalizedTokens = tokens && tokens > 0 ? tokens : 0;
      const costMicroUsd = costUsdToMicroUsd(costUsd);
      if (normalizedTokens <= 0 && costMicroUsd <= 0) return;
      await db.insert(usageEvents).values({
        id: `usage_${randomUUID()}`,
        identity,
        eventType: "usage",
        tokens: normalizedTokens,
        costMicroUsd
      });
      return;
    }

    const record = this.records.get(identity);
    if (!record) return;
    if (tokens && tokens > 0) record.tokens += tokens;
    if (costUsd && costUsd > 0) record.spendUsd += costUsd;
  }
}

export const usageControlService = new UsageControlService();
