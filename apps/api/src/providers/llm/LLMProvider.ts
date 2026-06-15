import type { LLMInput, LLMOutput } from "@persona/shared";

export type LLMStreamCallbacks = {
  onTextDelta: (delta: string) => void;
};

export interface LLMProvider {
  generateResponse(input: LLMInput, signal?: AbortSignal): Promise<LLMOutput>;
  generateResponseStream?(input: LLMInput, callbacks: LLMStreamCallbacks, signal?: AbortSignal): Promise<LLMOutput>;
}
