import type { TTSInput, TTSOutput } from "@persona/shared";
import { env } from "../../config/env.js";
import { generatedAudioService } from "../../services/generatedAudioService.js";
import { HttpError } from "../../utils/httpError.js";
import { logger } from "../../utils/logger.js";
import type { TTSProvider, TTSStreamCallbacks } from "./TTSProvider.js";

type ElevenLabsVoiceConfig = {
  voiceId?: string;
  modelId: string;
  outputFormat: string;
  speed: number;
  stability: number;
  similarityBoost: number;
  style: number;
  useSpeakerBoost: boolean;
};

function inferMimeType(outputFormat: string): string {
  if (outputFormat.startsWith("pcm_")) return "audio/wav";
  if (outputFormat.startsWith("ulaw_")) return "audio/basic";
  return "audio/mpeg";
}

function inferExtension(mimeType: string): string {
  if (mimeType === "audio/wav") return "wav";
  if (mimeType === "audio/basic") return "ulaw";
  return "mp3";
}

function isExpectedAudioContentType(mimeType: string): boolean {
  return mimeType.startsWith("audio/") || mimeType === "application/octet-stream";
}

function hasMp3Signature(buffer: Buffer): boolean {
  return buffer.length >= 3 && (
    buffer.subarray(0, 3).toString("ascii") === "ID3"
    || (buffer[0] === 0xff && ((buffer[1] ?? 0) & 0xe0) === 0xe0)
  );
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
  // The synthesis endpoint has no idempotency key. Retry only responses that
  // explicitly indicate processing did not begin; retrying an ambiguous 5xx,
  // timeout, or dropped connection can create a second billable generation.
  return status === 425 || status === 429;
}

async function readErrorText(response: Response): Promise<string> {
  return (await response.text().catch(() => "")).slice(0, 500);
}

function supportsExpressiveVoiceSettings(modelId: string): boolean {
  return modelId === "eleven_multilingual_v2";
}

function getVoiceConfig(input: TTSInput): ElevenLabsVoiceConfig {
  const personaConfig = input.persona.voiceProfile.elevenLabs;
  const config: ElevenLabsVoiceConfig = {
    modelId: personaConfig?.modelId ?? env.ELEVENLABS_MODEL_ID,
    outputFormat: personaConfig?.outputFormat ?? env.ELEVENLABS_OUTPUT_FORMAT,
    speed: personaConfig?.speed ?? env.ELEVENLABS_SPEED,
    stability: personaConfig?.stability ?? env.ELEVENLABS_STABILITY,
    similarityBoost: personaConfig?.similarityBoost ?? env.ELEVENLABS_SIMILARITY_BOOST,
    style: personaConfig?.style ?? env.ELEVENLABS_STYLE,
    useSpeakerBoost: personaConfig?.useSpeakerBoost ?? env.ELEVENLABS_USE_SPEAKER_BOOST
  };
  const personaEnvironmentVoiceId = personaConfig?.voiceIdEnvVar
    ? process.env[personaConfig.voiceIdEnvVar]?.trim()
    : undefined;
  const resolvedVoiceId = personaEnvironmentVoiceId || personaConfig?.voiceId;
  if (resolvedVoiceId) {
    config.voiceId = resolvedVoiceId;
  }
  return config;
}

function buildVoiceSettings(config: ElevenLabsVoiceConfig): Record<string, number | boolean> {
  const voiceSettings: Record<string, number | boolean> = {
    speed: config.speed,
    stability: config.stability,
    similarity_boost: config.similarityBoost
  };

  if (supportsExpressiveVoiceSettings(config.modelId)) {
    voiceSettings.style = config.style;
    if (config.useSpeakerBoost) {
      voiceSettings.use_speaker_boost = true;
    }
  }

  return voiceSettings;
}

export class ElevenLabsTTSProvider implements TTSProvider {
  async synthesize(input: TTSInput, signal?: AbortSignal, streamCallbacks?: TTSStreamCallbacks): Promise<TTSOutput> {
    signal?.throwIfAborted();
    const voiceConfig = getVoiceConfig(input);
    const voiceId = input.voiceId ?? voiceConfig.voiceId ?? env.ELEVENLABS_VOICE_ID;
    if (!env.ELEVENLABS_API_KEY) throw new HttpError("ElevenLabs API key is not configured.", 503);
    if (!voiceId) throw new HttpError("ElevenLabs voice ID is not configured.", 503);
    const text = input.text.trim();
    if (!text) throw new HttpError("No text content available for ElevenLabs TTS.", 400);

    const endpoint = new URL(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}${streamCallbacks ? "/stream" : ""}`);
    endpoint.searchParams.set("output_format", voiceConfig.outputFormat);

    const requestInit: RequestInit = {
      method: "POST",
      headers: {
        accept: "audio/mpeg",
        "content-type": "application/json",
        "xi-api-key": env.ELEVENLABS_API_KEY
      },
      body: JSON.stringify({
        text,
        model_id: voiceConfig.modelId,
        voice_settings: buildVoiceSettings(voiceConfig)
      })
    };

    let response: Response | undefined;
    let lastError: unknown;
    for (let attempt = 0; attempt <= env.ELEVENLABS_MAX_RETRIES; attempt += 1) {
      try {
        response = await fetch(endpoint, {
          ...requestInit,
          signal: requestSignal(signal)
        });
        if (response.ok) break;
        const errorText = await readErrorText(response);
        lastError = new HttpError(`ElevenLabs TTS failed: ${errorText || response.statusText}`, response.status);
        if (!isRetryableStatus(response.status) || attempt === env.ELEVENLABS_MAX_RETRIES) break;
      } catch (error) {
        if (signal?.aborted) throw error;
        lastError = error;
        // A transport failure can happen after ElevenLabs accepted the body.
        // Stop here because there is no safe idempotency guarantee.
        response = undefined;
        break;
      }

      const delayMs = env.ELEVENLABS_RETRY_BASE_MS * 2 ** attempt;
      logger.warn("Retrying ElevenLabs TTS request", {
        attempt: attempt + 1,
        nextAttempt: attempt + 2,
        delayMs
      });
      await sleep(delayMs, signal);
    }

    if (!response?.ok) {
      if (lastError instanceof HttpError) throw lastError;
      throw new HttpError(`ElevenLabs TTS failed: ${lastError instanceof Error ? lastError.message : "Unknown error"}`, 502);
    }

    const responseMimeType = response.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase();
    if (responseMimeType && !isExpectedAudioContentType(responseMimeType)) {
      throw new HttpError(`ElevenLabs returned an unexpected content type: ${responseMimeType}`, 502);
    }
    const mimeType = responseMimeType && responseMimeType !== "application/octet-stream"
      ? responseMimeType
      : inferMimeType(voiceConfig.outputFormat);
    const extension = inferExtension(mimeType);
    const chunks: Buffer[] = [];
    let receivedBytes = 0;
    let streamStarted = false;
    const pendingStreamChunks: Buffer[] = [];
    if (response.body) {
      const reader = response.body.getReader();
      try {
        while (true) {
          const chunk = await reader.read();
          if (chunk.done) break;
          receivedBytes += chunk.value.byteLength;
          if (receivedBytes > env.ELEVENLABS_MAX_RESPONSE_BYTES) {
            await reader.cancel("ElevenLabs response exceeded the configured size limit.");
            throw new HttpError("ElevenLabs response exceeded the configured size limit.", 502);
          }
          const buffer = Buffer.from(chunk.value);
          chunks.push(buffer);
          if (streamCallbacks) {
            if (!streamStarted && mimeType === "audio/mpeg") {
              pendingStreamChunks.push(buffer);
              if (hasMp3Signature(Buffer.concat(pendingStreamChunks))) {
                await streamCallbacks.onStart({ mimeType });
                streamStarted = true;
                for (const pendingChunk of pendingStreamChunks) await streamCallbacks.onChunk(pendingChunk);
                pendingStreamChunks.length = 0;
              }
            } else {
              if (!streamStarted) {
                await streamCallbacks.onStart({ mimeType });
                streamStarted = true;
              }
              await streamCallbacks.onChunk(buffer);
            }
          }
        }
      } finally {
        reader.releaseLock();
      }
    }
    const buffer = Buffer.concat(chunks, receivedBytes);
    if (buffer.byteLength === 0) throw new HttpError("ElevenLabs returned empty audio data.", 502);
    if (mimeType === "audio/mpeg" && !hasMp3Signature(buffer)) {
      throw new HttpError("ElevenLabs returned invalid audio data.", 502);
    }
    if (streamCallbacks && !streamStarted) {
      await streamCallbacks.onStart({ mimeType });
      for (const pendingChunk of pendingStreamChunks) await streamCallbacks.onChunk(pendingChunk);
    }
    const url = await generatedAudioService.register(buffer, {
      fileName: `${input.persona.id}-voice.${extension}`,
      mimeType,
      ...(input.ownerId ? { ownerId: input.ownerId } : {}),
      ...(input.conversationId ? { conversationId: input.conversationId } : {}),
      ...(input.messageId ? { messageId: input.messageId } : {})
    });

    return {
      provider: "elevenlabs_tts",
      url,
      mimeType,
      model: voiceConfig.modelId,
      billableCharacters: text.length,
      billableUtf8Bytes: Buffer.byteLength(text, "utf8")
    };
  }
}
