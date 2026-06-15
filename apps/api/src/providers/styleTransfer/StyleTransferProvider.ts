import type { StyleTransferInput, StyleTransferOutput } from "@persona/shared";

export interface StyleTransferProvider {
  transferStyle(input: StyleTransferInput, signal?: AbortSignal): Promise<StyleTransferOutput>;
}
