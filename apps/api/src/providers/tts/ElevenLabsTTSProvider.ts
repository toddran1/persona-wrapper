import type { TTSInput, TTSOutput } from "@persona/shared";
import { env } from "../../config/env.js";
import { generatedAudioService } from "../../services/generatedAudioService.js";
import { HttpError } from "../../utils/httpError.js";
import { logger } from "../../utils/logger.js";
import type { TTSProvider } from "./TTSProvider.js";

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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 409 || status === 425 || status === 429 || status >= 500;
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
  if (personaConfig?.voiceId) {
    config.voiceId = personaConfig.voiceId;
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
  async synthesize(input: TTSInput): Promise<TTSOutput> {
    const voiceConfig = getVoiceConfig(input);
    const voiceId = input.voiceId ?? voiceConfig.voiceId ?? env.ELEVENLABS_VOICE_ID;
    if (!env.ELEVENLABS_API_KEY) throw new HttpError("ElevenLabs API key is not configured.", 503);
    if (!voiceId) throw new HttpError("ElevenLabs voice ID is not configured.", 503);
    const text = input.text.trim();
    if (!text) throw new HttpError("No text content available for ElevenLabs TTS.", 400);

    const endpoint = new URL(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}`);
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
        response = await fetch(endpoint, requestInit);
        if (response.ok) break;
        const errorText = await readErrorText(response);
        lastError = new HttpError(`ElevenLabs TTS failed: ${errorText || response.statusText}`, response.status);
        if (!isRetryableStatus(response.status) || attempt === env.ELEVENLABS_MAX_RETRIES) break;
      } catch (error) {
        lastError = error;
        if (attempt === env.ELEVENLABS_MAX_RETRIES) break;
      }

      const delayMs = env.ELEVENLABS_RETRY_BASE_MS * 2 ** attempt;
      logger.warn("Retrying ElevenLabs TTS request", {
        attempt: attempt + 1,
        nextAttempt: attempt + 2,
        delayMs
      });
      await sleep(delayMs);
    }

    if (!response?.ok) {
      if (lastError instanceof HttpError) throw lastError;
      throw new HttpError(`ElevenLabs TTS failed: ${lastError instanceof Error ? lastError.message : "Unknown error"}`, 502);
    }

    const mimeType = response.headers.get("content-type")?.split(";")[0] ?? inferMimeType(voiceConfig.outputFormat);
    const extension = inferExtension(mimeType);
    const buffer = Buffer.from(await response.arrayBuffer());
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
      mimeType
    };
  }
}
