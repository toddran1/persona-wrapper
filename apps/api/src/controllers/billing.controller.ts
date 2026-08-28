import type { NextFunction, Request, Response } from "express";
import { getBillingCatalog } from "../services/billingCatalogService.js";
import { revenueCatBillingService } from "../services/revenueCatBillingService.js";
import { HttpError } from "../utils/httpError.js";
import { logger } from "../utils/logger.js";

export async function getAccountBillingCatalog(request: Request, response: Response): Promise<void> {
  if (!request.auth) throw new HttpError("Not authenticated.", 401);
  // Checkout URLs contain the authenticated RevenueCat app user id and must
  // never be served from a shared browser, CDN, or intermediary cache.
  response.setHeader("Cache-Control", "private, no-store");
  response.status(200).json(await getBillingCatalog(request.auth.userId));
}

export function postRevenueCatWebhook(request: Request, response: Response, next: NextFunction): void {
  try {
    revenueCatBillingService.authorize(request.header("authorization"));
  } catch (error) {
    logger.warn("RevenueCat webhook authorization rejected", {
      hasAuthorizationHeader: Boolean(request.header("authorization")),
      hasUserAgent: Boolean(request.header("user-agent")),
      requestId: response.locals.requestId ?? null
    });
    next(error);
    return;
  }
  revenueCatBillingService.process(request.body)
    .then((result) => response.status(200).json(result))
    .catch(next);
}
