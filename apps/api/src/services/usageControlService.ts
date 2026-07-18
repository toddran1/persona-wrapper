import { randomUUID } from "node:crypto";
import { and, asc, eq, gte, inArray, lt, or, sql } from "drizzle-orm";
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

  async cleanupExpiredNow(): Promise<void> {
    const db = getDatabase();
    if (!db) return;
    const now = Date.now();
    await db.delete(usageEvents).where(or(
      lt(usageEvents.createdAt, new Date(now - 7 * 24 * 60 * 60 * 1000)),
      and(
        eq(usageEvents.eventType, "reservation"),
        lt(usageEvents.createdAt, new Date(now - 6 * 60 * 60 * 1000))
      )
    ));
  }

  async check(identity: string): Promise<string> {
    const db = getDatabase();
    if (db) {
      return db.transaction(async (tx) => {
        // A transaction-scoped advisory lock serializes quota decisions for
        // this identity across every API instance.
        await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${identity}, 0))`);
        const windowStart = new Date(Date.now() - env.CHAT_RATE_LIMIT_WINDOW_MS);
        const dayStart = todayUtcStart();
        const [requestRow] = await tx.select({ count: sql<number>`count(*)::int` })
          .from(usageEvents).where(and(
            eq(usageEvents.identity, identity),
            eq(usageEvents.eventType, "request"),
            gte(usageEvents.createdAt, windowStart)
          ));
        if (Number(requestRow?.count ?? 0) >= env.CHAT_RATE_LIMIT_REQUESTS) {
          throw new HttpError("Too many requests. Please wait and try again.", 429);
        }

        const [usageRow] = await tx.select({
          tokens: sql<number>`coalesce(sum(${usageEvents.tokens}), 0)::int`,
          costMicroUsd: sql<number>`coalesce(sum(${usageEvents.costMicroUsd}), 0)::int`
        }).from(usageEvents).where(and(
          eq(usageEvents.identity, identity),
          inArray(usageEvents.eventType, ["usage", "reservation"]),
          gte(usageEvents.createdAt, dayStart)
        ));
        const reservedTokens = env.OPENAI_MAX_CONTEXT_TOKENS + env.OPENAI_MAX_OUTPUT_TOKENS;
        const reservedCostMicroUsd = costUsdToMicroUsd(
          (env.OPENAI_MAX_CONTEXT_TOKENS * env.OPENAI_INPUT_COST_PER_MILLION +
            env.OPENAI_MAX_OUTPUT_TOKENS * env.OPENAI_OUTPUT_COST_PER_MILLION) / 1_000_000
        );
        const tokensAfterReservation = Number(usageRow?.tokens ?? 0) + reservedTokens;
        const spendAfterReservation = (Number(usageRow?.costMicroUsd ?? 0) + reservedCostMicroUsd) / 1_000_000;
        if (env.OPENAI_DAILY_SPEND_LIMIT_USD > 0 && spendAfterReservation > env.OPENAI_DAILY_SPEND_LIMIT_USD) {
          throw new HttpError("Daily OpenAI usage limit reached.", 429);
        }
        if (env.OPENAI_DAILY_TOKEN_LIMIT > 0 && tokensAfterReservation > env.OPENAI_DAILY_TOKEN_LIMIT) {
          throw new HttpError("Daily OpenAI token limit reached.", 429);
        }

        const reservationId = `usage_${randomUUID()}`;
        await tx.insert(usageEvents).values([
          { id: `usage_${randomUUID()}`, identity, eventType: "request" },
          {
            id: reservationId,
            identity,
            eventType: "reservation",
            tokens: reservedTokens,
            costMicroUsd: reservedCostMicroUsd
          }
        ]);
        return reservationId;
      });
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
    return `local_${randomUUID()}`;
  }

  async recordUsage(identity: string, tokens?: number, costUsd?: number, reservationId?: string): Promise<void> {
    const db = getDatabase();
    if (db) {
      const normalizedTokens = tokens && tokens > 0 ? tokens : 0;
      const costMicroUsd = costUsdToMicroUsd(costUsd);
      await db.transaction(async (tx) => {
        await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${identity}, 0))`);
        const [reservation] = await tx.select({ id: usageEvents.id }).from(usageEvents)
          .where(and(
            eq(usageEvents.identity, identity),
            eq(usageEvents.eventType, "reservation"),
            ...(reservationId ? [eq(usageEvents.id, reservationId)] : [])
          ))
          .orderBy(asc(usageEvents.createdAt)).limit(1);
        if (reservation) await tx.delete(usageEvents).where(eq(usageEvents.id, reservation.id));
        if (normalizedTokens <= 0 && costMicroUsd <= 0) return;
        await tx.insert(usageEvents).values({
          id: `usage_${randomUUID()}`,
          identity,
          eventType: "usage",
          tokens: normalizedTokens,
          costMicroUsd
        });
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
