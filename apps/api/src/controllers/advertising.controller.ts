import type { Request, Response } from "express";
import { applyVerifiedAdMobReward, createAdRewardSession, getAdRewardSessionStatus } from "../services/adRewardVerificationService.js";
import { verifyAdMobSsvQuery } from "../services/adMobSsvVerifier.js";
import { HttpError } from "../utils/httpError.js";
import { requestAuthenticatedOwnerId } from "../utils/requestIdentity.js";

export async function postAdRewardSession(request: Request, response: Response): Promise<void> {
  const userId = requestAuthenticatedOwnerId(request);
  response.status(201).json(await createAdRewardSession(userId));
}

export async function getAdRewardSession(request: Request, response: Response): Promise<void> {
  const sessionId = request.params.sessionId;
  if (!sessionId) throw new HttpError("Reward session ID is required.", 400);
  response.status(200).json(await getAdRewardSessionStatus(requestAuthenticatedOwnerId(request), sessionId));
}

export async function getAdMobSsvCallback(request: Request, response: Response): Promise<void> {
  const queryIndex = request.originalUrl.indexOf("?");
  if (queryIndex < 0) throw new HttpError("AdMob callback query is required.", 400);
  const callback = await verifyAdMobSsvQuery(request.originalUrl.slice(queryIndex + 1));
  const status = await applyVerifiedAdMobReward(callback);
  response.status(200).json({ status });
}
