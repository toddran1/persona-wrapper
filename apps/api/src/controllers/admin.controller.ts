import type { Request, Response } from "express";
import { adminGrantPlanOverrideSchema, adminRevokePlanOverrideSchema } from "@persona/shared";
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
