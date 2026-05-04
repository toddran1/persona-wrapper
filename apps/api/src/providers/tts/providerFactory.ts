import type { ProviderId } from "@persona/shared";
import type { TTSProvider } from "./TTSProvider.js";
import { LocalTTSProvider } from "./LocalTTSProvider.js";
import { OpenAITTSProvider } from "./OpenAITTSProvider.js";

export function createTTSProvider(providerId: ProviderId): TTSProvider {
  switch (providerId) {
    case "openai":
    case "claude":
      return new OpenAITTSProvider();
    case "local":
      return new LocalTTSProvider();
  }
}

