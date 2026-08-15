import type { ImageProviderId } from "@persona/shared";
import { HttpError } from "../../utils/httpError.js";
import { FluxImageProvider } from "./FluxImageProvider.js";
import type { ImageProvider } from "./ImageProvider.js";

// OpenAI image generation is not constructed here: it stays inside
// OpenAIProvider (Responses tool + direct Images API paths). This factory only
// builds standalone image providers that need their own HTTP pipeline.
export function createImageProvider(id: ImageProviderId): ImageProvider {
  switch (id) {
    case "flux":
      return new FluxImageProvider();
    default:
      throw new HttpError(`Image provider "${id}" is handled natively by its LLM provider.`, 500);
  }
}
