import type { LLMInput, LLMOutput } from "@persona/shared";
import type { LLMProvider, LLMStreamCallbacks } from "./LLMProvider.js";
import { emitTextChunks } from "./streamText.js";
import { buildStubOutput } from "./stubScenarioBuilder.js";

export class ClaudeProvider implements LLMProvider {
  async generateResponse(input: LLMInput): Promise<LLMOutput> {
    return buildStubOutput(input, "claude", "base");
  }

  async generateResponseStream(input: LLMInput, callbacks: LLMStreamCallbacks): Promise<LLMOutput> {
    const output = await this.generateResponse(input);
    emitTextChunks(output.rawText, callbacks);
    return output;
  }
}
