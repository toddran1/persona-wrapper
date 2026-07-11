import type { NextFunction, Request, Response } from "express";
import { env } from "../config/env.js";

type RateLimitEntry = {
  count: number;
  resetAt: number;
};

const attempts = new Map<string, RateLimitEntry>();
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
    response.status(429).json({ error: "Too many authentication attempts. Please try again later." });
    return;
  }

  next();
}
