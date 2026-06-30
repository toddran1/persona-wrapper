import type { LLMInput, LLMOutput } from "@persona/shared";

export type LLMStreamCallbacks = {
  onTextDelta: (delta: string) => void;
};

export type LLMProgressCallbacks = {
  onProviderResponse?: (event: { id: string; status?: string }) => void;
};

export interface LLMProvider {
  generateResponse(input: LLMInput, signal?: AbortSignal, progressCallbacks?: LLMProgressCallbacks): Promise<LLMOutput>;
  generateResponseStream?(
    input: LLMInput,
    callbacks: LLMStreamCallbacks,
    signal?: AbortSignal,
    progressCallbacks?: LLMProgressCallbacks
  ): Promise<LLMOutput>;
}
