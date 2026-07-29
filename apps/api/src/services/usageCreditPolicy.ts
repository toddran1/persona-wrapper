import type { ChatResponse, ContentBlock, ImageGenerationQuality } from "@persona/shared";
import { env } from "../config/env.js";

/**
 * Customer-facing credits are intentionally separate from provider dollars.
 * Keeping this translation in one place lets product pricing evolve without
 * changing the durable usage ledger or the request pipeline.
 */
const IMAGE_CREDITS_BY_QUALITY: Record<ImageGenerationQuality, number> = {
  low: 1,
  auto: 2,
  medium: 2,
  high: 8
};

export function imageGenerationCredits(
  quantity: number,
  quality: ImageGenerationQuality = env.OPENAI_IMAGE_QUALITY
): number {
  const outputs = Number.isFinite(quantity) && quantity > 0 ? Math.ceil(quantity) : 0;
  return outputs * IMAGE_CREDITS_BY_QUALITY[quality];
}

/** Reserve one output because both current OpenAI image paths request n: 1. */
export function reservedImageGenerationCredits(quality?: ImageGenerationQuality): number {
  return imageGenerationCredits(1, quality);
}

export function isBillableGeneratedImage(output: ContentBlock): boolean {
  if (output.type !== "image") return false;
  const generationSource = output.metadata?.generationSource;
  if (generationSource === "openai_image_generation" || generationSource === "stub_image_generation") {
    return true;
  }

  // Keep compatibility with direct-image responses created before the
  // generationSource marker was introduced. Code Interpreter images carry a
  // containerId and must not consume image-generation credits.
  const route = output.metadata?.route;
  return route === "images_api" || route === "images_api_edit";
}

export function billableGeneratedImageCount(response: ChatResponse): number {
  return response.outputs.filter(isBillableGeneratedImage).length;
}

export function actualImageGenerationCredits(
  response: ChatResponse,
  quality?: ImageGenerationQuality
): number {
  return imageGenerationCredits(billableGeneratedImageCount(response), quality);
}
