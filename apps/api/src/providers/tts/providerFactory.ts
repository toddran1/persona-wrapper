import type { ProviderId } from "@persona/shared";
import { env } from "../../config/env.js";
import { ElevenLabsTTSProvider } from "./ElevenLabsTTSProvider.js";
import type { TTSProvider } from "./TTSProvider.js";
import { LocalTTSProvider } from "./LocalTTSProvider.js";
import { OpenAITTSProvider } from "./OpenAITTSProvider.js";

export function createTTSProvider(providerId: ProviderId): TTSProvider {
  if (env.TTS_PROVIDER === "elevenlabs") return new ElevenLabsTTSProvider();
  if (env.TTS_PROVIDER === "local") return new LocalTTSProvider();

  switch (providerId) {
    case "openai":
    case "openai_persona":
    case "claude":
      return new OpenAITTSProvider();
    case "local":
      return new LocalTTSProvider();
  }
}
