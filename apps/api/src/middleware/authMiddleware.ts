import type { NextFunction, Request, Response } from "express";
import { fromNodeHeaders } from "better-auth/node";
import { auth } from "../auth.js";
import { env } from "../config/env.js";
import { HttpError } from "../utils/httpError.js";

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

    request.auth = {
      userId: authenticated.user.id,
      sessionId: authenticated.session.id,
      policyConsentRequired:
        authenticated.user.termsVersionAccepted !== env.TERMS_POLICY_VERSION
        || authenticated.user.privacyVersionAccepted !== env.PRIVACY_POLICY_VERSION,
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
    || request.path.startsWith("/api/auth/")
  ) {
    next();
    return;
  }
  next(new HttpError("Review and accept the current Terms of Use and Privacy Policy to continue.", 428));
}
