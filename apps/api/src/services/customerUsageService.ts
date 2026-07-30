import { randomUUID } from "node:crypto";
import type {
  CustomerUsageMeter,
  PlanId,
  PlanUsageSummary
} from "@persona/shared";
import { and, eq, inArray, lt, sql } from "drizzle-orm";
import { env } from "../config/env.js";
import { getDatabase } from "../db/client.js";
import {
  customerUsageBalances,
  customerUsageEvents,
  users
} from "../db/schema.js";
import { HttpError } from "../utils/httpError.js";
import { accessControlService } from "./accessControlService.js";
import { personaIdsForPlan, planIncludesPersona, type PlanDefinition } from "./planCatalog.js";
import { listPersonas } from "../personas/index.js";

type MeterQuantities = Partial<Record<CustomerUsageMeter, number>>;
type LocalBalance = { used: number; reserved: number };
type LocalOperation = {
  userId: string;
  plan: PlanDefinition;
  idempotencyKey: string;
  reserved: MeterQuantities;
  periodStart: Date;
};

const DISPLAY_METERS: Array<{
  key: CustomerUsageMeter;
  label: string;
  unit: "credits" | "seconds";
}> = [
  { key: "credits", label: "Image credits", unit: "credits" },
  { key: "audio_seconds", label: "Audio", unit: "seconds" }
];

function currentCalendarPeriod(now = new Date()): { start: Date; end: Date } {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  return { start, end };
}

function positiveInteger(value: number | undefined): number {
  return value && Number.isFinite(value) && value > 0 ? Math.ceil(value) : 0;
}

function normalizeMeterQuantities(quantities: MeterQuantities): MeterQuantities {
  const normalized: MeterQuantities = {};
  for (const meter of Object.keys(quantities) as CustomerUsageMeter[]) {
    const quantity = positiveInteger(quantities[meter]);
    if (quantity > 0) normalized[meter] = quantity;
  }
  return normalized;
}

function balanceId(userId: string, meter: CustomerUsageMeter, periodStart: Date): string {
  return `balance_${Buffer.from(`${userId}:${meter}:${periodStart.toISOString()}`).toString("base64url").slice(0, 96)}`;
}

function quotaError(meter: CustomerUsageMeter): HttpError {
  return new HttpError(
    meter === "total_usage_microusd"
      ? "Your monthly total usage allowance has been reached. It resets at the start of your next billing period."
      : meter === "credits"
      ? "Your monthly credits have been used. Upgrade options are coming soon."
      : meter === "audio_seconds"
        ? "Your monthly audio allowance has been used. You can continue chatting without generated audio."
        : "This monthly allowance has been used. Upgrade options are coming soon.",
    429
  );
}

function concurrencyError(plan: PlanDefinition): HttpError {
  return new HttpError(
    `${plan.displayName} supports ${plan.maxConcurrentMediaJobs} media request${plan.maxConcurrentMediaJobs === 1 ? "" : "s"} at a time. Wait for the current request to finish and try again.`,
    429
  );
}

export class CustomerUsageService {
  private readonly localBalances = new Map<string, LocalBalance>();
  private readonly localOperations = new Map<string, LocalOperation>();
  private readonly localIdempotency = new Map<string, string>();

  async getPlan(userId: string): Promise<PlanDefinition> {
    return (await accessControlService.getEffectiveAccess(userId)).plan;
  }

  async getAccess(userId: string) {
    return accessControlService.getEffectiveAccess(userId);
  }

  async isAdmin(userId: string): Promise<boolean> {
    return (await accessControlService.getEffectiveAccess(userId)).isAdmin;
  }

  async assertPersonaAccess(userId: string, personaId: string): Promise<PlanDefinition> {
    const access = await accessControlService.getEffectiveAccess(userId);
    if (!access.isAdmin && !planIncludesPersona(access.plan, personaId)) {
      throw new HttpError(`${access.plan.displayName} does not include this persona.`, 403);
    }
    return access.plan;
  }

  async reserve(
    userId: string,
    quantities: MeterQuantities,
    options: { idempotencyKey: string; provider?: string; conversationId?: string }
  ): Promise<string> {
    const normalized = normalizeMeterQuantities(quantities);
    const idempotencyScope = `${userId}:${options.idempotencyKey}`;
    const existingLocal = this.localIdempotency.get(idempotencyScope);
    if (existingLocal) return existingLocal;
    const operationId = `customer_usage_${randomUUID()}`;
    if (Object.keys(normalized).length === 0) return operationId;

    const db = getDatabase();
    const access = await accessControlService.getEffectiveAccess(userId);
    const plan = access.plan;
    const enforceUsage = env.CUSTOMER_USAGE_ENFORCEMENT_ENABLED && !access.isAdmin;
    const period = currentCalendarPeriod();
    if (!db || !(await this.hasPersistedUser(userId))) {
      if (
        enforceUsage
        && positiveInteger(normalized.image_outputs) > 0
        && [...this.localOperations.values()].filter((operation) =>
          operation.userId === userId && positiveInteger(operation.reserved.image_outputs) > 0
        ).length >= plan.maxConcurrentMediaJobs
      ) {
        throw concurrencyError(plan);
      }
      const pendingBalances = new Map<string, LocalBalance>();
      for (const [meter, rawQuantity] of Object.entries(normalized) as Array<[CustomerUsageMeter, number]>) {
        const key = `${userId}:${meter}:${period.start.toISOString()}`;
        const balance = this.localBalances.get(key) ?? { used: 0, reserved: 0 };
        const limit = plan.allowances[meter] ?? null;
        if (enforceUsage && limit !== null && balance.used + balance.reserved + rawQuantity > limit) {
          throw quotaError(meter);
        }
        pendingBalances.set(key, {
          used: balance.used,
          reserved: balance.reserved + rawQuantity
        });
      }
      for (const [key, balance] of pendingBalances) {
        this.localBalances.set(key, balance);
      }
      this.localOperations.set(operationId, {
        userId,
        plan,
        idempotencyKey: options.idempotencyKey,
        reserved: normalized,
        periodStart: period.start
      });
      this.localIdempotency.set(idempotencyScope, operationId);
      return operationId;
    }

    return db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`customer-usage:${userId}`}, 0))`);
      const [existing] = await tx.select({ operationId: customerUsageEvents.operationId })
        .from(customerUsageEvents)
        .where(and(
          eq(customerUsageEvents.userId, userId),
          eq(customerUsageEvents.idempotencyKey, options.idempotencyKey)
        ))
        .limit(1);
      if (existing) return existing.operationId;

      if (enforceUsage && positiveInteger(normalized.image_outputs) > 0) {
        const [activeMedia] = await tx.select({
          count: sql<number>`count(distinct ${customerUsageEvents.operationId})::int`
        }).from(customerUsageEvents).where(and(
          eq(customerUsageEvents.userId, userId),
          eq(customerUsageEvents.meterKey, "image_outputs"),
          eq(customerUsageEvents.status, "reserved")
        ));
        if (Number(activeMedia?.count ?? 0) >= plan.maxConcurrentMediaJobs) {
          throw concurrencyError(plan);
        }
      }

      for (const [meter, quantity] of Object.entries(normalized) as Array<[CustomerUsageMeter, number]>) {
        const [balance] = await tx.select({
          used: customerUsageBalances.usedQuantity,
          reserved: customerUsageBalances.reservedQuantity
        }).from(customerUsageBalances).where(and(
          eq(customerUsageBalances.userId, userId),
          eq(customerUsageBalances.meterKey, meter),
          eq(customerUsageBalances.periodStart, period.start)
        )).limit(1);
        const limit = plan.allowances[meter] ?? null;
        if (
          enforceUsage
          && limit !== null
          && Number(balance?.used ?? 0) + Number(balance?.reserved ?? 0) + quantity > limit
        ) {
          throw quotaError(meter);
        }
        await tx.insert(customerUsageBalances).values({
          id: balanceId(userId, meter, period.start),
          userId,
          meterKey: meter,
          periodStart: period.start,
          periodEnd: period.end,
          reservedQuantity: quantity
        }).onConflictDoUpdate({
          target: [
            customerUsageBalances.userId,
            customerUsageBalances.meterKey,
            customerUsageBalances.periodStart
          ],
          set: {
            reservedQuantity: sql`${customerUsageBalances.reservedQuantity} + ${quantity}`,
            updatedAt: new Date()
          }
        });
        await tx.insert(customerUsageEvents).values({
          id: `customer_usage_event_${randomUUID()}`,
          operationId,
          idempotencyKey: options.idempotencyKey,
          userId,
          meterKey: meter,
          quantity,
          status: "reserved",
          planId: plan.id,
          planVersion: plan.version,
          ...(options.provider ? { provider: options.provider } : {}),
          ...(options.conversationId ? { conversationId: options.conversationId } : {}),
          periodStart: period.start,
          periodEnd: period.end
        });
      }
      return operationId;
    });
  }

  async settle(
    operationId: string,
    actual: MeterQuantities,
    options: {
      provider?: string;
      model?: string;
      conversationId?: string;
      estimatedCostUsd?: number;
      actualCostUsd?: number;
    } = {}
  ): Promise<void> {
    const normalizedActual = normalizeMeterQuantities(actual);
    const local = this.localOperations.get(operationId);
    if (local) {
      const meters = new Set([
        ...Object.keys(local.reserved),
        ...Object.keys(normalizedActual)
      ] as CustomerUsageMeter[]);
      for (const meter of meters) {
        const key = `${local.userId}:${meter}:${local.periodStart.toISOString()}`;
        const balance = this.localBalances.get(key) ?? { used: 0, reserved: 0 };
        balance.reserved = Math.max(0, balance.reserved - positiveInteger(local.reserved[meter]));
        balance.used += positiveInteger(normalizedActual[meter]);
        this.localBalances.set(key, balance);
      }
      this.localOperations.delete(operationId);
      return;
    }

    const db = getDatabase();
    if (!db) return;
    await db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`customer-usage-operation:${operationId}`}, 0))`);
      const reservations = await tx.select().from(customerUsageEvents).where(and(
        eq(customerUsageEvents.operationId, operationId),
        eq(customerUsageEvents.status, "reserved")
      ));
      if (reservations.length === 0) return;
      const userId = reservations[0]?.userId;
      if (!userId) return;
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`customer-usage:${userId}`}, 0))`);
      const fallbackPeriod = currentCalendarPeriod();
      const operationPeriod = {
        start: reservations[0]?.periodStart ?? fallbackPeriod.start,
        end: reservations[0]?.periodEnd ?? fallbackPeriod.end
      };
      const reservationByMeter = new Map(reservations.map((event) => [event.meterKey as CustomerUsageMeter, event]));
      const meters = new Set([
        ...reservationByMeter.keys(),
        ...Object.keys(normalizedActual) as CustomerUsageMeter[]
      ]);
      let costRecorded = false;
      for (const meter of meters) {
        const reservation = reservationByMeter.get(meter);
        const quantity = positiveInteger(normalizedActual[meter]);
        const period = reservation
          ? { start: reservation.periodStart, end: reservation.periodEnd }
          // Actual-only meters (for example a tool that was enabled while the
          // request was running) belong to the period in which the operation
          // was reserved. Otherwise a job crossing a month boundary can split
          // one request across two billing periods.
          : operationPeriod;
        const reservedQuantity = reservation?.quantity ?? 0;
        await tx.insert(customerUsageBalances).values({
          id: balanceId(userId, meter, period.start),
          userId,
          meterKey: meter,
          periodStart: period.start,
          periodEnd: period.end,
          usedQuantity: quantity
        }).onConflictDoUpdate({
          target: [
            customerUsageBalances.userId,
            customerUsageBalances.meterKey,
            customerUsageBalances.periodStart
          ],
          set: {
            usedQuantity: sql`${customerUsageBalances.usedQuantity} + ${quantity}`,
            reservedQuantity: sql`greatest(0, ${customerUsageBalances.reservedQuantity} - ${reservedQuantity})`,
            updatedAt: new Date()
          }
        });
        if (reservation) {
          await tx.update(customerUsageEvents).set({
            quantity,
            status: "settled",
            ...(options.provider ? { provider: options.provider } : {}),
            ...(options.model ? { model: options.model } : {}),
            ...(options.conversationId ? { conversationId: options.conversationId } : {}),
            estimatedCostMicroUsd: !costRecorded && options.estimatedCostUsd && options.estimatedCostUsd > 0
              ? Math.ceil(options.estimatedCostUsd * 1_000_000)
              : 0,
            actualCostMicroUsd: !costRecorded && options.actualCostUsd && options.actualCostUsd > 0
              ? Math.ceil(options.actualCostUsd * 1_000_000)
              : 0,
            settledAt: new Date()
          }).where(eq(customerUsageEvents.id, reservation.id));
          if (
            !costRecorded
            && (
              (options.estimatedCostUsd && options.estimatedCostUsd > 0)
              || (options.actualCostUsd && options.actualCostUsd > 0)
            )
          ) {
            costRecorded = true;
          }
        } else if (quantity > 0) {
          await tx.insert(customerUsageEvents).values({
            id: `customer_usage_event_${randomUUID()}`,
            operationId,
            idempotencyKey: `${operationId}:actual:${meter}`,
            userId,
            meterKey: meter,
            quantity,
            status: "settled",
            planId: reservations[0]?.planId ?? "bronze",
            planVersion: reservations[0]?.planVersion ?? 1,
            ...(options.provider ? { provider: options.provider } : {}),
            ...(options.model ? { model: options.model } : {}),
            ...(options.conversationId ? { conversationId: options.conversationId } : {}),
            periodStart: period.start,
            periodEnd: period.end,
            settledAt: new Date()
          }).onConflictDoNothing();
        }
      }
    });
  }

  async release(operationId: string): Promise<void> {
    const local = this.localOperations.get(operationId);
    if (local) {
      for (const [meter, quantity] of Object.entries(local.reserved) as Array<[CustomerUsageMeter, number]>) {
        const key = `${local.userId}:${meter}:${local.periodStart.toISOString()}`;
        const balance = this.localBalances.get(key);
        if (balance) balance.reserved = Math.max(0, balance.reserved - positiveInteger(quantity));
      }
      this.localOperations.delete(operationId);
      return;
    }
    const db = getDatabase();
    if (!db) return;
    await db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`customer-usage-operation:${operationId}`}, 0))`);
      const reservations = await tx.select().from(customerUsageEvents).where(and(
        eq(customerUsageEvents.operationId, operationId),
        eq(customerUsageEvents.status, "reserved")
      ));
      const userId = reservations[0]?.userId;
      if (!userId) return;
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`customer-usage:${userId}`}, 0))`);
      for (const reservation of reservations) {
        await tx.update(customerUsageBalances).set({
          reservedQuantity: sql`greatest(0, ${customerUsageBalances.reservedQuantity} - ${reservation.quantity})`,
          updatedAt: new Date()
        }).where(and(
          eq(customerUsageBalances.userId, reservation.userId),
          eq(customerUsageBalances.meterKey, reservation.meterKey),
          eq(customerUsageBalances.periodStart, reservation.periodStart)
        ));
        await tx.update(customerUsageEvents).set({
          status: "released",
          settledAt: new Date()
        }).where(eq(customerUsageEvents.id, reservation.id));
      }
    });
  }

  async cleanupExpiredNow(now = new Date()): Promise<void> {
    const db = getDatabase();
    if (!db) return;
    const reservationCutoff = new Date(now.getTime() - 6 * 60 * 60 * 1_000);
    const retentionCutoff = new Date(now.getTime() - 400 * 24 * 60 * 60 * 1_000);
    const staleReservations = await db.select({
      operationId: customerUsageEvents.operationId
    }).from(customerUsageEvents).where(and(
      eq(customerUsageEvents.status, "reserved"),
      lt(customerUsageEvents.createdAt, reservationCutoff)
    ));
    for (const operationId of new Set(staleReservations.map((event) => event.operationId))) {
      await this.release(operationId);
    }
    await db.delete(customerUsageEvents).where(and(
      inArray(customerUsageEvents.status, ["settled", "released"]),
      lt(customerUsageEvents.createdAt, retentionCutoff)
    ));
    await db.delete(customerUsageBalances).where(lt(customerUsageBalances.periodEnd, retentionCutoff));
  }

  async summary(userId: string): Promise<PlanUsageSummary> {
    const access = await accessControlService.getEffectiveAccess(userId);
    const plan = access.plan;
    const period = currentCalendarPeriod();
    const db = getDatabase();
    const persisted = db && await this.hasPersistedUser(userId)
      ? await db.select({
          meterKey: customerUsageBalances.meterKey,
          used: customerUsageBalances.usedQuantity,
          reserved: customerUsageBalances.reservedQuantity
        }).from(customerUsageBalances).where(and(
          eq(customerUsageBalances.userId, userId),
          eq(customerUsageBalances.periodStart, period.start)
        ))
      : [];
    const persistedByMeter = new Map(persisted.map((row) => [row.meterKey, row]));
    const totalUsageKey = "total_usage_microusd";
    const totalUsageLocal = this.localBalances.get(`${userId}:${totalUsageKey}:${period.start.toISOString()}`);
    const totalUsagePersisted = persistedByMeter.get(totalUsageKey);
    const totalUsageLimit = plan.allowances.total_usage_microusd
      ?? plan.monthlyProviderCostBudget.ceilingMicroUsd;
    const totalUsageUsed = Number(totalUsagePersisted?.used ?? totalUsageLocal?.used ?? 0);
    const totalUsageReserved = Number(totalUsagePersisted?.reserved ?? totalUsageLocal?.reserved ?? 0);
    const totalUsageRemaining = Math.max(0, totalUsageLimit - totalUsageUsed - totalUsageReserved);

    return {
      plan: {
        id: plan.id as PlanId,
        version: plan.version,
        displayName: plan.displayName,
        description: plan.description,
        monthlyPriceCents: plan.monthlyPriceCents,
        adsEnabled: plan.adsEnabled,
        priorityQueue: plan.priorityQueue,
        maxConcurrentMediaJobs: plan.maxConcurrentMediaJobs,
        personaIds: personaIdsForPlan(plan, listPersonas().map((persona) => persona.id))
      },
      totalUsage: {
        limitMicroUsd: totalUsageLimit,
        usedMicroUsd: totalUsageUsed,
        reservedMicroUsd: totalUsageReserved,
        remainingMicroUsd: totalUsageRemaining,
        percentRemaining: Math.max(0, Math.min(100, Math.floor((totalUsageRemaining / totalUsageLimit) * 100))),
        periodStart: period.start.toISOString(),
        periodEnd: period.end.toISOString()
      },
      meters: DISPLAY_METERS.map(({ key, label, unit }) => {
        const local = this.localBalances.get(`${userId}:${key}:${period.start.toISOString()}`);
        const row = persistedByMeter.get(key);
        const used = Number(row?.used ?? local?.used ?? 0);
        const reserved = Number(row?.reserved ?? local?.reserved ?? 0);
        const limit = plan.allowances[key] ?? null;
        return {
          key,
          label,
          unit,
          limit,
          used,
          reserved,
          remaining: limit === null ? null : Math.max(0, limit - used - reserved),
          periodStart: period.start.toISOString(),
          periodEnd: period.end.toISOString()
        };
      }),
      enforcementEnabled: env.CUSTOMER_USAGE_ENFORCEMENT_ENABLED && !access.isAdmin
    };
  }

  private async hasPersistedUser(userId: string): Promise<boolean> {
    const db = getDatabase();
    if (!db) return false;
    const [user] = await db.select({ id: users.id }).from(users).where(eq(users.id, userId)).limit(1);
    return Boolean(user);
  }
}

export const customerUsageService = new CustomerUsageService();
