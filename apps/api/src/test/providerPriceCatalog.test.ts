import { describe, expect, it } from "vitest";
import {
  estimateAudioProviderCost,
  PROVIDER_PRICE_CARD_VERSION
} from "../services/providerPriceCatalog.js";

describe("provider audio price catalog", () => {
  it("prices Fish Audio by the exact UTF-8 payload size", () => {
    const estimate = estimateAudioProviderCost({
      provider: "fish_audio_tts",
      model: "s2.1-pro",
      textCharacters: 600,
      textUtf8Bytes: 1_000,
      estimatedAudioSeconds: 40
    });

    expect(estimate.estimatedCostUsd).toBe(0.015);
    expect(estimate.metadata).toMatchObject({
      priceCardVersion: PROVIDER_PRICE_CARD_VERSION,
      billingUnit: "utf8_bytes",
      billableQuantity: 1_000,
      rateUsd: 15,
      rateUnit: "million_utf8_bytes"
    });
  });

  it("records the Fish Audio free model without inventing provider cost", () => {
    const estimate = estimateAudioProviderCost({
      provider: "fish_audio_tts",
      model: "s2.1-pro-free",
      textCharacters: 600,
      textUtf8Bytes: 1_000,
      estimatedAudioSeconds: 40
    });

    expect(estimate.estimatedCostUsd).toBe(0);
    expect(estimate.metadata.rateUsd).toBe(0);
    expect(estimate.metadata.billableQuantity).toBe(1_000);
  });

  it("uses model-specific ElevenLabs character rates", () => {
    const flash = estimateAudioProviderCost({
      provider: "elevenlabs_tts",
      model: "eleven_flash_v2_5",
      textCharacters: 1_000,
      textUtf8Bytes: 1_000,
      estimatedAudioSeconds: 60
    });
    const v3 = estimateAudioProviderCost({
      provider: "elevenlabs_tts",
      model: "eleven_v3",
      textCharacters: 1_000,
      textUtf8Bytes: 1_000,
      estimatedAudioSeconds: 60
    });

    expect(flash.estimatedCostUsd).toBe(0.05);
    expect(v3.estimatedCostUsd).toBe(0.1);
    expect(flash.metadata.billingUnit).toBe("characters");
  });

  it("uses the corrected duration fallback only for legacy OpenAI audio", () => {
    const estimate = estimateAudioProviderCost({
      provider: "openai_tts",
      model: "legacy-openai-tts",
      textCharacters: 1_000,
      textUtf8Bytes: 1_000,
      estimatedAudioSeconds: 90
    });

    expect(estimate.estimatedCostUsd).toBe(0.0315);
    expect(estimate.metadata).toMatchObject({
      billingUnit: "audio_seconds",
      rateUsd: 0.021,
      rateUnit: "minute"
    });
  });

  it("keeps local speech measurable while assigning zero provider cost", () => {
    const estimate = estimateAudioProviderCost({
      provider: "local_tts",
      model: "local",
      textCharacters: 1_000,
      textUtf8Bytes: 1_000,
      estimatedAudioSeconds: 60
    });

    expect(estimate.estimatedCostUsd).toBe(0);
    expect(estimate.metadata.billingUnit).toBe("none");
  });
});
