import type { Request, Response } from "express";
import { adminGrantPlanOverrideSchema, adminRevokePlanOverrideSchema } from "@persona/shared";
import { desc, eq } from "drizzle-orm";
import { getDatabase } from "../db/client.js";
import { responseFeedback, unsafeOutputReports, users } from "../db/schema.js";
import { accessControlService } from "../services/accessControlService.js";
import { HttpError } from "../utils/httpError.js";

// Admin-only plan override management (promotions, testers, support grants,
// grandfathered access). Admin status comes from the session: users.role or
// APP_ADMIN_EMAILS, resolved by the auth middleware.
function requireAdmin(request: Request): void {
  if (!request.auth) throw new HttpError("Not authenticated.", 401);
  if (!request.auth.isAdmin) throw new HttpError("Admin access required.", 403);
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
    ...feedback.map((submission) => ({ ...submission, kind: "general_feedback" as const }))
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
    createdAt: submission.createdAt.toISOString()
  }));
  response.status(200).json({ submissions });
}
