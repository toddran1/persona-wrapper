import type { NextFunction, Request, Response } from "express";
import { authService } from "../services/authService.js";
import { HttpError } from "../utils/httpError.js";

function bearerToken(request: Request): string | undefined {
  const value = request.header("authorization");
  if (!value) return undefined;
  const match = /^Bearer\s+(.+)$/i.exec(value.trim());
  return match?.[1]?.trim();
}

function allowsAnonymousAuthRequest(request: Request): boolean {
  return [
    "/api/auth/login",
    "/api/auth/register",
    "/api/auth/refresh",
    "/api/auth/oauth/providers"
  ].includes(request.path);
}

export async function authenticateRequest(request: Request, _response: Response, next: NextFunction): Promise<void> {
  try {
    const token = bearerToken(request);
    if (!token) {
      next();
      return;
    }

    const authenticated = await authService.authenticate(token);
    if (!authenticated) {
      if (allowsAnonymousAuthRequest(request)) {
        next();
        return;
      }
      throw new HttpError("Authentication token is invalid or expired.", 401);
    }

    request.auth = {
      userId: authenticated.user.id,
      sessionId: authenticated.session.id,
      clientType: authenticated.session.clientType
    };
    next();
  } catch (error) {
    next(error);
  }
}

export function requestBearerToken(request: Request): string | undefined {
  return bearerToken(request);
}
