import type { LLMInput, LLMOutput } from "@persona/shared";

export interface LLMProvider {
  generateResponse(input: LLMInput): Promise<LLMOutput>;
}

