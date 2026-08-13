import type { NextFunction, Request, Response } from "express";
import { getBillingCatalog } from "../services/billingCatalogService.js";
import { revenueCatBillingService } from "../services/revenueCatBillingService.js";
import { HttpError } from "../utils/httpError.js";

export async function getAccountBillingCatalog(request: Request, response: Response): Promise<void> {
  if (!request.auth) throw new HttpError("Not authenticated.", 401);
  response.status(200).json(await getBillingCatalog(request.auth.userId));
}

export function postRevenueCatWebhook(request: Request, response: Response, next: NextFunction): void {
  try {
    revenueCatBillingService.authorize(request.header("authorization"));
  } catch (error) {
    next(error);
    return;
  }
  revenueCatBillingService.process(request.body)
    .then((result) => response.status(200).json(result))
    .catch(next);
}
