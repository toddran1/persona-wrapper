import type { StyleTransferInput, StyleTransferOutput } from "@persona/shared";
import type { StyleTransferProvider } from "./StyleTransferProvider.js";

function pickCatchphrase(input: StyleTransferInput): string {
  return input.persona.catchphrases[0] ?? "Clock it.";
}

export class StubStyleTransferProvider implements StyleTransferProvider {
  async transferStyle(input: StyleTransferInput): Promise<StyleTransferOutput> {
    const styledText = `${input.neutralText} ${pickCatchphrase(input)}`;

    return {
      provider: "stub_style_transfer",
      styledText,
      metadata: {
        mode: "stub",
        personaId: input.persona.id,
        sourceProvider: input.provider,
        preservedMeaning: true
      }
    };
  }
}
