import type { LLMInput } from "@persona/shared";
import { env } from "../../config/env.js";

export type FluxImageDimensions = { width: number; height: number };

const SQUARE: FluxImageDimensions = { width: 1024, height: 1024 };
const LANDSCAPE: FluxImageDimensions = { width: 1536, height: 1024 };
const PORTRAIT: FluxImageDimensions = { width: 1024, height: 1536 };
const WIDESCREEN: FluxImageDimensions = { width: 1536, height: 864 };
const VERTICAL: FluxImageDimensions = { width: 864, height: 1536 };
const PHOTO_LANDSCAPE: FluxImageDimensions = { width: 1280, height: 960 };
const PHOTO_PORTRAIT: FluxImageDimensions = { width: 960, height: 1280 };

// Orientation hints in the request text win over the configured size, so
// follow-ups like "16:9" or "phone wallpaper" shape the FLUX output the way
// OpenAI's size parameter would.
const EXPLICIT_DIMENSION_PATTERNS: Array<[RegExp, FluxImageDimensions]> = [
  // Ratios must not be arithmetic ("4 x 3 = 12").
  [/\b16\s*[:x×]\s*9(?!\s*[=+\-*/\d])/i, WIDESCREEN],
  [/\b9\s*[:x×]\s*16(?!\s*[=+\-*/\d])/i, VERTICAL],
  [/\b4\s*[:x×]\s*3(?!\s*[=+\-*/\d])/i, PHOTO_LANDSCAPE],
  [/\b3\s*[:x×]\s*4(?!\s*[=+\-*/\d])/i, PHOTO_PORTRAIT],
  [/\b1\s*[:x×]\s*1(?!\s*[=+\-*/\d])/i, SQUARE],
  [/\b(?:landscape|widescreen|banner|wide\s+(?:shot|format|angle)|desktop\s+wallpaper)\b/i, LANDSCAPE],
  [/\b(?:portrait|vertical|phone\s+wallpaper|story\s+format)\b/i, PORTRAIT]
];

/**
 * Resolve FLUX output dimensions for a request. Explicit orientation hints in
 * the message first, then the app-wide image size setting, then the FLUX
 * defaults. All values stay within FLUX.2's limits (>=64 per side, ~4MP max).
 */
export function fluxImageDimensions(input: LLMInput): FluxImageDimensions {
  for (const [pattern, dimensions] of EXPLICIT_DIMENSION_PATTERNS) {
    if (pattern.test(input.userMessage)) return dimensions;
  }
  switch (env.OPENAI_IMAGE_SIZE) {
    case "1536x1024":
      return LANDSCAPE;
    case "1024x1536":
      return PORTRAIT;
    case "1024x1024":
      return SQUARE;
    default:
      return { width: env.BFL_IMAGE_WIDTH, height: env.BFL_IMAGE_HEIGHT };
  }
}
