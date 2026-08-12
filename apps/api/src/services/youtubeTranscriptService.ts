import { fetchTranscript, type TranscriptSegment } from "youtube-transcript-plus";
import { logger } from "../utils/logger.js";

export type YouTubeTranscript = {
  text: string;
  language?: string;
  segmentCount: number;
};

type TranscriptFetcher = typeof fetchTranscript;

const MAX_TRANSCRIPT_CHARACTERS = 32_000;
const CACHE_TTL_MS = 60 * 60_000;
const MAX_CACHE_ENTRIES = 250;
const TRANSCRIPT_REQUEST_TIMEOUT_MS = 20_000;

type CachedTranscript = {
  expiresAt: number;
  transcript?: YouTubeTranscript;
};

function normalizeTranscriptText(segments: TranscriptSegment[]): string {
  return segments
    .map((segment) => segment.text.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join(" ")
    .replace(/\s+([,.;!?])/g, "$1")
    .slice(0, MAX_TRANSCRIPT_CHARACTERS);
}

export class YouTubeTranscriptService {
  private readonly cache = new Map<string, CachedTranscript>();

  constructor(
    private readonly transcriptFetcher: TranscriptFetcher = fetchTranscript,
    private readonly now: () => number = Date.now
  ) {}

  async fetch(videoId: string, signal?: AbortSignal): Promise<YouTubeTranscript | undefined> {
    const cached = this.cache.get(videoId);
    if (cached && cached.expiresAt > this.now()) return cached.transcript;

    const timeoutSignal = AbortSignal.timeout(TRANSCRIPT_REQUEST_TIMEOUT_MS);
    try {
      const requestSignal = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;
      const segments = await this.transcriptFetcher(videoId, {
        retries: 2,
        signal: requestSignal
      });
      const text = normalizeTranscriptText(segments);
      const language = segments.find((segment: TranscriptSegment) => segment.lang)?.lang;
      const transcript = text
        ? { text, ...(language ? { language } : {}), segmentCount: segments.length }
        : undefined;
      this.cacheValue(videoId, transcript);
      return transcript;
    } catch (error) {
      if (signal?.aborted) throw error;
      logger.info("YouTube captions were unavailable", {
        videoId,
        error: error instanceof Error ? error.message : String(error)
      });
      // A request timeout is transient. Caching it as a missing transcript would
      // suppress otherwise-valid captions for the full negative-cache TTL.
      if (!timeoutSignal.aborted) this.cacheValue(videoId, undefined);
      return undefined;
    }
  }

  private cacheValue(videoId: string, transcript: YouTubeTranscript | undefined): void {
    while (this.cache.size >= MAX_CACHE_ENTRIES) {
      const oldest = this.cache.keys().next().value as string | undefined;
      if (!oldest) break;
      this.cache.delete(oldest);
    }
    this.cache.set(videoId, {
      expiresAt: this.now() + CACHE_TTL_MS,
      ...(transcript ? { transcript } : {})
    });
  }
}

export const youtubeTranscriptService = new YouTubeTranscriptService();
