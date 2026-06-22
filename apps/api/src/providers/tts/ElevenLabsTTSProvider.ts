import type { TTSInput, TTSOutput } from "@persona/shared";
import { env } from "../../config/env.js";
import { generatedAudioService } from "../../services/generatedAudioService.js";
import { HttpError } from "../../utils/httpError.js";
import type { TTSProvider } from "./TTSProvider.js";

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

export class ElevenLabsTTSProvider implements TTSProvider {
  async synthesize(input: TTSInput): Promise<TTSOutput> {
    const voiceId = input.voiceId ?? env.ELEVENLABS_VOICE_ID;
    if (!env.ELEVENLABS_API_KEY) throw new HttpError("ElevenLabs API key is not configured.", 503);
    if (!voiceId) throw new HttpError("ElevenLabs voice ID is not configured.", 503);

    const endpoint = new URL(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}`);
    endpoint.searchParams.set("output_format", env.ELEVENLABS_OUTPUT_FORMAT);

    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        accept: "audio/mpeg",
        "content-type": "application/json",
        "xi-api-key": env.ELEVENLABS_API_KEY
      },
      body: JSON.stringify({
        text: input.text,
        model_id: env.ELEVENLABS_MODEL_ID,
        voice_settings: {
          stability: env.ELEVENLABS_STABILITY,
          similarity_boost: env.ELEVENLABS_SIMILARITY_BOOST,
          style: env.ELEVENLABS_STYLE,
          use_speaker_boost: env.ELEVENLABS_USE_SPEAKER_BOOST
        }
      })
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => "");
      throw new HttpError(`ElevenLabs TTS failed: ${errorText || response.statusText}`, response.status);
    }

    const mimeType = response.headers.get("content-type")?.split(";")[0] ?? inferMimeType(env.ELEVENLABS_OUTPUT_FORMAT);
    const extension = inferExtension(mimeType);
    const buffer = Buffer.from(await response.arrayBuffer());
    const url = generatedAudioService.register(buffer, {
      fileName: `${input.persona.id}-voice.${extension}`,
      mimeType
    });

    return {
      provider: "elevenlabs_tts",
      url,
      mimeType
    };
  }
}
