import { describe, expect, it } from "vitest";
import { env } from "../config/env.js";
import {
  audioUsageReservationSeconds,
  estimatedAudioSecondsForCharacters,
  limitAudioResponseText,
  maxOutputTokensForRequest
} from "../services/audioResponsePolicy.js";

describe("audio response policy", () => {
  it("keeps short responses unchanged", () => {
    expect(limitAudioResponseText("Short answer.")).toBe("Short answer.");
  });

  it("limits long responses at a readable boundary", () => {
    const response = `${"This is a complete sentence. ".repeat(80)}Final detail.`;
    const limited = limitAudioResponseText(response);

    expect(limited.length).toBeLessThanOrEqual(env.CHAT_AUDIO_MAX_RESPONSE_CHARACTERS);
    expect(limited.endsWith("…")).toBe(true);
  });

  it("leaves long responses intact when concise audio is disabled", () => {
    const response = "Long-form answer. ".repeat(200);
    expect(limitAudioResponseText(response, false)).toBe(response.trim());
  });

  it("reserves more time than the expected capped narration", () => {
    const expectedSeconds = estimatedAudioSecondsForCharacters(env.CHAT_AUDIO_MAX_RESPONSE_CHARACTERS);

    expect(audioUsageReservationSeconds()).toBeGreaterThan(expectedSeconds);
    expect(audioUsageReservationSeconds()).toBeLessThanOrEqual(Math.ceil(expectedSeconds * 1.2));
  });

  it("keeps the full model budget for reasoning even when concise audio is enabled", () => {
    expect(maxOutputTokensForRequest(false)).toBe(env.OPENAI_MAX_OUTPUT_TOKENS);
    expect(maxOutputTokensForRequest(true)).toBe(env.OPENAI_MAX_OUTPUT_TOKENS);
    expect(maxOutputTokensForRequest(true, false)).toBe(env.OPENAI_MAX_OUTPUT_TOKENS);
    expect(audioUsageReservationSeconds(false)).toBeGreaterThan(audioUsageReservationSeconds(true));
  });

  it("raises the output budget for code interpreter requests", () => {
    expect(maxOutputTokensForRequest(false, true, true)).toBe(
      Math.max(env.OPENAI_MAX_OUTPUT_TOKENS, env.OPENAI_CODE_INTERPRETER_MAX_OUTPUT_TOKENS)
    );
    // Audio's concise cap must not strangle code interpreter turns.
    expect(maxOutputTokensForRequest(true, true, true)).toBe(
      Math.max(env.OPENAI_MAX_OUTPUT_TOKENS, env.OPENAI_CODE_INTERPRETER_MAX_OUTPUT_TOKENS)
    );
  });
});
