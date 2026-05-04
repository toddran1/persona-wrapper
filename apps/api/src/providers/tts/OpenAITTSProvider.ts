import type { TTSInput, TTSOutput } from "@persona/shared";
import type { TTSProvider } from "./TTSProvider.js";

export class OpenAITTSProvider implements TTSProvider {
  async synthesize(input: TTSInput): Promise<TTSOutput> {
    return {
      provider: "openai_tts",
      url: `https://example.com/audio/${encodeURIComponent(input.persona.id)}.mp3`,
      mimeType: "audio/mpeg",
      durationMs: 4200
    };
  }
}

