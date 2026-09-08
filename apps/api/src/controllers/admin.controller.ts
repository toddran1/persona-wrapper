import type { Request, Response } from "express";
import { randomUUID } from "node:crypto";
import { adminGrantPlanOverrideSchema, adminResolveSafetyReportSchema, adminRevokePlanOverrideSchema, adminUpdateAccountStatusSchema } from "@persona/shared";
import { and, desc, eq, gte, sql } from "drizzle-orm";
import { getDatabase } from "../db/client.js";
import { adImpressionRevenueEvents, adRewardEvents, adRewardSessions, adminAuditEvents, backgroundJobs, betterAuthSessions, billingSubscriptions, customerUsageEvents, operationalEvents, responseFeedback, unsafeOutputReports, users } from "../db/schema.js";
import { accessControlService } from "../services/accessControlService.js";
import { HttpError } from "../utils/httpError.js";

// Admin-only plan override management (promotions, testers, support grants,
// grandfathered access). Admin status comes from the session: users.role or
// APP_ADMIN_EMAILS, resolved by the auth middleware.
function requireAdmin(request: Request): void {
  if (!request.auth) throw new HttpError("Not authenticated.", 401);
  if (!request.auth.isAdmin) throw new HttpError("Admin access required.", 403);
}

async function recordAdminAudit(input: {
  actorUserId: string;
  action: string;
  targetType: string;
  targetId?: string;
  reason?: string;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  const database = getDatabase();
  if (!database) return;
  await database.insert(adminAuditEvents).values({ id: `audit_${randomUUID()}`, ...input });
}

export async function listPlanOverrides(request: Request, response: Response): Promise<void> {
  requireAdmin(request);
  const identifier = typeof request.query.user === "string" ? request.query.user : "";
  response.status(200).json(await accessControlService.adminPlanOverrideLookup(identifier));
}

export async function grantPlanOverride(request: Request, response: Response): Promise<void> {
  requireAdmin(request);
  const payload = adminGrantPlanOverrideSchema.parse(request.body);
  let expiresAt: Date | undefined;
  if (payload.expiresAt !== undefined) {
    const parsed = new Date(payload.expiresAt);
    if (Number.isNaN(parsed.getTime())) throw new HttpError("Invalid expiration date.", 400);
    expiresAt = parsed;
  }
  const lookup = await accessControlService.adminPlanOverrideLookup(payload.user);
  await accessControlService.grantPlanOverride({
    userId: lookup.user.id,
    planId: payload.planId,
    source: payload.source,
    reason: payload.reason,
    ...(expiresAt ? { expiresAt } : {}),
    grantedByUserId: request.auth!.userId
  });
  await recordAdminAudit({ actorUserId: request.auth!.userId, action: "plan_override.granted", targetType: "user", targetId: lookup.user.id, reason: payload.reason, metadata: { planId: payload.planId, source: payload.source, expiresAt: payload.expiresAt ?? null } });
  response.status(200).json(await accessControlService.adminPlanOverrideLookup(payload.user));
}

export async function revokePlanOverride(request: Request, response: Response): Promise<void> {
  requireAdmin(request);
  const payload = adminRevokePlanOverrideSchema.parse(request.body);
  await accessControlService.revokePlanOverride({
    assignmentId: payload.assignmentId,
    reason: payload.reason,
    revokedByUserId: request.auth!.userId
  });
  await recordAdminAudit({ actorUserId: request.auth!.userId, action: "plan_override.revoked", targetType: "plan_assignment", targetId: payload.assignmentId, reason: payload.reason });
  response.status(200).json(await accessControlService.adminPlanOverrideLookup(payload.user));
}

export async function listReviewSubmissions(request: Request, response: Response): Promise<void> {
  requireAdmin(request);
  const database = getDatabase();
  if (!database) throw new HttpError("Review submissions are temporarily unavailable.", 503);
  const rawLimit = typeof request.query.limit === "string" ? Number(request.query.limit) : 50;
  const limit = Number.isFinite(rawLimit) ? Math.max(1, Math.min(100, Math.trunc(rawLimit))) : 50;

  const [unsafeReports, feedback] = await Promise.all([
    database.select({
      id: unsafeOutputReports.id,
      category: unsafeOutputReports.category,
      outputExcerpt: unsafeOutputReports.outputExcerpt,
      details: unsafeOutputReports.details,
      conversationId: unsafeOutputReports.conversationId,
      userId: unsafeOutputReports.userId,
      userEmail: users.email,
      username: users.username,
      metadata: unsafeOutputReports.metadata,
      status: unsafeOutputReports.status,
      resolution: unsafeOutputReports.resolution,
      resolvedAt: unsafeOutputReports.resolvedAt,
      createdAt: unsafeOutputReports.createdAt
    }).from(unsafeOutputReports).leftJoin(users, eq(unsafeOutputReports.userId, users.id)).orderBy(desc(unsafeOutputReports.createdAt)).limit(limit),
    database.select({
      id: responseFeedback.id,
      category: responseFeedback.category,
      outputExcerpt: responseFeedback.outputExcerpt,
      details: responseFeedback.details,
      conversationId: responseFeedback.conversationId,
      userId: responseFeedback.userId,
      userEmail: users.email,
      username: users.username,
      metadata: responseFeedback.metadata,
      createdAt: responseFeedback.createdAt
    }).from(responseFeedback).leftJoin(users, eq(responseFeedback.userId, users.id)).orderBy(desc(responseFeedback.createdAt)).limit(limit)
  ]);

  const submissions = [
    ...unsafeReports.map((submission) => ({ ...submission, kind: "unsafe_output" as const })),
    ...feedback.map((submission) => ({ ...submission, kind: "general_feedback" as const, status: null, resolution: null, resolvedAt: null }))
  ].sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime()).slice(0, limit).map((submission) => ({
    id: submission.id,
    kind: submission.kind,
    category: submission.category,
    outputExcerpt: submission.outputExcerpt,
    details: submission.details,
    conversationId: submission.conversationId,
    userId: submission.userId,
    userEmail: submission.userEmail,
    username: submission.username,
    clientType: typeof submission.metadata.clientType === "string" ? submission.metadata.clientType : null,
    status: submission.status,
    resolution: submission.resolution,
    resolvedAt: submission.resolvedAt?.toISOString() ?? null,
    createdAt: submission.createdAt.toISOString()
  }));
  response.status(200).json({ submissions });
}

export async function resolveSafetyReport(request: Request, response: Response): Promise<void> {
  requireAdmin(request);
  const payload = adminResolveSafetyReportSchema.parse(request.body);
  const database = getDatabase();
  if (!database) throw new HttpError("Safety review is temporarily unavailable.", 503);
  const now = new Date();
  await database.transaction(async (tx) => {
    const [updated] = await tx.update(unsafeOutputReports).set({
      status: payload.status,
      resolution: payload.resolution,
      resolvedByUserId: request.auth!.userId,
      resolvedAt: now,
      updatedAt: now
    }).where(eq(unsafeOutputReports.id, payload.reportId)).returning({ id: unsafeOutputReports.id });
    if (!updated) throw new HttpError("Safety report not found.", 404);
    await tx.insert(adminAuditEvents).values({ id: `audit_${randomUUID()}`, actorUserId: request.auth!.userId, action: `safety_report.${payload.status}`, targetType: "unsafe_output_report", targetId: payload.reportId, reason: payload.resolution });
  });
  response.status(200).json({ status: "ok" });
}

function numeric(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : 0;
}

export async function getOperationsOverview(request: Request, response: Response): Promise<void> {
  requireAdmin(request);
  const database = getDatabase();
  if (!database) throw new HttpError("Operations monitoring is temporarily unavailable.", 503);
  const requestedDays = typeof request.query.days === "string" ? Number(request.query.days) : 30;
  const periodDays = Number.isFinite(requestedDays) ? Math.max(1, Math.min(90, Math.trunc(requestedDays))) : 30;
  const since = new Date(Date.now() - periodDays * 86_400_000);

  const [rewardSummary, revenueRows, costSummary, safetySummary, failedJobSummary, failedJobRows, anomalyRows, cleanupSummary, cleanupRows, subscriptionRows, auditRows] = await Promise.all([
    database.select({ watched: sql<number>`count(*)::int`, credits: sql<number>`coalesce(sum(${adRewardEvents.rewardAmount}), 0)::int` }).from(adRewardEvents).where(and(eq(adRewardEvents.status, "granted"), gte(adRewardEvents.grantedAt, since))),
    database.select({ currency: adImpressionRevenueEvents.currency, valueMicro: sql<number>`coalesce(sum(${adImpressionRevenueEvents.valueMicro}), 0)::int` }).from(adImpressionRevenueEvents).innerJoin(adRewardSessions, eq(adImpressionRevenueEvents.rewardSessionId, adRewardSessions.id)).where(and(eq(adRewardSessions.status, "granted"), gte(adImpressionRevenueEvents.createdAt, since))).groupBy(adImpressionRevenueEvents.currency),
    database.select({ cost: sql<number>`coalesce(sum(${customerUsageEvents.actualCostMicroUsd}), 0)::int` }).from(customerUsageEvents).where(and(eq(customerUsageEvents.status, "settled"), eq(customerUsageEvents.planId, "bronze"), gte(customerUsageEvents.settledAt, since))),
    database.select({ count: sql<number>`count(*)::int` }).from(unsafeOutputReports).where(eq(unsafeOutputReports.status, "open")),
    database.select({ count: sql<number>`count(*)::int` }).from(backgroundJobs).where(and(eq(backgroundJobs.status, "failed"), gte(backgroundJobs.updatedAt, since))),
    database.select({ id: backgroundJobs.id, kind: backgroundJobs.kind, ownerId: backgroundJobs.ownerId, provider: backgroundJobs.provider, failureReason: backgroundJobs.failureReason, error: backgroundJobs.error, updatedAt: backgroundJobs.updatedAt }).from(backgroundJobs).where(and(eq(backgroundJobs.status, "failed"), gte(backgroundJobs.updatedAt, since))).orderBy(desc(backgroundJobs.updatedAt)).limit(50),
    database.select({ userId: customerUsageEvents.userId, costMicroUsd: sql<number>`coalesce(sum(${customerUsageEvents.actualCostMicroUsd}), 0)::int`, eventCount: sql<number>`count(*)::int` }).from(customerUsageEvents).where(and(eq(customerUsageEvents.status, "settled"), gte(customerUsageEvents.settledAt, since))).groupBy(customerUsageEvents.userId).orderBy(desc(sql`sum(${customerUsageEvents.actualCostMicroUsd})`)).limit(25),
    database.select({ count: sql<number>`count(*)::int` }).from(operationalEvents).where(and(eq(operationalEvents.kind, "storage_cleanup"), eq(operationalEvents.status, "failed"), gte(operationalEvents.createdAt, since))),
    database.select({ id: operationalEvents.id, component: operationalEvents.component, message: operationalEvents.message, createdAt: operationalEvents.createdAt }).from(operationalEvents).where(and(eq(operationalEvents.kind, "storage_cleanup"), eq(operationalEvents.status, "failed"), gte(operationalEvents.createdAt, since))).orderBy(desc(operationalEvents.createdAt)).limit(50),
    database.select({ id: billingSubscriptions.id, userId: billingSubscriptions.userId, planId: billingSubscriptions.planId, status: billingSubscriptions.status, store: billingSubscriptions.store, currentPeriodEndsAt: billingSubscriptions.currentPeriodEndsAt, cancelReason: billingSubscriptions.cancelReason, updatedAt: billingSubscriptions.updatedAt }).from(billingSubscriptions).orderBy(desc(billingSubscriptions.updatedAt)).limit(50),
    database.select({ id: adminAuditEvents.id, actorUserId: adminAuditEvents.actorUserId, action: adminAuditEvents.action, targetType: adminAuditEvents.targetType, targetId: adminAuditEvents.targetId, reason: adminAuditEvents.reason, createdAt: adminAuditEvents.createdAt }).from(adminAuditEvents).orderBy(desc(adminAuditEvents.createdAt)).limit(100)
  ]);
  const usageAnomalies = anomalyRows.filter((row) => numeric(row.costMicroUsd) >= 5_000_000).map((row) => ({ ...row, costMicroUsd: numeric(row.costMicroUsd), eventCount: numeric(row.eventCount) }));
  const adRevenueMicroUsd = numeric(revenueRows.find((row) => row.currency === "USD")?.valueMicro);
  const actualAiCostMicroUsd = numeric(costSummary[0]?.cost);
  response.status(200).json({
    periodDays,
    metrics: {
      rewardedAdsWatched: numeric(rewardSummary[0]?.watched), creditsGranted: numeric(rewardSummary[0]?.credits),
      adRevenueMicroUsd, actualAiCostMicroUsd, grossMarginMicroUsd: adRevenueMicroUsd - actualAiCostMicroUsd,
      otherRevenueCurrencies: revenueRows.filter((row) => row.currency !== "USD").map((row) => ({ currency: row.currency, valueMicro: numeric(row.valueMicro) })),
      openSafetyReports: numeric(safetySummary[0]?.count), failedJobs: numeric(failedJobSummary[0]?.count),
      usageAnomalies: usageAnomalies.length, storageCleanupFailures: numeric(cleanupSummary[0]?.count)
    },
    failedJobs: failedJobRows.map((row) => ({ ...row, updatedAt: row.updatedAt.toISOString() })),
    usageAnomalies,
    storageCleanupFailures: cleanupRows.map((row) => ({ ...row, createdAt: row.createdAt.toISOString() })),
    subscriptions: subscriptionRows.map((row) => ({ ...row, currentPeriodEndsAt: row.currentPeriodEndsAt?.toISOString() ?? null, updatedAt: row.updatedAt.toISOString() })),
    auditHistory: auditRows.map((row) => ({ ...row, createdAt: row.createdAt.toISOString() }))
  });
}

async function investigateAccount(identifier: string) {
  const database = getDatabase();
  if (!database) throw new HttpError("Account investigation is temporarily unavailable.", 503);
  const lookup = await accessControlService.adminPlanOverrideLookup(identifier);
  const [userRows, subscriptionRows, safetyRows, jobRows, costRows] = await Promise.all([
    database.select({ id: users.id, email: users.email, username: users.username, status: users.status, role: users.role, deletionRequestedAt: users.deletionRequestedAt, deletionScheduledFor: users.deletionScheduledFor, createdAt: users.createdAt }).from(users).where(eq(users.id, lookup.user.id)).limit(1),
    database.select().from(billingSubscriptions).where(eq(billingSubscriptions.userId, lookup.user.id)).orderBy(desc(billingSubscriptions.updatedAt)).limit(1),
    database.select({ count: sql<number>`count(*)::int` }).from(unsafeOutputReports).where(and(eq(unsafeOutputReports.userId, lookup.user.id), eq(unsafeOutputReports.status, "open"))),
    database.select({ count: sql<number>`count(*)::int` }).from(backgroundJobs).where(and(eq(backgroundJobs.ownerId, lookup.user.id), eq(backgroundJobs.status, "failed"))),
    database.select({ cost: sql<number>`coalesce(sum(${customerUsageEvents.actualCostMicroUsd}), 0)::int` }).from(customerUsageEvents).where(and(eq(customerUsageEvents.userId, lookup.user.id), eq(customerUsageEvents.status, "settled")))
  ]);
  const user = userRows[0];
  if (!user) throw new HttpError("User not found.", 404);
  const subscription = subscriptionRows[0];
  return {
    user: { ...user, email: user.email ?? null, username: user.username ?? null, deletionRequestedAt: user.deletionRequestedAt?.toISOString() ?? null, deletionScheduledFor: user.deletionScheduledFor?.toISOString() ?? null, createdAt: user.createdAt.toISOString() },
    effectivePlanId: lookup.effectivePlanId,
    subscription: subscription ? { provider: subscription.provider, planId: subscription.planId, status: subscription.status, store: subscription.store, currentPeriodEndsAt: subscription.currentPeriodEndsAt?.toISOString() ?? null, cancelReason: subscription.cancelReason, expirationReason: subscription.expirationReason } : null,
    openSafetyReports: numeric(safetyRows[0]?.count), failedJobs: numeric(jobRows[0]?.count), usageCostMicroUsd: numeric(costRows[0]?.cost)
  };
}

export async function getAccountInvestigation(request: Request, response: Response): Promise<void> {
  requireAdmin(request);
  const identifier = typeof request.query.user === "string" ? request.query.user : "";
  response.status(200).json(await investigateAccount(identifier));
}

export async function updateAccountStatus(request: Request, response: Response): Promise<void> {
  requireAdmin(request);
  const payload = adminUpdateAccountStatusSchema.parse(request.body);
  const database = getDatabase();
  if (!database) throw new HttpError("Account controls are temporarily unavailable.", 503);
  const lookup = await accessControlService.adminPlanOverrideLookup(payload.user);
  if (lookup.user.id === request.auth!.userId) throw new HttpError("You cannot change your own account status.", 409);
  if (lookup.isAdmin) throw new HttpError("Admin accounts cannot be suspended from this console.", 409);
  const [target] = await database.select({ status: users.status }).from(users).where(eq(users.id, lookup.user.id)).limit(1);
  if (!target) throw new HttpError("User not found.", 404);
  const expectedCurrentStatus = payload.status === "suspended" ? "active" : "suspended";
  if (target.status !== expectedCurrentStatus) {
    throw new HttpError(payload.status === "active"
      ? "Only suspended accounts can be reinstated here."
      : "Only active accounts can be suspended here.", 409);
  }
  await database.transaction(async (tx) => {
    const [updated] = await tx.update(users).set({ status: payload.status, updatedAt: new Date() }).where(and(eq(users.id, lookup.user.id), eq(users.status, expectedCurrentStatus))).returning({ id: users.id });
    if (!updated) throw new HttpError("The account status changed. Refresh and try again.", 409);
    if (payload.status === "suspended") await tx.delete(betterAuthSessions).where(eq(betterAuthSessions.userId, lookup.user.id));
    await tx.insert(adminAuditEvents).values({ id: `audit_${randomUUID()}`, actorUserId: request.auth!.userId, action: payload.status === "suspended" ? "account.suspended" : "account.reinstated", targetType: "user", targetId: lookup.user.id, reason: payload.reason });
  });
  response.status(200).json(await investigateAccount(lookup.user.id));
}
