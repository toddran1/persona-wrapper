import type { StyleTransferProvider } from "./StyleTransferProvider.js";
import { env } from "../../config/env.js";
import { HttpStyleTransferProvider } from "./HttpStyleTransferProvider.js";
import { StubStyleTransferProvider } from "./StubStyleTransferProvider.js";

export function createStyleTransferProvider(): StyleTransferProvider {
  switch (env.STYLE_TRANSFER_PROVIDER) {
    case "stub":
      return new StubStyleTransferProvider();
    case "local":
    case "runpod":
    case "huggingface":
      if (!env.STYLE_TRANSFER_ENDPOINT) {
        throw new Error(
          `STYLE_TRANSFER_ENDPOINT is required when STYLE_TRANSFER_PROVIDER=${env.STYLE_TRANSFER_PROVIDER}`
        );
      }

      return new HttpStyleTransferProvider({
        endpoint: env.STYLE_TRANSFER_ENDPOINT,
        provider: env.STYLE_TRANSFER_PROVIDER,
        ...(env.STYLE_TRANSFER_MODEL_ID ? { modelId: env.STYLE_TRANSFER_MODEL_ID } : {})
      });
  }
}
