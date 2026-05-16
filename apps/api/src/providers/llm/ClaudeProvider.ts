import type { LLMInput, LLMOutput } from "@persona/shared";
import type { LLMProvider } from "./LLMProvider.js";
import { buildStubOutput } from "./stubScenarioBuilder.js";

export class ClaudeProvider implements LLMProvider {
  async generateResponse(input: LLMInput): Promise<LLMOutput> {
    return buildStubOutput(input, "claude", "base");
  }
}
