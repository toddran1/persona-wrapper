import type { TTSInput, TTSOutput } from "@persona/shared";
import { HttpError } from "../../utils/httpError.js";
import type { TTSProvider } from "./TTSProvider.js";

export class OpenAITTSProvider implements TTSProvider {
  async synthesize(_input: TTSInput, signal?: AbortSignal): Promise<TTSOutput> {
    signal?.throwIfAborted();
    throw new HttpError(
      "The legacy OpenAI TTS adapter is not configured. Use Fish Audio, ElevenLabs, or local TTS.",
      503
    );
  }
}
