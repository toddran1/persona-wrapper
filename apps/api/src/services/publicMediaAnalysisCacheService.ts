import { createHash } from "node:crypto";
import { and, eq, gt, lte } from "drizzle-orm";
import { env } from "../config/env.js";
import { getDatabase } from "../db/client.js";
import { publicMediaAnalyses } from "../db/schema.js";
import { logger } from "../utils/logger.js";

export type PublicMediaAnalysisKey = {
  mediaKind: "youtube_video";
  mediaId: string;
  provider: "gemini";
  model: string;
  resolution: "low";
  analysisVersion: string;
};

export type PublicMediaAnalysis = {
  analysisText: string;
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
};

type MemoryEntry = PublicMediaAnalysis & { expiresAt: number };

const memoryCache = new Map<string, MemoryEntry>();
const MAX_MEMORY_ENTRIES = 500;
const MAX_ANALYSIS_CHARACTERS = 16_000;
const DATABASE_CLEANUP_INTERVAL_MS = 60 * 60_000;
let nextDatabaseCleanupAt = 0;

function serializedKey(key: PublicMediaAnalysisKey): string {
  return [key.mediaKind, key.mediaId, key.provider, key.model, key.resolution, key.analysisVersion].join(":");
}

function rowId(key: PublicMediaAnalysisKey): string {
  return `media_analysis_${createHash("sha256").update(serializedKey(key)).digest("hex").slice(0, 40)}`;
}

function pruneMemory(now: number): void {
  for (const [key, value] of memoryCache) {
    if (value.expiresAt <= now) memoryCache.delete(key);
  }
  while (memoryCache.size >= MAX_MEMORY_ENTRIES) {
    const oldest = memoryCache.keys().next().value;
    if (typeof oldest !== "string") break;
    memoryCache.delete(oldest);
  }
}

function normalizedAnalysis(value: PublicMediaAnalysis): PublicMediaAnalysis | undefined {
  const analysisText = value.analysisText.trim().slice(0, MAX_ANALYSIS_CHARACTERS);
  if (!analysisText) return undefined;
  const safeCount = (count: number) => Number.isSafeInteger(count) && count > 0 ? count : 0;
  return {
    analysisText,
    inputTokens: safeCount(value.inputTokens),
    outputTokens: safeCount(value.outputTokens),
    reasoningTokens: safeCount(value.reasoningTokens)
  };
}

function errorKind(error: unknown): string {
  return error instanceof Error ? error.name : "UnknownError";
}

async function cleanupExpiredRows(now: number): Promise<void> {
  if (now < nextDatabaseCleanupAt) return;
  nextDatabaseCleanupAt = now + DATABASE_CLEANUP_INTERVAL_MS;
  const database = getDatabase();
  if (!database) return;
  try {
    await database.delete(publicMediaAnalyses).where(lte(publicMediaAnalyses.expiresAt, new Date(now)));
  } catch (error) {
    logger.warn("Expired public media analysis cleanup failed", { errorKind: errorKind(error) });
  }
}

export type PublicMediaAnalysisCache = {
  get(key: PublicMediaAnalysisKey): Promise<PublicMediaAnalysis | undefined>;
  set(key: PublicMediaAnalysisKey, value: PublicMediaAnalysis): Promise<void>;
};

export const publicMediaAnalysisCacheService: PublicMediaAnalysisCache = {
  async get(key) {
    const now = Date.now();
    const memoryKey = serializedKey(key);
    const memory = memoryCache.get(memoryKey);
    if (memory && memory.expiresAt > now) return memory;
    if (memory) memoryCache.delete(memoryKey);

    const database = getDatabase();
    if (!database) return undefined;
    try {
      const [row] = await database.select().from(publicMediaAnalyses).where(and(
        eq(publicMediaAnalyses.mediaKind, key.mediaKind),
        eq(publicMediaAnalyses.mediaId, key.mediaId),
        eq(publicMediaAnalyses.provider, key.provider),
        eq(publicMediaAnalyses.model, key.model),
        eq(publicMediaAnalyses.resolution, key.resolution),
        eq(publicMediaAnalyses.analysisVersion, key.analysisVersion),
        gt(publicMediaAnalyses.expiresAt, new Date(now))
      )).limit(1);
      if (!row) return undefined;
      const value = normalizedAnalysis({
        analysisText: row.analysisText,
        inputTokens: row.inputTokens,
        outputTokens: row.outputTokens,
        reasoningTokens: row.reasoningTokens
      });
      if (!value) return undefined;
      pruneMemory(now);
      memoryCache.set(memoryKey, { ...value, expiresAt: row.expiresAt.getTime() });
      return value;
    } catch (error) {
      logger.warn("Public media analysis cache read failed", {
        mediaKind: key.mediaKind,
        mediaId: key.mediaId,
        errorKind: errorKind(error)
      });
      return undefined;
    }
  },

  async set(key, value) {
    const now = Date.now();
    const normalized = normalizedAnalysis(value);
    if (!normalized) return;
    const expiresAt = new Date(now + env.GEMINI_VIDEO_ANALYSIS_CACHE_TTL_MS);
    const memoryKey = serializedKey(key);
    pruneMemory(now);
    memoryCache.set(memoryKey, { ...normalized, expiresAt: expiresAt.getTime() });

    const database = getDatabase();
    if (!database) return;
    try {
      await cleanupExpiredRows(now);
      await database.insert(publicMediaAnalyses).values({
        id: rowId(key),
        ...key,
        analysisText: normalized.analysisText,
        inputTokens: normalized.inputTokens,
        outputTokens: normalized.outputTokens,
        reasoningTokens: normalized.reasoningTokens,
        updatedAt: new Date(now),
        expiresAt
      }).onConflictDoUpdate({
        target: [
          publicMediaAnalyses.mediaKind,
          publicMediaAnalyses.mediaId,
          publicMediaAnalyses.provider,
          publicMediaAnalyses.model,
          publicMediaAnalyses.resolution,
          publicMediaAnalyses.analysisVersion
        ],
        set: {
          analysisText: normalized.analysisText,
          inputTokens: normalized.inputTokens,
          outputTokens: normalized.outputTokens,
          reasoningTokens: normalized.reasoningTokens,
          updatedAt: new Date(now),
          expiresAt
        }
      });
    } catch (error) {
      logger.warn("Public media analysis cache write failed", {
        mediaKind: key.mediaKind,
        mediaId: key.mediaId,
        errorKind: errorKind(error)
      });
    }
  }
};
