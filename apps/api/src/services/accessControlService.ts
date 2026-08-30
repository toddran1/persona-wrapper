import { randomUUID } from "node:crypto";
import type { PlanId } from "@persona/shared";
import { and, desc, eq, gt, isNull, lte, or, sql } from "drizzle-orm";
import { env } from "../config/env.js";
import { getDatabase } from "../db/client.js";
import { billingSubscriptions, userPlanAssignments, users } from "../db/schema.js";
import { HttpError } from "../utils/httpError.js";
import { getPlanDefinition, type PlanDefinition } from "./planCatalog.js";

export const planOverrideSources = [
  "promotion",
  "tester",
  "customer_support",
  "grandfathered"
] as const;

export type PlanOverrideSource = typeof planOverrideSources[number];

export type EffectiveAccess = {
  plan: PlanDefinition;
  isAdmin: boolean;
  assignment?: {
    id: string;
    source: string;
    effectiveAt: Date;
    expiresAt: Date | null;
    createdAt: Date;
  };
  usagePeriod?: { start: Date; end: Date };
};

const planRank: Record<PlanId, number> = {
  bronze: 0,
  silver: 1,
  gold: 2
};

const overrideSourceRank: Record<string, number> = {
  customer_support: 4,
  tester: 3,
  promotion: 2,
  grandfathered: 1,
  subscription: 0,
  system: 0
};

function normalizeEmail(email: string | null | undefined): string {
  return email?.trim().toLowerCase() ?? "";
}

const configuredAdminEmails = new Set(
  env.APP_ADMIN_EMAILS
    .split(",")
    .map(normalizeEmail)
    .filter(Boolean)
);

export function isConfiguredAdminEmail(email: string | null | undefined): boolean {
  const normalized = normalizeEmail(email);
  return normalized.length > 0 && configuredAdminEmails.has(normalized);
}

function planId(value: string): PlanId | undefined {
  if (value === "bronze" || value === "silver" || value === "gold") return value;
  return undefined;
}

function metadataPeriodStart(metadata: Record<string, unknown> | undefined): Date | null {
  const nestedEvent = metadata?.event;
  const raw = typeof metadata?.purchased_at_ms === "number"
    ? metadata.purchased_at_ms
    : nestedEvent && typeof nestedEvent === "object" && typeof (nestedEvent as Record<string, unknown>).purchased_at_ms === "number"
      ? (nestedEvent as Record<string, unknown>).purchased_at_ms as number
      : null;
  if (raw === null) return null;
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function subscriptionUsagePeriod(input: {
  startsAt: Date | null;
  endsAt: Date | null;
  metadata?: Record<string, unknown>;
  fallbackStart: Date;
}): { start: Date; end: Date } | undefined {
  const start = input.startsAt ?? metadataPeriodStart(input.metadata) ?? input.fallbackStart;
  return input.endsAt && start < input.endsAt ? { start, end: input.endsAt } : undefined;
}

type PlanAssignmentCandidate = {
  id: string;
  planId: string;
  planVersion: number;
  source: string;
  effectiveAt: Date;
  expiresAt: Date | null;
  createdAt: Date;
};

export function selectEffectivePlanAssignment(
  assignments: PlanAssignmentCandidate[]
): (PlanAssignmentCandidate & { planId: PlanId }) | undefined {
  return assignments
    .flatMap((assignment) => {
      const id = planId(assignment.planId);
      return id ? [{ ...assignment, planId: id }] : [];
    })
    .sort((left, right) =>
      planRank[right.planId] - planRank[left.planId]
      || (overrideSourceRank[right.source] ?? 0) - (overrideSourceRank[left.source] ?? 0)
      || right.effectiveAt.getTime() - left.effectiveAt.getTime()
    )[0];
}

function sourceIsValid(source: string): source is PlanOverrideSource {
  return planOverrideSources.some((candidate) => candidate === source);
}

export class AccessControlService {
  async getEffectiveAccess(userId: string): Promise<EffectiveAccess> {
    const db = getDatabase();
    if (!db) return { plan: getPlanDefinition(undefined), isAdmin: false };

    const [user] = await db.select({
      id: users.id,
      email: users.email,
      role: users.role
    }).from(users).where(eq(users.id, userId)).limit(1);
    if (!user) return { plan: getPlanDefinition(undefined), isAdmin: false };

    const isAdmin = user.role === "admin" || isConfiguredAdminEmail(user.email);
    if (isAdmin) {
      return { plan: getPlanDefinition("gold"), isAdmin: true };
    }

    const now = new Date();
    const assignments = await db.select({
      id: userPlanAssignments.id,
      planId: userPlanAssignments.planId,
      planVersion: userPlanAssignments.planVersion,
      source: userPlanAssignments.source,
      effectiveAt: userPlanAssignments.effectiveAt,
      expiresAt: userPlanAssignments.expiresAt,
      createdAt: userPlanAssignments.createdAt
    }).from(userPlanAssignments).where(and(
      eq(userPlanAssignments.userId, userId),
      eq(userPlanAssignments.status, "active"),
      lte(userPlanAssignments.effectiveAt, now),
      or(isNull(userPlanAssignments.expiresAt), gt(userPlanAssignments.expiresAt, now))
    )).orderBy(desc(userPlanAssignments.effectiveAt)).limit(50);

    const selected = selectEffectivePlanAssignment(assignments);

    if (!selected) return { plan: getPlanDefinition(undefined), isAdmin: false };
    const [subscription] = selected.source === "subscription"
      ? await db.select({
          startsAt: billingSubscriptions.currentPeriodStartsAt,
          endsAt: billingSubscriptions.currentPeriodEndsAt,
          metadata: billingSubscriptions.metadata
        }).from(billingSubscriptions).where(eq(billingSubscriptions.planAssignmentId, selected.id)).limit(1)
      : [];
    const usagePeriod = selected.source === "subscription"
      ? subscriptionUsagePeriod({
          startsAt: subscription?.startsAt ?? null,
          endsAt: subscription?.endsAt ?? selected.expiresAt,
          ...(subscription?.metadata ? { metadata: subscription.metadata } : {}),
          fallbackStart: selected.effectiveAt
        })
      : undefined;
    return {
      plan: getPlanDefinition(selected.planId, selected.planVersion),
      isAdmin: false,
      assignment: {
        id: selected.id,
        source: selected.source,
        effectiveAt: selected.effectiveAt,
        expiresAt: selected.expiresAt,
        createdAt: selected.createdAt
      },
      ...(usagePeriod ? { usagePeriod } : {})
    };
  }

  async grantPlanOverride(input: {
    userId: string;
    planId: PlanId;
    source: PlanOverrideSource;
    effectiveAt?: Date;
    expiresAt?: Date;
    reason: string;
    grantedByUserId?: string;
  }): Promise<string> {
    if (!sourceIsValid(input.source)) throw new HttpError("Invalid plan override source.", 400);
    const reason = input.reason.trim();
    if (!reason) throw new HttpError("A reason is required for a plan override.", 400);
    const effectiveAt = input.effectiveAt ?? new Date();
    if (input.expiresAt && input.expiresAt <= effectiveAt) {
      throw new HttpError("Plan override expiration must be after its effective date.", 400);
    }

    const db = getDatabase();
    if (!db) throw new HttpError("Plan overrides require database-backed storage.", 503);
    const [user] = await db.select({ id: users.id }).from(users).where(eq(users.id, input.userId)).limit(1);
    if (!user) throw new HttpError("User not found.", 404);

    const id = `plan_assignment_${randomUUID()}`;
    const plan = getPlanDefinition(input.planId);
    await db.insert(userPlanAssignments).values({
      id,
      userId: input.userId,
      planId: plan.id,
      planVersion: plan.version,
      source: input.source,
      effectiveAt,
      expiresAt: input.expiresAt,
      metadata: {
        reason,
        ...(input.grantedByUserId ? { grantedByUserId: input.grantedByUserId } : {})
      }
    });
    return id;
  }

  async revokePlanOverride(input: {
    assignmentId: string;
    revokedByUserId?: string;
    reason: string;
  }): Promise<void> {
    const reason = input.reason.trim();
    if (!reason) throw new HttpError("A reason is required to revoke a plan override.", 400);
    const db = getDatabase();
    if (!db) throw new HttpError("Plan overrides require database-backed storage.", 503);

    const [assignment] = await db.select({
      id: userPlanAssignments.id,
      source: userPlanAssignments.source,
      status: userPlanAssignments.status,
      metadata: userPlanAssignments.metadata
    }).from(userPlanAssignments).where(eq(userPlanAssignments.id, input.assignmentId)).limit(1);
    if (!assignment || assignment.status !== "active" || !sourceIsValid(assignment.source)) {
      throw new HttpError("Active plan override not found.", 404);
    }
    const metadata = assignment.metadata && typeof assignment.metadata === "object"
      ? assignment.metadata
      : {};

    await db.update(userPlanAssignments).set({
      status: "revoked",
      updatedAt: new Date(),
      metadata: {
        ...metadata,
        revokedReason: reason,
        revokedAt: new Date().toISOString(),
        ...(input.revokedByUserId ? { revokedByUserId: input.revokedByUserId } : {})
      }
    }).where(eq(userPlanAssignments.id, input.assignmentId));
  }

  /** Admin tooling: resolve a user by id/email/username and list their plan assignments. */
  async adminPlanOverrideLookup(identifier: string): Promise<{
    user: { id: string; email: string | null; username: string | null };
    effectivePlanId: string;
    effectivePlanDisplayName: string;
    isAdmin: boolean;
    assignments: Array<{
      id: string;
      planId: string;
      planVersion: number;
      source: string;
      status: string;
      effectiveAt: string;
      expiresAt: string | null;
      reason?: string;
    }>;
  }> {
    const db = getDatabase();
    if (!db) throw new HttpError("Plan overrides require database-backed storage.", 503);
    const raw = identifier.trim();
    if (!raw) throw new HttpError("A user id, email, or username is required.", 400);
    const normalized = raw.toLowerCase();
    const [user] = await db.select({
      id: users.id,
      email: users.email,
      username: users.username
    }).from(users).where(or(
      eq(users.id, raw),
      sql`lower(${users.email}) = ${normalized}`,
      eq(users.username, normalized)
    )).limit(1);
    if (!user) throw new HttpError("User not found.", 404);

    const access = await this.getEffectiveAccess(user.id);
    const rows = await db.select({
      id: userPlanAssignments.id,
      planId: userPlanAssignments.planId,
      planVersion: userPlanAssignments.planVersion,
      source: userPlanAssignments.source,
      status: userPlanAssignments.status,
      effectiveAt: userPlanAssignments.effectiveAt,
      expiresAt: userPlanAssignments.expiresAt,
      metadata: userPlanAssignments.metadata
    }).from(userPlanAssignments)
      .where(eq(userPlanAssignments.userId, user.id))
      .orderBy(desc(userPlanAssignments.effectiveAt))
      .limit(100);

    return {
      user: { id: user.id, email: user.email ?? null, username: user.username ?? null },
      effectivePlanId: access.plan.id,
      effectivePlanDisplayName: access.plan.displayName,
      isAdmin: access.isAdmin,
      assignments: rows.map((row) => ({
        id: row.id,
        planId: row.planId,
        planVersion: row.planVersion,
        source: row.source,
        status: row.status,
        effectiveAt: row.effectiveAt.toISOString(),
        expiresAt: row.expiresAt ? row.expiresAt.toISOString() : null,
        ...(typeof row.metadata?.reason === "string" ? { reason: row.metadata.reason } : {})
      }))
    };
  }
}

export const accessControlService = new AccessControlService();
