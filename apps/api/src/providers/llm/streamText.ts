import type { LLMStreamCallbacks } from "./LLMProvider.js";

/**
 * Gives deterministic/stub providers the same incremental callback contract
 * as network-backed providers without adding artificial delays to API tests.
 */
export function emitTextChunks(text: string, callbacks: LLMStreamCallbacks, chunkSize = 64): void {
  if (!text) return;
  for (let offset = 0; offset < text.length; offset += chunkSize) {
    callbacks.onTextDelta(text.slice(offset, offset + chunkSize));
  }
}
