import { randomBytes } from "node:crypto";
import type { Response } from "express";
import { HttpError } from "../utils/httpError.js";

type LiveAudioSession = {
  mimeType: string;
  chunks: Buffer[];
  bytes: number;
  bufferedBytes: number;
  completed: boolean;
  failed: boolean;
  claimed: boolean;
  deliveryAbandoned: boolean;
  subscribers: Set<Response>;
  expiresAt: number;
  cleanupTimer: ReturnType<typeof setTimeout>;
};

// A user may opt out of concise audio and legitimately synthesize several
// minutes of speech. Keep active streams alive beyond the provider request
// window; byte limits still bound memory and completed tokens expire quickly.
const SESSION_TTL_MS = 10 * 60 * 1000;
const COMPLETED_SESSION_TTL_MS = 30 * 1000;
const MAX_BUFFERED_BYTES = 25 * 1024 * 1024;
const MAX_TOTAL_BUFFERED_BYTES = 64 * 1024 * 1024;
const MAX_ACTIVE_SESSIONS = 128;
const DRAIN_TIMEOUT_MS = 5_000;

export type LiveAudioStreamLimits = {
  sessionTtlMs: number;
  completedSessionTtlMs: number;
  maxSessionBytes: number;
  maxTotalBufferedBytes: number;
  maxActiveSessions: number;
  drainTimeoutMs: number;
};

const defaultLimits: LiveAudioStreamLimits = {
  sessionTtlMs: SESSION_TTL_MS,
  completedSessionTtlMs: COMPLETED_SESSION_TTL_MS,
  maxSessionBytes: MAX_BUFFERED_BYTES,
  maxTotalBufferedBytes: MAX_TOTAL_BUFFERED_BYTES,
  maxActiveSessions: MAX_ACTIVE_SESSIONS,
  drainTimeoutMs: DRAIN_TIMEOUT_MS
};

export class LiveAudioStreamService {
  private readonly sessions = new Map<string, LiveAudioSession>();
  private totalBufferedBytes = 0;

  constructor(private readonly limits: LiveAudioStreamLimits = defaultLimits) {}

  create(mimeType: string): { token: string; url: string } {
    this.prune();
    if (this.sessions.size >= this.limits.maxActiveSessions) {
      throw new HttpError("Live audio is temporarily at capacity.", 503);
    }
    const token = randomBytes(32).toString("base64url");
    const session: LiveAudioSession = {
      mimeType,
      chunks: [],
      bytes: 0,
      bufferedBytes: 0,
      completed: false,
      failed: false,
      claimed: false,
      deliveryAbandoned: false,
      subscribers: new Set(),
      expiresAt: Date.now() + this.limits.sessionTtlMs,
      cleanupTimer: this.createCleanupTimer(token, this.limits.sessionTtlMs)
    };
    this.sessions.set(token, session);
    return { token, url: `/api/live-audio/${token}` };
  }

  async write(token: string, chunk: Uint8Array): Promise<void> {
    const session = this.sessions.get(token);
    if (!session || session.completed || session.failed || chunk.byteLength === 0) return;
    const buffer = Buffer.from(chunk);
    session.bytes += buffer.byteLength;
    if (session.bytes > this.limits.maxSessionBytes) {
      this.fail(token);
      throw new HttpError("Live audio exceeded the configured size limit.", 502);
    }
    // Closing the player only abandons progressive delivery. TTS generation
    // and persistence continue independently in chatService, so discard live
    // chunks instead of retaining a now-unread stream in memory.
    if (session.deliveryAbandoned) return;
    if (session.subscribers.size === 0) {
      if (this.totalBufferedBytes + buffer.byteLength > this.limits.maxTotalBufferedBytes) {
        this.fail(token);
        throw new HttpError("Live audio buffering is temporarily at capacity.", 503);
      }
      session.chunks.push(buffer);
      session.bufferedBytes += buffer.byteLength;
      this.totalBufferedBytes += buffer.byteLength;
      return;
    }
    const drains: Promise<void>[] = [];
    for (const subscriber of session.subscribers) {
      if (subscriber.destroyed || subscriber.writableEnded) continue;
      if (!subscriber.write(buffer)) drains.push(this.waitForDrain(subscriber));
    }
    if (drains.length > 0) await Promise.all(drains);
  }

  complete(token: string): void {
    const session = this.sessions.get(token);
    if (!session || session.failed) return;
    session.completed = true;
    if (session.deliveryAbandoned) {
      this.deleteSession(token);
      return;
    }
    session.expiresAt = Date.now() + this.limits.completedSessionTtlMs;
    clearTimeout(session.cleanupTimer);
    session.cleanupTimer = this.createCleanupTimer(token, this.limits.completedSessionTtlMs);
    for (const subscriber of session.subscribers) {
      if (!subscriber.destroyed && !subscriber.writableEnded) subscriber.end();
    }
    const hadSubscribers = session.subscribers.size > 0;
    session.subscribers.clear();
    if (hadSubscribers) this.deleteSession(token);
  }

  fail(token: string): void {
    const session = this.sessions.get(token);
    if (!session) return;
    session.failed = true;
    for (const subscriber of session.subscribers) {
      if (!subscriber.destroyed) subscriber.destroy();
    }
    this.deleteSession(token);
  }

  async subscribe(token: string, response: Response): Promise<void> {
    this.prune();
    const session = this.sessions.get(token);
    if (!session || session.failed) throw new HttpError("This live audio stream is no longer available.", 404);
    if (session.claimed) throw new HttpError("This live audio stream has already been opened.", 410);
    session.claimed = true;

    this.setResponseHeaders(response, session);
    response.flushHeaders();

    let closed = false;
    response.once("close", () => {
      closed = true;
      session.subscribers.delete(response);
      if (!session.completed) {
        session.deliveryAbandoned = true;
        this.clearBufferedChunks(session);
      }
    });
    while (session.chunks.length > 0 && !closed && !response.destroyed && !response.writableEnded) {
      const chunk = session.chunks.shift();
      if (!chunk) break;
      session.bufferedBytes -= chunk.byteLength;
      this.totalBufferedBytes -= chunk.byteLength;
      if (!response.write(chunk)) await this.waitForDrain(response);
    }
    if (session.completed) {
      if (!response.destroyed && !response.writableEnded) response.end();
      this.deleteSession(token);
      return;
    }
    if (closed || response.destroyed || response.writableEnded || !this.sessions.has(token)) return;

    session.subscribers.add(response);
  }

  probe(token: string, response: Response): void {
    this.prune();
    const session = this.sessions.get(token);
    if (!session || session.failed) throw new HttpError("This live audio stream is no longer available.", 404);
    this.setResponseHeaders(response, session);
    response.end();
  }

  private prune(): void {
    const now = Date.now();
    for (const [token, session] of this.sessions) {
      if (session.expiresAt <= now) this.fail(token);
    }
  }

  private createCleanupTimer(token: string, delayMs: number): ReturnType<typeof setTimeout> {
    const timer = setTimeout(() => this.fail(token), delayMs);
    timer.unref?.();
    return timer;
  }

  private deleteSession(token: string): void {
    const session = this.sessions.get(token);
    if (!session) return;
    clearTimeout(session.cleanupTimer);
    this.clearBufferedChunks(session);
    this.sessions.delete(token);
  }

  private clearBufferedChunks(session: LiveAudioSession): void {
    this.totalBufferedBytes = Math.max(0, this.totalBufferedBytes - session.bufferedBytes);
    session.bufferedBytes = 0;
    session.chunks = [];
  }

  private setResponseHeaders(response: Response, session: LiveAudioSession): void {
    response.status(200);
    response.setHeader("Content-Type", session.mimeType);
    response.setHeader("Cache-Control", "private, no-store, max-age=0");
    response.setHeader("Content-Disposition", "inline");
    response.setHeader("Accept-Ranges", "none");
    response.setHeader("Referrer-Policy", "no-referrer");
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("X-Accel-Buffering", "no");
    if (session.completed) response.setHeader("Content-Length", String(session.bufferedBytes));
  }

  private waitForDrain(response: Response): Promise<void> {
    return new Promise((resolve) => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        response.off("drain", finish);
        response.off("close", finish);
        response.off("error", finish);
        resolve();
      };
      const timeout = setTimeout(() => {
        if (!response.destroyed) response.destroy();
        finish();
      }, this.limits.drainTimeoutMs);
      timeout.unref?.();
      response.once("drain", finish);
      response.once("close", finish);
      response.once("error", finish);
    });
  }
}

export const liveAudioStreamService = new LiveAudioStreamService();
