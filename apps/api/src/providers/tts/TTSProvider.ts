import type { TTSInput, TTSOutput } from "@persona/shared";

export type TTSStreamCallbacks = {
  onStart: (event: { mimeType: string }) => void | Promise<void>;
  onChunk: (chunk: Uint8Array) => void | Promise<void>;
};

export interface TTSProvider {
  synthesize(input: TTSInput, signal?: AbortSignal, streamCallbacks?: TTSStreamCallbacks): Promise<TTSOutput>;
}
