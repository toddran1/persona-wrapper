import type { TTSInput, TTSOutput } from "@persona/shared";
import { env } from "../../config/env.js";
import { generatedAudioService } from "../../services/generatedAudioService.js";
import { HttpError } from "../../utils/httpError.js";
import { logger } from "../../utils/logger.js";
import type { TTSProvider } from "./TTSProvider.js";

type FishAudioFormat = "mp3" | "wav" | "opus";

type FishAudioVoiceConfig = {
  referenceId?: string;
  model: "s1" | "s2-pro" | "s2.1-pro" | "s2.1-pro-free";
  format: FishAudioFormat;
  sampleRate: number;
  latency: "low" | "normal" | "balanced";
  speed: number;
  volume: number;
  temperature: number;
  topP: number;
};

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (!signal) return new Promise((resolve) => setTimeout(resolve, ms));
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

async function readValidatedAudio(response: Response, format: FishAudioFormat): Promise<{ buffer: Buffer; mimeType: string }> {
  const contentLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > env.FISH_AUDIO_MAX_RESPONSE_BYTES) {
    throw new HttpError("Fish Audio response exceeded the configured size limit.", 502);
  }

  const chunks: Buffer[] = [];
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
        chunks.push(Buffer.from(chunk.value));
      }
    } finally {
      reader.releaseLock();
    }
  }
  const buffer = Buffer.concat(chunks, receivedBytes);
  if (!hasExpectedAudioSignature(buffer, format)) {
    throw new HttpError("Fish Audio returned invalid audio data.", 502);
  }

  const responseMimeType = response.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase();
  if (responseMimeType && responseMimeType !== "application/octet-stream" && !isExpectedMimeType(responseMimeType, format)) {
    throw new HttpError("Fish Audio returned an unexpected content type.", 502);
  }
  return {
    buffer,
    mimeType: responseMimeType && responseMimeType !== "application/octet-stream"
      ? responseMimeType
      : inferMimeType(format)
  };
}

function getVoiceConfig(input: TTSInput): FishAudioVoiceConfig {
  const personaConfig = input.persona.voiceProfile.fishAudio;
  const personaEnvironmentReferenceId = personaConfig?.referenceIdEnvVar
    ? process.env[personaConfig.referenceIdEnvVar]?.trim()
    : undefined;
  const referenceId = input.voiceId ?? personaEnvironmentReferenceId ?? personaConfig?.referenceId ?? env.FISH_AUDIO_REFERENCE_ID;
  const format = personaConfig?.format ?? env.FISH_AUDIO_FORMAT;
  const sampleRate = format === env.FISH_AUDIO_FORMAT
    ? env.FISH_AUDIO_SAMPLE_RATE
    : format === "opus" ? 48000 : 44100;

  return {
    ...(referenceId ? { referenceId } : {}),
    model: personaConfig?.model ?? env.FISH_AUDIO_MODEL,
    format,
    sampleRate,
    latency: personaConfig?.latency ?? env.FISH_AUDIO_LATENCY,
    speed: personaConfig?.speed ?? env.FISH_AUDIO_SPEED,
    volume: personaConfig?.volume ?? env.FISH_AUDIO_VOLUME,
    temperature: personaConfig?.temperature ?? env.FISH_AUDIO_TEMPERATURE,
    topP: personaConfig?.topP ?? env.FISH_AUDIO_TOP_P
  };
}

export class FishAudioTTSProvider implements TTSProvider {
  async synthesize(input: TTSInput, signal?: AbortSignal): Promise<TTSOutput> {
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
        ...(voiceConfig.format === "mp3" ? { mp3_bitrate: env.FISH_AUDIO_MP3_BITRATE } : {}),
        latency: voiceConfig.latency,
        normalize: true,
        prosody: {
          speed: voiceConfig.speed,
          volume: voiceConfig.volume,
          normalize_loudness: true
        },
        temperature: voiceConfig.temperature,
        top_p: voiceConfig.topP
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

    const { buffer, mimeType } = await readValidatedAudio(response, voiceConfig.format);
    const url = await generatedAudioService.register(buffer, {
      fileName: `${input.persona.id}-voice.${inferExtension(voiceConfig.format)}`,
      mimeType,
      ...(input.ownerId ? { ownerId: input.ownerId } : {}),
      ...(input.conversationId ? { conversationId: input.conversationId } : {}),
      ...(input.messageId ? { messageId: input.messageId } : {})
    });

    return {
      provider: "fish_audio_tts",
      url,
      mimeType
    };
  }
}
