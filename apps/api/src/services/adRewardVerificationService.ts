import { randomUUID } from "node:crypto";
import type {
  AdRewardSessionResponse,
  AdRewardSessionStatus,
  AdRewardSessionStatusResponse
} from "@persona/shared";
import { isPlanAdSupported } from "@persona/shared";
import { and, eq, gte, gt, sql } from "drizzle-orm";
import { env } from "../config/env.js";
import { getDatabase } from "../db/client.js";
import {
  adRewardEvents,
  adRewardSessions,
  customerUsageBalances
} from "../db/schema.js";
import { HttpError } from "../utils/httpError.js";
import { accessControlService } from "./accessControlService.js";
import type { VerifiedAdMobCallback } from "./adMobSsvVerifier.js";
import { adRewardPolicy } from "./adRewardPolicy.js";

const REWARD_SESSION_TTL_MS = 24 * 60 * 60 * 1000;

function utcDayStart(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

function currentCalendarPeriod(now: Date): { start: Date; end: Date } {
  return {
    start: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)),
    end: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1))
  };
}

function balanceId(userId: string, periodStart: Date): string {
  return `balance_${Buffer.from(`${userId}:credits:${periodStart.toISOString()}`).toString("base64url").slice(0, 96)}`;
}

function remainingToday(grantedToday: number): number {
  return Math.max(0, adRewardPolicy.maxRewardedAdsPerDay - grantedToday);
}

async function assertRewardAccess(userId: string) {
  const access = await accessControlService.getEffectiveAccess(userId);
  if (access.isAdmin || !isPlanAdSupported(access.plan.id)) {
    throw new HttpError("Rewarded ads are available on the Bronze plan only.", 403);
  }
  return access;
}

function assertRewardConfiguration(): void {
  if (
    env.NODE_ENV === "production"
    && !env.ADMOB_ANDROID_REWARDED_AD_UNIT_ID
    && !env.ADMOB_IOS_REWARDED_AD_UNIT_ID
  ) {
    throw new HttpError("Rewarded ads are not configured.", 503);
  }
}

export async function createAdRewardSession(
  userId: string,
  now = new Date()
): Promise<AdRewardSessionResponse> {
  assertRewardConfiguration();
  await assertRewardAccess(userId);
  const db = getDatabase();
  if (!db) throw new HttpError("Rewarded ads require persistent storage.", 503);

  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`ad-reward:${userId}`}, 0))`);
    const [grants] = await tx.select({ count: sql<number>`count(*)::int` })
      .from(adRewardEvents)
      .where(and(
        eq(adRewardEvents.userId, userId),
        eq(adRewardEvents.provider, "admob"),
        eq(adRewardEvents.status, "granted"),
        gte(adRewardEvents.grantedAt, utcDayStart(now))
      ));
    const grantedToday = Number(grants?.count ?? 0);
    if (grantedToday >= adRewardPolicy.maxRewardedAdsPerDay) {
      throw new HttpError("You have reached today’s rewarded-ad limit.", 409);
    }

    const [existing] = await tx.select({ id: adRewardSessions.id, expiresAt: adRewardSessions.expiresAt })
      .from(adRewardSessions)
      .where(and(
        eq(adRewardSessions.userId, userId),
        eq(adRewardSessions.status, "pending"),
        gt(adRewardSessions.expiresAt, now)
      ))
      .limit(1);
    const sessionId = existing?.id ?? `ad_reward_session_${randomUUID()}`;
    const expiresAt = existing?.expiresAt ?? new Date(now.getTime() + REWARD_SESSION_TTL_MS);
    if (!existing) await tx.insert(adRewardSessions).values({ id: sessionId, userId, expiresAt });

    return {
      sessionId,
      ssvUserId: userId,
      ssvCustomData: sessionId,
      expiresAt: expiresAt.toISOString(),
      remainingToday: remainingToday(grantedToday),
      rewardAmount: adRewardPolicy.mediaCreditsPerReward
    };
  });
}

export async function getAdRewardSessionStatus(
  userId: string,
  sessionId: string,
  now = new Date()
): Promise<AdRewardSessionStatusResponse> {
  const db = getDatabase();
  if (!db) throw new HttpError("Rewarded ads require persistent storage.", 503);
  const result = await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`ad-reward:${userId}`}, 0))`);
    const [session] = await tx.select().from(adRewardSessions).where(and(
      eq(adRewardSessions.id, sessionId),
      eq(adRewardSessions.userId, userId)
    )).limit(1);
    if (!session) throw new HttpError("Reward session not found.", 404);
    let status = session.status as AdRewardSessionStatus;
    if (status === "pending" && session.expiresAt <= now) {
      status = "expired";
      await tx.update(adRewardSessions).set({ status }).where(eq(adRewardSessions.id, session.id));
    }
    const [grants] = await tx.select({ count: sql<number>`count(*)::int` })
      .from(adRewardEvents)
      .where(and(
        eq(adRewardEvents.userId, userId),
        eq(adRewardEvents.provider, "admob"),
        eq(adRewardEvents.status, "granted"),
        gte(adRewardEvents.grantedAt, utcDayStart(now))
      ));
    return { status, grantedToday: Number(grants?.count ?? 0) };
  });
  return {
    sessionId,
    status: result.status,
    rewardAmount: adRewardPolicy.mediaCreditsPerReward,
    remainingToday: remainingToday(result.grantedToday)
  };
}

export type AdRewardGrantResult = "granted" | "duplicate" | "rejected";

export async function applyVerifiedAdMobReward(
  callback: VerifiedAdMobCallback,
  now = new Date()
): Promise<AdRewardGrantResult> {
  const db = getDatabase();
  if (!db) throw new HttpError("Rewarded ads require persistent storage.", 503);
  const access = await accessControlService.getEffectiveAccess(callback.userId);

  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`ad-reward:${callback.userId}`}, 0))`);
    const [session] = await tx.select().from(adRewardSessions).where(and(
      eq(adRewardSessions.id, callback.customData),
      eq(adRewardSessions.userId, callback.userId)
    )).limit(1);
    if (!session) return "rejected";

    const [event] = await tx.insert(adRewardEvents).values({
      id: `ad_reward_${randomUUID()}`,
      userId: callback.userId,
      provider: "admob",
      transactionId: callback.transactionId,
      rewardType: adRewardPolicy.rewardType,
      rewardAmount: adRewardPolicy.mediaCreditsPerReward,
      status: "verified_processing",
      verifiedAt: now,
      metadata: {
        adUnit: callback.adUnit,
        keyId: callback.keyId,
        providerRewardAmount: callback.rewardAmount,
        providerRewardItem: callback.rewardItem,
        providerTimestamp: callback.timestamp.toISOString(),
        rewardSessionId: session.id
      }
    }).onConflictDoNothing({
      target: [adRewardEvents.provider, adRewardEvents.transactionId]
    }).returning({ id: adRewardEvents.id });
    if (!event) return "duplicate";

    const reject = async (): Promise<AdRewardGrantResult> => {
      await tx.update(adRewardEvents).set({ status: "rejected" }).where(eq(adRewardEvents.id, event.id));
      if (session.status === "pending") {
        await tx.update(adRewardSessions).set({ status: "rejected", consumedAt: now })
          .where(eq(adRewardSessions.id, session.id));
      }
      return "rejected";
    };

    if (
      session.status !== "pending"
      || session.expiresAt <= now
      || access.isAdmin
      || !isPlanAdSupported(access.plan.id)
    ) return reject();

    const [grants] = await tx.select({ count: sql<number>`count(*)::int` })
      .from(adRewardEvents)
      .where(and(
        eq(adRewardEvents.userId, callback.userId),
        eq(adRewardEvents.provider, "admob"),
        eq(adRewardEvents.status, "granted"),
        gte(adRewardEvents.grantedAt, utcDayStart(now))
      ));
    if (Number(grants?.count ?? 0) >= adRewardPolicy.maxRewardedAdsPerDay) return reject();

    const period = currentCalendarPeriod(now);
    const baseLimit = access.plan.allowances.credits ?? 0;
    await tx.insert(customerUsageBalances).values({
      id: balanceId(callback.userId, period.start),
      userId: callback.userId,
      meterKey: "credits",
      periodStart: period.start,
      periodEnd: period.end,
      planId: access.plan.id,
      baseLimitQuantity: baseLimit,
      bonusQuantity: adRewardPolicy.mediaCreditsPerReward
    }).onConflictDoUpdate({
      target: [
        customerUsageBalances.userId,
        customerUsageBalances.meterKey,
        customerUsageBalances.periodStart
      ],
      set: {
        planId: access.plan.id,
        periodEnd: period.end,
        baseLimitQuantity: baseLimit,
        bonusQuantity: sql`${customerUsageBalances.bonusQuantity} + ${adRewardPolicy.mediaCreditsPerReward}`,
        updatedAt: now
      }
    });
    await tx.update(adRewardSessions).set({ status: "granted", consumedAt: now })
      .where(eq(adRewardSessions.id, session.id));
    await tx.update(adRewardEvents).set({ status: "granted", grantedAt: now })
      .where(eq(adRewardEvents.id, event.id));
    return "granted";
  });
}
