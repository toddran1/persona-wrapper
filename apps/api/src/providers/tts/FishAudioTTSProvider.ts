import type { TTSInput, TTSOutput } from "@persona/shared";
import { env } from "../../config/env.js";
import { generatedAudioService } from "../../services/generatedAudioService.js";
import { HttpError } from "../../utils/httpError.js";
import { logger } from "../../utils/logger.js";
import type { TTSProvider, TTSStreamCallbacks } from "./TTSProvider.js";

type FishAudioFormat = "mp3" | "wav" | "opus";

type FishAudioVoiceConfig = {
  referenceId?: string;
  model: "s1" | "s2-pro" | "s2.1-pro" | "s2.1-pro-free";
  format: FishAudioFormat;
  sampleRate: number;
  mp3Bitrate: 64 | 128 | 192;
  opusBitrate: -1000 | 24000 | 32000 | 48000 | 64000;
  latency: "low" | "normal" | "balanced";
  speed: number;
  volume: number;
  normalizeLoudness: boolean;
  normalize: boolean;
  temperature: number;
  topP: number;
  chunkLength: number;
  maxNewTokens: number;
  repetitionPenalty: number;
  minChunkLength: number;
  conditionOnPreviousChunks: boolean;
  earlyStopThreshold: number;
  features: string[];
};

function ttsAuditMetadata(input: TTSInput, text: string, config: FishAudioVoiceConfig): Record<string, unknown> | undefined {
  if (!env.TTS_AUDIT_LOG_ENABLED) return undefined;

  return {
    ttsAudit: {
      version: 1,
      provider: "fish_audio_tts",
      // This is a private, owner-scoped audit record. Keep the exact body sent
      // to Fish so voice behavior can be reproduced and tuned later.
      script: text,
      scriptCharacters: text.length,
      ...(input.audit ? {
        scriptMode: input.audit.scriptMode,
        sourceProvider: input.audit.sourceProvider,
        visibleTextCharacters: input.audit.visibleTextCharacters
      } : {}),
      request: {
        model: config.model,
        format: config.format,
        sampleRate: config.sampleRate,
        ...(config.format === "mp3" ? { mp3Bitrate: config.mp3Bitrate } : {}),
        ...(config.format === "opus" ? { opusBitrate: config.opusBitrate } : {}),
        latency: config.latency,
        speed: config.speed,
        volume: config.volume,
        normalize: config.normalize,
        normalizeLoudness: config.normalizeLoudness,
        temperature: config.temperature,
        topP: config.topP,
        chunkLength: config.chunkLength,
        maxNewTokens: config.maxNewTokens,
        repetitionPenalty: config.repetitionPenalty,
        minChunkLength: config.minChunkLength,
        conditionOnPreviousChunks: config.conditionOnPreviousChunks,
        earlyStopThreshold: config.earlyStopThreshold,
        features: config.features
      }
    }
  };
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (!signal) return new Promise((resolve) => setTimeout(resolve, ms));
  if (signal.aborted) {
    return Promise.reject(signal.reason ?? new DOMException("The operation was aborted.", "AbortError"));
  }
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      signal.removeEventListener("abort", handleAbort);
      resolve();
    }, ms);
    const handleAbort = () => {
      clearTimeout(timeout);
      reject(signal.reason ?? new DOMException("The operation was aborted.", "AbortError"));
    };
    signal.addEventListener("abort", handleAbort, { once: true });
  });
}

function requestSignal(signal?: AbortSignal): AbortSignal {
  const timeoutSignal = AbortSignal.timeout(env.API_REQUEST_TIMEOUT_MS);
  return signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;
}

function isRetryableStatus(status: number): boolean {
  // Fish does not document an idempotency key for this billable endpoint.
  // Only retry responses that explicitly indicate processing has not started.
  return status === 425 || status === 429;
}

async function readErrorText(response: Response): Promise<string> {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let receivedBytes = 0;
  try {
    while (receivedBytes < 500) {
      const chunk = await reader.read();
      if (chunk.done) break;
      const remainingBytes = 500 - receivedBytes;
      chunks.push(chunk.value.subarray(0, remainingBytes));
      receivedBytes += Math.min(chunk.value.byteLength, remainingBytes);
      if (chunk.value.byteLength > remainingBytes || receivedBytes >= 500) {
        await reader.cancel("Fish Audio error payload limit reached.");
        break;
      }
    }
    const combined = new Uint8Array(receivedBytes);
    let offset = 0;
    for (const chunk of chunks) {
      combined.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return new TextDecoder().decode(combined);
  } catch {
    return "";
  } finally {
    reader.releaseLock();
  }
}

function inferMimeType(format: FishAudioFormat): string {
  if (format === "wav") return "audio/wav";
  if (format === "opus") return "audio/ogg";
  return "audio/mpeg";
}

function inferExtension(format: FishAudioFormat): string {
  return format === "opus" ? "opus" : format;
}

function retryAfterMs(response: Response): number | undefined {
  const value = response.headers.get("retry-after")?.trim();
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.round(seconds * 1000);
  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) return undefined;
  return Math.max(0, timestamp - Date.now());
}

function retryDelayMs(response: Response, attempt: number): number {
  const requestedDelay = retryAfterMs(response) ?? env.FISH_AUDIO_RETRY_BASE_MS * 2 ** attempt;
  const jitter = Math.floor(requestedDelay * Math.random() * 0.25);
  return Math.min(requestedDelay + jitter, env.FISH_AUDIO_RETRY_MAX_MS);
}

function hasExpectedAudioSignature(buffer: Buffer, format: FishAudioFormat): boolean {
  if (format === "wav") {
    return buffer.length >= 12
      && buffer.subarray(0, 4).toString("ascii") === "RIFF"
      && buffer.subarray(8, 12).toString("ascii") === "WAVE";
  }
  if (format === "opus") return buffer.length >= 4 && buffer.subarray(0, 4).toString("ascii") === "OggS";
  return buffer.length >= 3 && (
    buffer.subarray(0, 3).toString("ascii") === "ID3"
    || (buffer[0] === 0xff && ((buffer[1] ?? 0) & 0xe0) === 0xe0)
  );
}

function isExpectedMimeType(mimeType: string, format: FishAudioFormat): boolean {
  if (format === "wav") return mimeType === "audio/wav" || mimeType === "audio/x-wav" || mimeType === "audio/wave";
  if (format === "opus") return mimeType === "audio/ogg" || mimeType === "audio/opus" || mimeType === "application/ogg";
  return mimeType === "audio/mpeg" || mimeType === "audio/mp3";
}

async function readValidatedAudio(
  response: Response,
  format: FishAudioFormat,
  streamCallbacks?: TTSStreamCallbacks
): Promise<{ buffer: Buffer; mimeType: string }> {
  const contentLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > env.FISH_AUDIO_MAX_RESPONSE_BYTES) {
    throw new HttpError("Fish Audio response exceeded the configured size limit.", 502);
  }

  const responseMimeType = response.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase();
  if (responseMimeType && responseMimeType !== "application/octet-stream" && !isExpectedMimeType(responseMimeType, format)) {
    throw new HttpError("Fish Audio returned an unexpected content type.", 502);
  }
  const mimeType = responseMimeType && responseMimeType !== "application/octet-stream"
    ? responseMimeType
    : inferMimeType(format);
  const chunks: Buffer[] = [];
  const pendingStreamChunks: Buffer[] = [];
  let streamStarted = false;
  let receivedBytes = 0;
  if (response.body) {
    const reader = response.body.getReader();
    try {
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        receivedBytes += chunk.value.byteLength;
        if (receivedBytes > env.FISH_AUDIO_MAX_RESPONSE_BYTES) {
          await reader.cancel("Fish Audio response exceeded the configured size limit.");
          throw new HttpError("Fish Audio response exceeded the configured size limit.", 502);
        }
        const buffer = Buffer.from(chunk.value);
        chunks.push(buffer);
        if (streamCallbacks) {
          if (!streamStarted) {
            pendingStreamChunks.push(buffer);
            const probe = Buffer.concat(pendingStreamChunks);
            if (hasExpectedAudioSignature(probe, format)) {
              await streamCallbacks.onStart({ mimeType });
              streamStarted = true;
              for (const pendingChunk of pendingStreamChunks) await streamCallbacks.onChunk(pendingChunk);
              pendingStreamChunks.length = 0;
            }
          } else {
            await streamCallbacks.onChunk(buffer);
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }
  const buffer = Buffer.concat(chunks, receivedBytes);
  if (!hasExpectedAudioSignature(buffer, format)) {
    throw new HttpError("Fish Audio returned invalid audio data.", 502);
  }

  if (streamCallbacks && !streamStarted) {
    await streamCallbacks.onStart({ mimeType });
    for (const pendingChunk of pendingStreamChunks) await streamCallbacks.onChunk(pendingChunk);
  }
  return { buffer, mimeType };
}

function getVoiceConfig(input: TTSInput): FishAudioVoiceConfig {
  const personaConfig = input.persona.voiceProfile.fishAudio;
  const personaEnvironmentReferenceId = personaConfig?.referenceIdEnvVar
    ? process.env[personaConfig.referenceIdEnvVar]?.trim()
    : undefined;
  const referenceId = input.voiceId ?? personaEnvironmentReferenceId ?? personaConfig?.referenceId ?? env.FISH_AUDIO_REFERENCE_ID;
  const format = personaConfig?.format ?? env.FISH_AUDIO_FORMAT;
  const sampleRate = personaConfig?.sampleRate ?? (format === env.FISH_AUDIO_FORMAT
    ? env.FISH_AUDIO_SAMPLE_RATE
    : format === "opus" ? 48000 : 44100);

  return {
    ...(referenceId ? { referenceId } : {}),
    model: personaConfig?.model ?? env.FISH_AUDIO_MODEL,
    format,
    sampleRate,
    mp3Bitrate: personaConfig?.mp3Bitrate ?? env.FISH_AUDIO_MP3_BITRATE as 64 | 128 | 192,
    opusBitrate: personaConfig?.opusBitrate ?? env.FISH_AUDIO_OPUS_BITRATE as -1000 | 24000 | 32000 | 48000 | 64000,
    latency: personaConfig?.latency ?? env.FISH_AUDIO_LATENCY,
    speed: personaConfig?.speed ?? env.FISH_AUDIO_SPEED,
    volume: personaConfig?.volume ?? env.FISH_AUDIO_VOLUME,
    normalizeLoudness: personaConfig?.normalizeLoudness ?? env.FISH_AUDIO_NORMALIZE_LOUDNESS,
    normalize: personaConfig?.normalize ?? env.FISH_AUDIO_NORMALIZE,
    temperature: personaConfig?.temperature ?? env.FISH_AUDIO_TEMPERATURE,
    topP: personaConfig?.topP ?? env.FISH_AUDIO_TOP_P,
    chunkLength: personaConfig?.chunkLength ?? env.FISH_AUDIO_CHUNK_LENGTH,
    maxNewTokens: personaConfig?.maxNewTokens ?? env.FISH_AUDIO_MAX_NEW_TOKENS,
    repetitionPenalty: personaConfig?.repetitionPenalty ?? env.FISH_AUDIO_REPETITION_PENALTY,
    minChunkLength: personaConfig?.minChunkLength ?? env.FISH_AUDIO_MIN_CHUNK_LENGTH,
    conditionOnPreviousChunks: personaConfig?.conditionOnPreviousChunks ?? env.FISH_AUDIO_CONDITION_ON_PREVIOUS_CHUNKS,
    earlyStopThreshold: personaConfig?.earlyStopThreshold ?? env.FISH_AUDIO_EARLY_STOP_THRESHOLD,
    features: personaConfig?.features ?? env.FISH_AUDIO_FEATURES
  };
}

export class FishAudioTTSProvider implements TTSProvider {
  async synthesize(input: TTSInput, signal?: AbortSignal, streamCallbacks?: TTSStreamCallbacks): Promise<TTSOutput> {
    signal?.throwIfAborted();
    if (!env.FISH_AUDIO_API_KEY) throw new HttpError("Fish Audio API key is not configured.", 503);
    const text = input.text.trim();
    if (!text) throw new HttpError("No text content available for Fish Audio TTS.", 400);

    const voiceConfig = getVoiceConfig(input);
    if (!voiceConfig.referenceId) {
      throw new HttpError(`Fish Audio reference ID is not configured for persona: ${input.persona.id}.`, 503);
    }
    const requestInit: RequestInit = {
      method: "POST",
      headers: {
        accept: inferMimeType(voiceConfig.format),
        authorization: `Bearer ${env.FISH_AUDIO_API_KEY}`,
        "content-type": "application/json",
        model: voiceConfig.model
      },
      body: JSON.stringify({
        text,
        reference_id: voiceConfig.referenceId,
        format: voiceConfig.format,
        sample_rate: voiceConfig.sampleRate,
        ...(voiceConfig.format === "mp3" ? { mp3_bitrate: voiceConfig.mp3Bitrate } : {}),
        ...(voiceConfig.format === "opus" ? { opus_bitrate: voiceConfig.opusBitrate } : {}),
        latency: voiceConfig.latency,
        normalize: voiceConfig.normalize,
        prosody: {
          speed: voiceConfig.speed,
          volume: voiceConfig.volume,
          normalize_loudness: voiceConfig.normalizeLoudness
        },
        temperature: voiceConfig.temperature,
        top_p: voiceConfig.topP,
        chunk_length: voiceConfig.chunkLength,
        max_new_tokens: voiceConfig.maxNewTokens,
        repetition_penalty: voiceConfig.repetitionPenalty,
        min_chunk_length: voiceConfig.minChunkLength,
        condition_on_previous_chunks: voiceConfig.conditionOnPreviousChunks,
        early_stop_threshold: voiceConfig.earlyStopThreshold,
        ...(voiceConfig.features.length > 0 ? { features: voiceConfig.features } : {})
      })
    };

    let response: Response | undefined;
    let lastError: unknown;
    for (let attempt = 0; attempt <= env.FISH_AUDIO_MAX_RETRIES; attempt += 1) {
      try {
        response = await fetch(env.FISH_AUDIO_API_URL, {
          ...requestInit,
          signal: requestSignal(signal)
        });
        if (response.ok) break;
        const errorText = await readErrorText(response);
        lastError = new HttpError(`Fish Audio TTS failed: ${errorText || response.statusText}`, response.status);
        if (!isRetryableStatus(response.status) || attempt === env.FISH_AUDIO_MAX_RETRIES) break;
      } catch (error) {
        if (signal?.aborted) throw error;
        lastError = error;
        response = undefined;
        // A timeout or dropped connection can happen after Fish generated the
        // audio. Retrying without an idempotency guarantee risks double billing.
        break;
      }

      const delayMs = retryDelayMs(response, attempt);
      logger.warn("Retrying Fish Audio TTS request", {
        attempt: attempt + 1,
        nextAttempt: attempt + 2,
        delayMs
      });
      await sleep(delayMs, signal);
    }

    if (!response?.ok) {
      if (lastError instanceof HttpError) throw lastError;
      throw new HttpError(`Fish Audio TTS failed: ${lastError instanceof Error ? lastError.message : "Unknown error"}`, 502);
    }

    const { buffer, mimeType } = await readValidatedAudio(response, voiceConfig.format, streamCallbacks);
    const auditMetadata = ttsAuditMetadata(input, text, voiceConfig);
    const url = await generatedAudioService.register(buffer, {
      fileName: `${input.persona.id}-voice.${inferExtension(voiceConfig.format)}`,
      mimeType,
      ...(input.ownerId ? { ownerId: input.ownerId } : {}),
      ...(input.conversationId ? { conversationId: input.conversationId } : {}),
      ...(input.messageId ? { messageId: input.messageId } : {}),
      ...(auditMetadata ? { metadata: auditMetadata } : {})
    });

    return {
      provider: "fish_audio_tts",
      url,
      mimeType,
      model: voiceConfig.model,
      billableCharacters: text.length,
      billableUtf8Bytes: Buffer.byteLength(text, "utf8")
    };
  }
}
