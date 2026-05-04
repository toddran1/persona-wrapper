import type { TTSInput, TTSOutput } from "@persona/shared";
import type { TTSProvider } from "./TTSProvider.js";

export class LocalTTSProvider implements TTSProvider {
  async synthesize(input: TTSInput): Promise<TTSOutput> {
    return {
      provider: "local_tts",
      url: `https://example.com/local-audio/${encodeURIComponent(input.persona.id)}.wav`,
      mimeType: "audio/wav",
      durationMs: 3900
    };
  }
}

