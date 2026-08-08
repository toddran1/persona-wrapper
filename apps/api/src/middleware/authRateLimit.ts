import type { NextFunction, Request, Response } from "express";
import { randomUUID } from "node:crypto";
import { and, eq, gte, sql } from "drizzle-orm";
import { env } from "../config/env.js";
import { getDatabase } from "../db/client.js";
import { usageEvents } from "../db/schema.js";
import { requestAbuseSignals } from "../utils/requestAbuseSignals.js";

type RateLimitEntry = {
  count: number;
  resetAt: number;
};

const attempts = new Map<string, RateLimitEntry>();
const signupAttempts = new Map<string, RateLimitEntry>();
const oauthPollAttempts = new Map<string, RateLimitEntry>();
const dataTransferAttempts = new Map<string, RateLimitEntry>();
const safetyReportAttempts = new Map<string, RateLimitEntry>();
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
      message: "Too many authentication attempts. Please try again later.",
      code: "RATE_LIMITED",
      requestId: response.locals.requestId
    });
    return;
  }

  next();
}

export function signupAbuseRateLimit(request: Request, response: Response, next: NextFunction): void {
  const signals = requestAbuseSignals(request);
  const limits = [
    ...(signals.deviceKey ? [{
      key: `signup:${signals.deviceKey}`,
      eventType: "signup_device_attempt",
      limit: env.AUTH_SIGNUP_DEVICE_LIMIT
    }] : []),
    ...(signals.ipKey ? [{
      key: `signup:${signals.ipKey}`,
      eventType: "signup_ip_attempt",
      limit: env.AUTH_SIGNUP_IP_LIMIT
    }] : [])
  ];
  if (limits.length === 0) {
    response.status(400).json({
      error: "A valid client network signal is required.",
      message: "A valid client network signal is required.",
      code: "INVALID_CLIENT_SIGNAL",
      requestId: response.locals.requestId
    });
    return;
  }
  const message = "Too many accounts were created or attempted from this device or network. Please try again later.";
  if (getDatabase()) {
    void Promise.all(limits.map((entry) =>
      consumeDistributedLimit(entry.key, entry.eventType, entry.limit, env.AUTH_SIGNUP_WINDOW_MS)
        .then((result) => ({ ...entry, result }))
    )).then((results) => {
      const exceeded = results.find((entry) => entry.result.count > entry.limit);
      if (exceeded) {
        finishRateLimit(exceeded.result, exceeded.limit, response, next, message);
        return;
      }
      const mostConstrained = results.reduce((selected, entry) =>
        entry.limit - entry.result.count < selected.limit - selected.result.count ? entry : selected
      );
      finishRateLimit(mostConstrained.result, mostConstrained.limit, response, next, message);
    }).catch(next);
    return;
  }

  const now = Date.now();
  pruneMap(signupAttempts, now);
  const results = limits.map((limit) => {
    const current = signupAttempts.get(limit.key);
    const result = !current || current.resetAt <= now
      ? { count: 1, resetAt: now + env.AUTH_SIGNUP_WINDOW_MS }
      : { ...current, count: current.count + 1 };
    signupAttempts.set(limit.key, result);
    return { ...limit, result };
  });
  const exceeded = results.find((entry) => entry.result.count > entry.limit);
  if (exceeded) {
    finishRateLimit(exceeded.result, exceeded.limit, response, next, message);
    return;
  }
  const mostConstrained = results.reduce((selected, entry) =>
    entry.limit - entry.result.count < selected.limit - selected.result.count ? entry : selected
  );
  finishRateLimit(mostConstrained.result, mostConstrained.limit, response, next, message);
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

export function safetyReportRateLimit(request: Request, response: Response, next: NextFunction): void {
  const identity = request.auth?.userId || request.ip || request.socket.remoteAddress || "unknown";
  const key = `safety-report:${identity}`;
  const message = "Too many reports were submitted. Please wait before sending another report.";
  const limit = 20;
  const windowMs = 60 * 60 * 1000;
  if (getDatabase()) {
    void consumeDistributedLimit(key, "safety_report_request", limit, windowMs)
      .then((entry) => finishRateLimit(entry, limit, response, next, message))
      .catch(next);
    return;
  }

  const now = Date.now();
  pruneMap(safetyReportAttempts, now);
  const current = safetyReportAttempts.get(key);
  const entry = !current || current.resetAt <= now
    ? { count: 1, resetAt: now + windowMs }
    : { ...current, count: current.count + 1 };
  safetyReportAttempts.set(key, entry);
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
    // better-auth clients surface `message`; keep `error` for contract callers.
    response.status(429).json({ error: message, message, code: "RATE_LIMITED", requestId: response.locals.requestId });
    return;
  }
  next();
}
