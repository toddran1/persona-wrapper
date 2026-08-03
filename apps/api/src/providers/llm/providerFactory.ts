import type { ProviderId } from "@persona/shared";
import type { LLMProvider } from "./LLMProvider.js";
import { ClaudeProvider } from "./ClaudeProvider.js";
import { LocalModelProvider } from "./LocalModelProvider.js";
import { OpenAIProvider } from "./OpenAIProvider.js";
import { GeminiProvider } from "./GeminiProvider.js";

export function createLLMProvider(providerId: ProviderId): LLMProvider {
  switch (providerId) {
    case "openai":
      return new OpenAIProvider({ promptMode: "full", providerId: "openai" });
    case "gemini":
      return new GeminiProvider();
    case "claude":
      return new ClaudeProvider();
    case "local":
      return new LocalModelProvider();
  }
}
