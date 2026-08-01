import type { TTSInput, TTSOutput } from "@persona/shared";

export interface TTSProvider {
  synthesize(input: TTSInput, signal?: AbortSignal): Promise<TTSOutput>;
}
