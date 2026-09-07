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
  const rawQuery = queryIndex < 0 ? "" : request.originalUrl.slice(queryIndex + 1);
  if (!rawQuery) {
    // AdMob's console first probes the configured URL without a completed ad.
    // This confirms reachability only and must never create a reward.
    response.status(200).json({ status: "ready" });
    return;
  }
  const callback = await verifyAdMobSsvQuery(rawQuery);
  if (callback.kind === "unattributed") {
    // The console's signed test callback may omit its optional testing user ID
    // and custom data. Acknowledge it after signature validation, but never
    // pass it into the reward/session transaction.
    response.status(200).json({ status: "verified" });
    return;
  }
  const status = await applyVerifiedAdMobReward(callback);
  response.status(200).json({ status });
}
