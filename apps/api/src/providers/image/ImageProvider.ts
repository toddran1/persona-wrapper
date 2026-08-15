import type { ImageProviderId } from "@persona/shared";

export type ImageReferenceInput = {
  dataBase64: string;
  mimeType: string;
};

export type ImageGenerationInput = {
  prompt: string;
  referenceImages: ImageReferenceInput[];
  width: number;
  height: number;
  seed?: number;
};

export type GeneratedImage = {
  dataBase64: string;
  mimeType: string;
};

export type ImageGenerationOutput = {
  images: GeneratedImage[];
  provider: ImageProviderId;
  metadata: Record<string, unknown>;
};

export interface ImageProvider {
  readonly providerId: ImageProviderId;
  generate(input: ImageGenerationInput, signal?: AbortSignal): Promise<ImageGenerationOutput>;
}
