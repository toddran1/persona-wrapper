import { randomUUID } from "node:crypto";
import { and, asc, eq, gte, inArray, lt, notInArray, or, sql } from "drizzle-orm";
import { env } from "../config/env.js";
import { getDatabase } from "../db/client.js";
import { usageEvents } from "../db/schema.js";
import type { RequestAbuseSignals } from "../utils/requestAbuseSignals.js";
import { HttpError } from "../utils/httpError.js";

type LocalReservation = { tokens: number; spendUsd: number };
type UsageRecord = {
  timestamps: number[];
  day: string;
  spendUsd: number;
  tokens: number;
  reservations: Map<string, LocalReservation>;
};
const MAX_LOCAL_SIGNAL_KEYS = 10_000;

function todayUtcStart(): Date {
  return new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00.000Z`);
}

function costUsdToMicroUsd(costUsd?: number): number {
  if (!costUsd || costUsd <= 0) return 0;
  return Math.ceil(costUsd * 1_000_000);
}

export class UsageControlService {
  private readonly records = new Map<string, UsageRecord>();
  private readonly signalTimestamps = new Map<string, number[]>();

  async cleanupExpiredNow(): Promise<void> {
    const db = getDatabase();
    if (!db) return;
    const now = Date.now();
    const signupEventTypes = ["signup_device_attempt", "signup_ip_attempt"];
    await db.delete(usageEvents).where(or(
      and(
        inArray(usageEvents.eventType, signupEventTypes),
        lt(usageEvents.createdAt, new Date(now - env.AUTH_SIGNUP_WINDOW_MS))
      ),
      and(
        notInArray(usageEvents.eventType, signupEventTypes),
        lt(usageEvents.createdAt, new Date(now - 7 * 24 * 60 * 60 * 1000))
      ),
      and(
        eq(usageEvents.eventType, "reservation"),
        lt(usageEvents.createdAt, new Date(now - 6 * 60 * 60 * 1000))
      )
    ));
  }

  async check(identity: string, signals: RequestAbuseSignals = {}): Promise<string> {
    const db = getDatabase();
    if (db) {
      return db.transaction(async (tx) => {
        const rateLimits = [
          {
            identity,
            eventType: "request",
            limit: env.CHAT_RATE_LIMIT_REQUESTS
          },
          ...(signals.deviceKey ? [{
            identity: signals.deviceKey,
            eventType: "chat_device_request",
            limit: env.CHAT_DEVICE_RATE_LIMIT_REQUESTS
          }] : []),
          ...(signals.ipKey ? [{
            identity: signals.ipKey,
            eventType: "chat_ip_request",
            limit: env.CHAT_IP_RATE_LIMIT_REQUESTS
          }] : [])
        ];
        // Always take multiple advisory locks in the same order. That keeps
        // account, device, and IP decisions atomic without deadlocking when
        // concurrent requests share only some signals.
        for (const key of [...new Set(rateLimits.map((entry) => entry.identity))].sort()) {
          await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${key}, 0))`);
        }
        const windowStart = new Date(Date.now() - env.CHAT_RATE_LIMIT_WINDOW_MS);
        const dayStart = todayUtcStart();
        for (const rateLimit of rateLimits) {
          const [requestRow] = await tx.select({ count: sql<number>`count(*)::int` })
            .from(usageEvents).where(and(
              eq(usageEvents.identity, rateLimit.identity),
              eq(usageEvents.eventType, rateLimit.eventType),
              gte(usageEvents.createdAt, windowStart)
            ));
          if (Number(requestRow?.count ?? 0) >= rateLimit.limit) {
            throw new HttpError("Too many requests. Please wait and try again.", 429);
          }
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
          ...rateLimits.map((rateLimit) => ({
            id: `usage_${randomUUID()}`,
            identity: rateLimit.identity,
            eventType: rateLimit.eventType
          })),
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
    const record = this.records.get(identity) ?? { timestamps: [], day, spendUsd: 0, tokens: 0, reservations: new Map() };
    if (record.day !== day) {
      record.day = day;
      record.spendUsd = 0;
      record.tokens = 0;
      record.reservations.clear();
    }
    record.timestamps = record.timestamps.filter((timestamp) => now - timestamp < env.CHAT_RATE_LIMIT_WINDOW_MS);
    if (record.timestamps.length >= env.CHAT_RATE_LIMIT_REQUESTS) {
      throw new HttpError("Too many requests. Please wait and try again.", 429);
    }
    const signalLimits = [
      ...(signals.deviceKey ? [{
        key: `chat-device:${signals.deviceKey}`,
        limit: env.CHAT_DEVICE_RATE_LIMIT_REQUESTS
      }] : []),
      ...(signals.ipKey ? [{
        key: `chat-ip:${signals.ipKey}`,
        limit: env.CHAT_IP_RATE_LIMIT_REQUESTS
      }] : [])
    ];
    const pendingSignalTimestamps = new Map<string, number[]>();
    for (const signalLimit of signalLimits) {
      const timestamps = (this.signalTimestamps.get(signalLimit.key) ?? [])
        .filter((timestamp) => now - timestamp < env.CHAT_RATE_LIMIT_WINDOW_MS);
      if (timestamps.length >= signalLimit.limit) {
        throw new HttpError("Too many requests. Please wait and try again.", 429);
      }
      pendingSignalTimestamps.set(signalLimit.key, [...timestamps, now]);
    }
    const reservedTokens = env.OPENAI_MAX_CONTEXT_TOKENS + env.OPENAI_MAX_OUTPUT_TOKENS;
    const reservedSpendUsd = (
      env.OPENAI_MAX_CONTEXT_TOKENS * env.OPENAI_INPUT_COST_PER_MILLION
      + env.OPENAI_MAX_OUTPUT_TOKENS * env.OPENAI_OUTPUT_COST_PER_MILLION
    ) / 1_000_000;
    const pendingTokens = [...record.reservations.values()].reduce((sum, reservation) => sum + reservation.tokens, 0);
    const pendingSpendUsd = [...record.reservations.values()].reduce((sum, reservation) => sum + reservation.spendUsd, 0);
    if (env.OPENAI_DAILY_SPEND_LIMIT_USD > 0 && record.spendUsd + pendingSpendUsd + reservedSpendUsd > env.OPENAI_DAILY_SPEND_LIMIT_USD) {
      throw new HttpError("Daily OpenAI usage limit reached.", 429);
    }
    if (env.OPENAI_DAILY_TOKEN_LIMIT > 0 && record.tokens + pendingTokens + reservedTokens > env.OPENAI_DAILY_TOKEN_LIMIT) {
      throw new HttpError("Daily OpenAI token limit reached.", 429);
    }
    record.timestamps.push(now);
    for (const [key, timestamps] of pendingSignalTimestamps) {
      this.signalTimestamps.set(key, timestamps);
    }
    while (this.signalTimestamps.size > MAX_LOCAL_SIGNAL_KEYS) {
      const oldestKey = this.signalTimestamps.keys().next().value as string | undefined;
      if (!oldestKey) break;
      this.signalTimestamps.delete(oldestKey);
    }
    const reservationId = `local_${randomUUID()}`;
    record.reservations.set(reservationId, { tokens: reservedTokens, spendUsd: reservedSpendUsd });
    this.records.set(identity, record);
    return reservationId;
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
    if (reservationId) record.reservations.delete(reservationId);
    if (tokens && tokens > 0) record.tokens += tokens;
    if (costUsd && costUsd > 0) record.spendUsd += costUsd;
  }
}

export const usageControlService = new UsageControlService();
