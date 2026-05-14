import type { StyleTransferInput, StyleTransferOutput } from "@persona/shared";
import type { StyleTransferProvider } from "./StyleTransferProvider.js";

type HttpStyleTransferProviderId = "local" | "runpod" | "huggingface";

interface HttpStyleTransferProviderOptions {
  endpoint: string;
  provider: HttpStyleTransferProviderId;
  modelId?: string;
}

interface HttpStyleTransferResponse {
  styledText?: unknown;
  metadata?: unknown;
}

export class HttpStyleTransferProvider implements StyleTransferProvider {
  constructor(private readonly options: HttpStyleTransferProviderOptions) {}

  async transferStyle(input: StyleTransferInput): Promise<StyleTransferOutput> {
    const response = await fetch(this.options.endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({
        neutralText: input.neutralText,
        personaId: input.persona.id,
        userMessage: input.userMessage,
        conversationHistory: input.conversationHistory,
        sourceProvider: input.provider,
        modelId: this.options.modelId
      })
    });

    if (!response.ok) {
      throw new Error(`Style transfer request failed with status ${response.status}`);
    }

    const payload = (await response.json()) as HttpStyleTransferResponse;
    if (typeof payload.styledText !== "string" || payload.styledText.trim().length === 0) {
      throw new Error("Style transfer response must include a non-empty styledText string");
    }

    return {
      provider: this.options.provider === "local" ? "local_style_transfer" : "remote_style_transfer",
      styledText: payload.styledText,
      metadata: {
        provider: this.options.provider,
        modelId: this.options.modelId,
        ...(isRecord(payload.metadata) ? payload.metadata : {})
      }
    };
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
