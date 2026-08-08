import type { NextFunction, Request, Response } from "express";
import { fromNodeHeaders } from "better-auth/node";
import { eq } from "drizzle-orm";
import { auth } from "../auth.js";
import { env } from "../config/env.js";
import { getDatabase } from "../db/client.js";
import { users } from "../db/schema.js";
import { isConfiguredAdminEmail } from "../services/accessControlService.js";
import { HttpError } from "../utils/httpError.js";

function policyConsentIsCurrent(termsVersion: string | null | undefined, privacyVersion: string | null | undefined): boolean {
  return termsVersion === env.TERMS_POLICY_VERSION && privacyVersion === env.PRIVACY_POLICY_VERSION;
}

export async function authenticateRequest(request: Request, _response: Response, next: NextFunction): Promise<void> {
  try {
    if (!auth) {
      next();
      return;
    }
    const authenticated = await auth.api.getSession({ headers: fromNodeHeaders(request.headers) });
    if (!authenticated || authenticated.user.status !== "active") {
      next();
      return;
    }

    // Better Auth may cache the user portion of a session. After a user accepts
    // updated policies or verifies their email, confirm a stale-looking snapshot
    // against the source row once so the very next protected request is not
    // incorrectly rejected.
    let policyConsentRequired = !policyConsentIsCurrent(
      authenticated.user.termsVersionAccepted,
      authenticated.user.privacyVersionAccepted
    );
    // Username-only accounts use synthetic @users.invalid addresses and have no
    // mailbox to verify — they are exempt from email verification.
    let emailVerificationRequired = !authenticated.user.email.endsWith("@users.invalid")
      && authenticated.user.emailVerified !== true;
    if (policyConsentRequired || emailVerificationRequired) {
      const database = getDatabase();
      if (database) {
        const [persistedUser] = await database.select({
          termsVersionAccepted: users.termsVersionAccepted,
          privacyVersionAccepted: users.privacyVersionAccepted,
          emailVerified: users.emailVerified
        }).from(users).where(eq(users.id, authenticated.user.id)).limit(1);
        if (persistedUser) {
          policyConsentRequired = !policyConsentIsCurrent(
            persistedUser.termsVersionAccepted,
            persistedUser.privacyVersionAccepted
          );
          emailVerificationRequired = !authenticated.user.email.endsWith("@users.invalid")
            && !persistedUser.emailVerified;
        }
      }
    }

    request.auth = {
      userId: authenticated.user.id,
      sessionId: authenticated.session.id,
      policyConsentRequired,
      emailVerificationRequired,
      isAdmin: authenticated.user.role === "admin" || isConfiguredAdminEmail(authenticated.user.email),
      clientType: authenticated.session.clientType === "web"
        || authenticated.session.clientType === "desktop"
        || authenticated.session.clientType === "ios"
        || authenticated.session.clientType === "android"
        ? authenticated.session.clientType
        : "unknown"
    };
    next();
  } catch (error) {
    next(error);
  }
}

const policyConsentExemptPaths = new Set([
  "/api/account/policies/current",
  "/api/account/policies/accept",
  "/api/account/oauth/providers"
]);

export function requireCurrentPolicyConsent(request: Request, _response: Response, next: NextFunction): void {
  if (
    !request.path.startsWith("/api/")
    || !request.auth?.policyConsentRequired
    || policyConsentExemptPaths.has(request.path)
    || request.path === "/api/personas"
    || request.path.startsWith("/api/personas/")
    || request.path.startsWith("/api/auth/")
  ) {
    next();
    return;
  }
  next(new HttpError("Review and accept the current Terms of Use and Privacy Policy to continue.", 428));
}

// Session refresh, resend, and sign-out all live under /api/auth/* (handled by
// Better Auth), so an unverified user can always complete or undo the gate.
export function requireVerifiedEmail(request: Request, _response: Response, next: NextFunction): void {
  if (
    !request.path.startsWith("/api/")
    || !request.auth?.emailVerificationRequired
    || policyConsentExemptPaths.has(request.path)
    || request.path === "/api/personas"
    || request.path.startsWith("/api/personas/")
    || request.path.startsWith("/api/auth/")
  ) {
    next();
    return;
  }
  next(new HttpError("Verify your email address to continue. Check your inbox for the verification link.", 403));
}
