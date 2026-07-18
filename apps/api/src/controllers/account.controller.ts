import type { Request, Response } from "express";
import { and, eq, or } from "drizzle-orm";
import { deleteAccountRequestSchema, restoreAccountRequestSchema } from "@persona/shared";
import { env } from "../config/env.js";
import { getDatabase } from "../db/client.js";
import { betterAuthAccounts, betterAuthSessions, users } from "../db/schema.js";
import { HttpError } from "../utils/httpError.js";
import { accountDeletionService } from "../services/accountDeletionService.js";
import { backgroundChatJobService } from "../services/backgroundChatJobService.js";
import { dataTransferJobService } from "../services/dataTransferJobService.js";
import { verifyPassword } from "../services/passwordService.js";

function requireDatabase() {
  const db = getDatabase();
  if (!db) throw new HttpError("Authentication requires DATABASE_URL.", 503);
  return db;
}

export async function restoreAccount(request: Request, response: Response): Promise<void> {
  const payload = restoreAccountRequestSchema.parse(request.body);
  const identifier = payload.identifier.trim().toLowerCase();
  const db = requireDatabase();
  const [user] = await db.select().from(users)
    .where(or(eq(users.email, identifier), eq(users.username, identifier)))
    .limit(1);
  if (!user) throw new HttpError("Invalid username/email or password.", 401);

  const [credential] = await db.select().from(betterAuthAccounts).where(and(
    eq(betterAuthAccounts.userId, user.id),
    eq(betterAuthAccounts.providerId, "credential")
  )).limit(1);
  if (!credential?.password || !(await verifyPassword(payload.password, credential.password))) {
    throw new HttpError("Invalid username/email or password.", 401);
  }
  if (user.status === "active") throw new HttpError("This account is already active. Sign in instead.", 409);
  if (user.status !== "pending_deletion") throw new HttpError("This account cannot be restored.", 409);
  if (user.deletionScheduledFor && user.deletionScheduledFor.getTime() <= Date.now()) {
    await accountDeletionService.purgeUser(user.id);
    throw new HttpError("The account recovery period has ended and the account was permanently deleted.", 410);
  }

  await db.update(users).set({
    status: "active",
    deletionRequestedAt: null,
    deletionScheduledFor: null,
    updatedAt: new Date()
  }).where(eq(users.id, user.id));
  response.status(200).json({ restored: true });
}

export async function deleteAccount(request: Request, response: Response): Promise<void> {
  if (!request.auth) throw new HttpError("Not authenticated.", 401);
  const payload = deleteAccountRequestSchema.parse(request.body);
  const db = requireDatabase();
  const [user] = await db.select().from(users).where(eq(users.id, request.auth.userId)).limit(1);
  if (!user || user.status !== "active") throw new HttpError("Account is unavailable.", 404);
  const [credential] = await db.select().from(betterAuthAccounts).where(and(
    eq(betterAuthAccounts.userId, user.id),
    eq(betterAuthAccounts.providerId, "credential")
  )).limit(1);
  if (credential?.password && (!payload.password || !(await verifyPassword(payload.password, credential.password)))) {
    throw new HttpError("Your password is required to delete this account.", 401);
  }

  const deletionRequestedAt = new Date();
  const deletionScheduledFor = new Date(
    deletionRequestedAt.getTime() + env.AUTH_ACCOUNT_DELETION_GRACE_DAYS * 24 * 60 * 60 * 1000
  );
  await Promise.all([
    backgroundChatJobService.cancelForOwner(user.id, "Account deletion cancelled this request."),
    dataTransferJobService.cancelForOwner(user.id)
  ]);
  await db.transaction(async (tx) => {
    await tx.update(users).set({
      status: "pending_deletion",
      deletionRequestedAt,
      deletionScheduledFor,
      updatedAt: deletionRequestedAt
    }).where(eq(users.id, user.id));
    await tx.delete(betterAuthSessions).where(eq(betterAuthSessions.userId, user.id));
  });
  response.status(202).json({
    status: "pending_deletion",
    deletionRequestedAt: deletionRequestedAt.toISOString(),
    deletionScheduledFor: deletionScheduledFor.toISOString()
  });
}

export function getOAuthProviders(_request: Request, response: Response): void {
  response.status(200).json({
    providers: [
      { provider: "google", enabled: Boolean(env.GOOGLE_OAUTH_CLIENT_ID && env.GOOGLE_OAUTH_CLIENT_SECRET) },
      { provider: "facebook", enabled: Boolean(env.FACEBOOK_OAUTH_CLIENT_ID && env.FACEBOOK_OAUTH_CLIENT_SECRET) }
    ]
  });
}
