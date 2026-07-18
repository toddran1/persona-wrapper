import type { NextFunction, Request, Response } from "express";
import { fromNodeHeaders } from "better-auth/node";
import { auth } from "../auth.js";

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
