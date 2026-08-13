import type { PersonaDefinition } from "@persona/shared";
import { env } from "../config/env.js";

export const PROVIDER_PRICE_CARD_VERSION = 1;

export type AudioBillingInput = {
  provider: "fish_audio_tts" | "elevenlabs_tts" | "local_tts" | "openai_tts";
  model: string;
  textCharacters: number;
  textUtf8Bytes: number;
  estimatedAudioSeconds?: number;
};

export type AudioBillingEstimate = {
  estimatedCostUsd: number;
  metadata: {
    priceCardVersion: number;
    provider: AudioBillingInput["provider"];
    model: string;
    billingUnit: "utf8_bytes" | "characters" | "audio_seconds" | "none";
    billableQuantity: number;
    rateUsd: number;
    rateUnit: "million_utf8_bytes" | "thousand_characters" | "minute" | "none";
  };
};

function finiteNonnegative(value: number | undefined): number {
  return value !== undefined && Number.isFinite(value) && value > 0 ? value : 0;
}

function roundedUsd(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function isElevenLabsFlashOrTurbo(model: string): boolean {
  const normalized = model.toLowerCase();
  return normalized.includes("flash") || normalized.includes("turbo");
}

export function estimateAudioProviderCost(input: AudioBillingInput): AudioBillingEstimate {
  const textCharacters = Math.ceil(finiteNonnegative(input.textCharacters));
  const textUtf8Bytes = Math.ceil(finiteNonnegative(input.textUtf8Bytes));
  if (input.provider === "fish_audio_tts") {
    const rateUsd = input.model === "s2.1-pro-free" ? 0 : 15;
    return {
      estimatedCostUsd: roundedUsd((textUtf8Bytes / 1_000_000) * rateUsd),
      metadata: {
        priceCardVersion: PROVIDER_PRICE_CARD_VERSION,
        provider: input.provider,
        model: input.model,
        billingUnit: "utf8_bytes",
        billableQuantity: textUtf8Bytes,
        rateUsd,
        rateUnit: "million_utf8_bytes"
      }
    };
  }
  if (input.provider === "elevenlabs_tts") {
    const rateUsd = isElevenLabsFlashOrTurbo(input.model) ? 0.05 : 0.1;
    return {
      estimatedCostUsd: roundedUsd((textCharacters / 1_000) * rateUsd),
      metadata: {
        priceCardVersion: PROVIDER_PRICE_CARD_VERSION,
        provider: input.provider,
        model: input.model,
        billingUnit: "characters",
        billableQuantity: textCharacters,
        rateUsd,
        rateUnit: "thousand_characters"
      }
    };
  }
  if (input.provider === "local_tts") {
    return {
      estimatedCostUsd: 0,
      metadata: {
        priceCardVersion: PROVIDER_PRICE_CARD_VERSION,
        provider: input.provider,
        model: input.model,
        billingUnit: "none",
        billableQuantity: 0,
        rateUsd: 0,
        rateUnit: "none"
      }
    };
  }
  const audioSeconds = finiteNonnegative(input.estimatedAudioSeconds);
  return {
    estimatedCostUsd: roundedUsd((audioSeconds / 60) * env.CUSTOMER_USAGE_AUDIO_COST_PER_MINUTE_USD),
    metadata: {
      priceCardVersion: PROVIDER_PRICE_CARD_VERSION,
      provider: input.provider,
      model: input.model,
      billingUnit: "audio_seconds",
      billableQuantity: Math.ceil(audioSeconds),
      rateUsd: env.CUSTOMER_USAGE_AUDIO_COST_PER_MINUTE_USD,
      rateUnit: "minute"
    }
  };
}

export function configuredAudioBillingInput(
  persona: PersonaDefinition,
  textCharacters: number,
  estimatedAudioSeconds: number,
  textUtf8Bytes = textCharacters
): AudioBillingInput {
  if (env.APP_TEST_MODE || env.TTS_PROVIDER === "local") {
    return {
      provider: "local_tts",
      model: "local",
      textCharacters,
      textUtf8Bytes,
      estimatedAudioSeconds
    };
  }
  if (env.TTS_PROVIDER === "fish_audio") {
    return {
      provider: "fish_audio_tts",
      model: persona.voiceProfile.fishAudio?.model ?? env.FISH_AUDIO_MODEL,
      textCharacters,
      textUtf8Bytes,
      estimatedAudioSeconds
    };
  }
  if (env.TTS_PROVIDER === "elevenlabs") {
    return {
      provider: "elevenlabs_tts",
      model: persona.voiceProfile.elevenLabs?.modelId ?? env.ELEVENLABS_MODEL_ID,
      textCharacters,
      textUtf8Bytes,
      estimatedAudioSeconds
    };
  }
  return {
    provider: "openai_tts",
    model: "legacy-openai-tts",
    textCharacters,
    textUtf8Bytes,
    estimatedAudioSeconds
  };
}

export function resolvedAudioBillingInput(
  persona: PersonaDefinition,
  input: {
    provider?: string;
    model?: string;
    textCharacters: number;
    textUtf8Bytes: number;
    estimatedAudioSeconds: number;
  }
): AudioBillingInput {
  const configured = configuredAudioBillingInput(
    persona,
    input.textCharacters,
    input.estimatedAudioSeconds,
    input.textUtf8Bytes
  );
  const provider = input.provider === "fish_audio_tts"
    || input.provider === "elevenlabs_tts"
    || input.provider === "local_tts"
    || input.provider === "openai_tts"
    ? input.provider
    : configured.provider;
  return {
    ...configured,
    provider,
    model: input.model?.trim() || configured.model
  };
}
