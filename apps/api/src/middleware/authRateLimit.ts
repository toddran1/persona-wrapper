import type { NextFunction, Request, Response } from "express";
import { randomUUID } from "node:crypto";
import { and, eq, gte, sql } from "drizzle-orm";
import { env } from "../config/env.js";
import { getDatabase } from "../db/client.js";
import { usageEvents } from "../db/schema.js";

type RateLimitEntry = {
  count: number;
  resetAt: number;
};

const attempts = new Map<string, RateLimitEntry>();
const oauthPollAttempts = new Map<string, RateLimitEntry>();
const dataTransferAttempts = new Map<string, RateLimitEntry>();
const MAX_TRACKED_CLIENTS = 10_000;

function pruneExpired(now: number): void {
  for (const [key, entry] of attempts) {
    if (entry.resetAt <= now) attempts.delete(key);
  }
  while (attempts.size >= MAX_TRACKED_CLIENTS) {
    const oldestKey = attempts.keys().next().value as string | undefined;
    if (!oldestKey) break;
    attempts.delete(oldestKey);
  }
}

export function authRateLimit(request: Request, response: Response, next: NextFunction): void {
  const db = getDatabase();
  if (db) {
    const key = `auth:${request.ip || request.socket.remoteAddress || "unknown"}:${request.path}`;
    void consumeDistributedLimit(key, "auth_request", env.AUTH_RATE_LIMIT_REQUESTS, env.AUTH_RATE_LIMIT_WINDOW_MS)
      .then((entry) => finishRateLimit(entry, env.AUTH_RATE_LIMIT_REQUESTS, response, next,
        "Too many authentication attempts. Please try again later."))
      .catch(next);
    return;
  }
  const now = Date.now();
  if (attempts.size >= MAX_TRACKED_CLIENTS) pruneExpired(now);

  const key = `${request.ip || request.socket.remoteAddress || "unknown"}:${request.path}`;
  const current = attempts.get(key);
  const entry = !current || current.resetAt <= now
    ? { count: 0, resetAt: now + env.AUTH_RATE_LIMIT_WINDOW_MS }
    : current;
  entry.count += 1;
  attempts.set(key, entry);

  const remaining = Math.max(0, env.AUTH_RATE_LIMIT_REQUESTS - entry.count);
  response.setHeader("RateLimit-Limit", String(env.AUTH_RATE_LIMIT_REQUESTS));
  response.setHeader("RateLimit-Remaining", String(remaining));
  response.setHeader("RateLimit-Reset", String(Math.ceil(entry.resetAt / 1000)));

  if (entry.count > env.AUTH_RATE_LIMIT_REQUESTS) {
    const retryAfterSeconds = Math.max(1, Math.ceil((entry.resetAt - now) / 1000));
    response.setHeader("Retry-After", String(retryAfterSeconds));
    response.status(429).json({
      error: "Too many authentication attempts. Please try again later.",
      code: "RATE_LIMITED",
      requestId: response.locals.requestId
    });
    return;
  }

  next();
}

export function mobileOAuthPollRateLimit(request: Request, response: Response, next: NextFunction): void {
  const db = getDatabase();
  if (db) {
    const key = `oauth-poll:${request.ip || request.socket.remoteAddress || "unknown"}`;
    void consumeDistributedLimit(key, "oauth_poll", 90, 5 * 60 * 1000)
      .then((entry) => finishRateLimit(entry, 90, response, next, "Too many OAuth completion checks. Please try again."))
      .catch(next);
    return;
  }
  const now = Date.now();
  const key = request.ip || request.socket.remoteAddress || "unknown";
  const current = oauthPollAttempts.get(key);
  const entry = !current || current.resetAt <= now
    ? { count: 0, resetAt: now + 5 * 60 * 1000 }
    : current;
  entry.count += 1;
  oauthPollAttempts.set(key, entry);

  if (oauthPollAttempts.size >= MAX_TRACKED_CLIENTS) {
    for (const [clientKey, candidate] of oauthPollAttempts) {
      if (candidate.resetAt <= now) oauthPollAttempts.delete(clientKey);
    }
    while (oauthPollAttempts.size > MAX_TRACKED_CLIENTS) {
      const oldestKey = oauthPollAttempts.keys().next().value as string | undefined;
      if (!oldestKey) break;
      oauthPollAttempts.delete(oldestKey);
    }
  }
  if (entry.count > 90) {
    response.setHeader("Retry-After", String(Math.max(1, Math.ceil((entry.resetAt - now) / 1000))));
    response.status(429).json({
      error: "Too many OAuth completion checks. Please try again.",
      code: "RATE_LIMITED",
      requestId: response.locals.requestId
    });
    return;
  }
  next();
}

export function dataTransferRateLimit(request: Request, response: Response, next: NextFunction): void {
  const identity = request.auth?.userId || request.ip || request.socket.remoteAddress || "unknown";
  const key = `data-transfer:${identity}`;
  const message = "Too many data transfer requests. Please wait before starting another transfer.";
  const limit = env.DATA_TRANSFER_RATE_LIMIT_REQUESTS;
  const windowMs = env.DATA_TRANSFER_RATE_LIMIT_WINDOW_MS;
  if (getDatabase()) {
    void consumeDistributedLimit(key, "data_transfer_request", limit, windowMs)
      .then((entry) => finishRateLimit(entry, limit, response, next, message))
      .catch(next);
    return;
  }

  const now = Date.now();
  pruneMap(dataTransferAttempts, now);
  const current = dataTransferAttempts.get(key);
  const entry = !current || current.resetAt <= now
    ? { count: 1, resetAt: now + windowMs }
    : { ...current, count: current.count + 1 };
  dataTransferAttempts.set(key, entry);
  finishRateLimit(entry, limit, response, next, message);
}

function pruneMap(entries: Map<string, RateLimitEntry>, now: number): void {
  if (entries.size < MAX_TRACKED_CLIENTS) return;
  for (const [key, entry] of entries) {
    if (entry.resetAt <= now) entries.delete(key);
  }
  while (entries.size >= MAX_TRACKED_CLIENTS) {
    const oldestKey = entries.keys().next().value as string | undefined;
    if (!oldestKey) break;
    entries.delete(oldestKey);
  }
}

async function consumeDistributedLimit(
  identity: string,
  eventType: string,
  limit: number,
  windowMs: number
): Promise<RateLimitEntry> {
  const db = getDatabase();
  if (!db) return { count: 1, resetAt: Date.now() + windowMs };
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${identity}, 0))`);
    const windowStart = new Date(Date.now() - windowMs);
    const [row] = await tx.select({ count: sql<number>`count(*)::int` }).from(usageEvents).where(and(
      eq(usageEvents.identity, identity),
      eq(usageEvents.eventType, eventType),
      gte(usageEvents.createdAt, windowStart)
    ));
    const count = Number(row?.count ?? 0) + 1;
    await tx.insert(usageEvents).values({ id: `usage_${randomUUID()}`, identity, eventType });
    return { count, resetAt: Date.now() + windowMs };
  });
}

function finishRateLimit(
  entry: RateLimitEntry,
  limit: number,
  response: Response,
  next: NextFunction,
  message: string
): void {
  response.setHeader("RateLimit-Limit", String(limit));
  response.setHeader("RateLimit-Remaining", String(Math.max(0, limit - entry.count)));
  response.setHeader("RateLimit-Reset", String(Math.ceil(entry.resetAt / 1000)));
  if (entry.count > limit) {
    response.setHeader("Retry-After", String(Math.max(1, Math.ceil((entry.resetAt - Date.now()) / 1000))));
    response.status(429).json({ error: message, code: "RATE_LIMITED", requestId: response.locals.requestId });
    return;
  }
  next();
}
