import { basename } from "node:path";
import OpenAI, { toFile } from "openai";
import type { UploadedAsset } from "@persona/shared";
import { env } from "../config/env.js";
import { logger } from "../utils/logger.js";
import { uploadService } from "./uploadService.js";

export type MediaTranscript = {
  assetId: string;
  fileName: string;
  mimeType: string;
  text: string;
};

const MAX_TRANSCRIPT_CHARACTERS = 32_000;

export class MediaTranscriptService {
  private readonly inFlight = new Map<string, Promise<MediaTranscript | undefined>>();

  async transcribe(ownerId: string, asset: UploadedAsset, signal?: AbortSignal): Promise<MediaTranscript | undefined> {
    if (!env.MEDIA_TRANSCRIPTION_ENABLED || !env.OPENAI_API_KEY) return undefined;
    if (!asset.mimeType.startsWith("audio/") && !asset.mimeType.startsWith("video/")) return undefined;
    if (asset.sizeBytes > env.MEDIA_TRANSCRIPTION_MAX_BYTES) {
      logger.info("Media transcription skipped because the file exceeds the transcription limit", {
        ownerId,
        assetId: asset.id,
        sizeBytes: asset.sizeBytes
      });
      return undefined;
    }
    signal?.throwIfAborted();
    const operationKey = `${ownerId}:${asset.id}`;
    let operation = this.inFlight.get(operationKey);
    if (!operation) {
      // A shared transcription must not inherit one HTTP request's abort
      // signal. Otherwise one disconnected client can cancel another request
      // that is waiting on the same owner-scoped asset.
      operation = this.transcribeOnce(ownerId, asset).finally(() => this.inFlight.delete(operationKey));
      this.inFlight.set(operationKey, operation);
    }
    return this.waitForOperation(operation, signal);
  }

  private async waitForOperation(
    operation: Promise<MediaTranscript | undefined>,
    signal?: AbortSignal
  ): Promise<MediaTranscript | undefined> {
    if (!signal) return operation;
    signal.throwIfAborted();
    return new Promise((resolve, reject) => {
      const abort = () => reject(signal.reason ?? new DOMException("The operation was aborted.", "AbortError"));
      signal.addEventListener("abort", abort, { once: true });
      void operation.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
    });
  }

  private async transcribeOnce(
    ownerId: string,
    asset: UploadedAsset,
    signal?: AbortSignal
  ): Promise<MediaTranscript | undefined> {
    const metadata = await uploadService.metadata(ownerId, asset.id);
    if (typeof metadata.mediaTranscript === "string" && metadata.mediaTranscript.trim()) {
      return {
        assetId: asset.id,
        fileName: asset.fileName,
        mimeType: asset.mimeType,
        text: metadata.mediaTranscript.slice(0, MAX_TRANSCRIPT_CHARACTERS)
      };
    }
    try {
      const downloaded = await uploadService.download(ownerId, asset.id);
      const client = new OpenAI({ apiKey: env.OPENAI_API_KEY, timeout: env.OPENAI_REQUEST_TIMEOUT_MS });
      const response = await client.audio.transcriptions.create({
        file: await toFile(downloaded.buffer, basename(downloaded.fileName), { type: downloaded.mimeType }),
        model: env.MEDIA_TRANSCRIPTION_MODEL,
        response_format: "text"
      }, signal ? { signal } : undefined);
      const rawText = response;
      const text = rawText.trim().slice(0, MAX_TRANSCRIPT_CHARACTERS);
      if (!text) return undefined;
      await uploadService.updateMetadata(ownerId, asset.id, {
        mediaTranscript: text,
        mediaTranscriptModel: env.MEDIA_TRANSCRIPTION_MODEL,
        mediaTranscribedAt: new Date().toISOString()
      });
      return { assetId: asset.id, fileName: asset.fileName, mimeType: asset.mimeType, text };
    } catch (error) {
      if (signal?.aborted) throw error;
      logger.warn("Media transcription failed without failing the chat request", {
        ownerId,
        assetId: asset.id,
        error: error instanceof Error ? error.message : String(error)
      });
      return undefined;
    }
  }
}

export const mediaTranscriptService = new MediaTranscriptService();
