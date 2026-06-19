import type { ProviderId } from "@persona/shared";
import type { LLMProvider } from "./LLMProvider.js";
import { ClaudeProvider } from "./ClaudeProvider.js";
import { LocalModelProvider } from "./LocalModelProvider.js";
import { OpenAIProvider } from "./OpenAIProvider.js";

export function createLLMProvider(providerId: ProviderId): LLMProvider {
  switch (providerId) {
    case "openai":
      return new OpenAIProvider({ promptMode: "base", providerId: "openai" });
    case "openai_persona":
      return new OpenAIProvider({ promptMode: "full", providerId: "openai_persona" });
    case "claude":
      return new ClaudeProvider();
    case "local":
      return new LocalModelProvider();
  }
}
