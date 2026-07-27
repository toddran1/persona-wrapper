import type { NextFunction, Request, Response } from "express";
import { fromNodeHeaders } from "better-auth/node";
import { eq } from "drizzle-orm";
import { auth } from "../auth.js";
import { env } from "../config/env.js";
import { getDatabase } from "../db/client.js";
import { users } from "../db/schema.js";
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
    // updated policies, confirm a stale-looking snapshot against the source row
    // once so the very next protected request is not incorrectly rejected.
    let policyConsentRequired = !policyConsentIsCurrent(
      authenticated.user.termsVersionAccepted,
      authenticated.user.privacyVersionAccepted
    );
    if (policyConsentRequired) {
      const database = getDatabase();
      if (database) {
        const [persistedUser] = await database.select({
          termsVersionAccepted: users.termsVersionAccepted,
          privacyVersionAccepted: users.privacyVersionAccepted
        }).from(users).where(eq(users.id, authenticated.user.id)).limit(1);
        policyConsentRequired = !policyConsentIsCurrent(
          persistedUser?.termsVersionAccepted,
          persistedUser?.privacyVersionAccepted
        );
      }
    }

    request.auth = {
      userId: authenticated.user.id,
      sessionId: authenticated.session.id,
      policyConsentRequired,
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
