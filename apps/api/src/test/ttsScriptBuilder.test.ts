import { describe, expect, it } from "vitest";
import { getPersonaById } from "../personas/index.js";
import { buildTtsScript, buildTtsScriptForSpeech } from "../services/ttsScriptBuilder.js";

const larae = getPersonaById("larae")!;

describe("buildTtsScript", () => {
  it("creates a hidden speech script without markdown or raw links", () => {
    const script = buildTtsScript(
      "Dallas, **TX** is loud as hell. [Source](https://example.com). `API` notes.",
      larae
    );

    expect(script).toContain("Dallas, Texas");
    expect(script).toContain("A.P.I.");
    expect(script).not.toContain("**");
    expect(script).not.toContain("https://example.com");
  });

  it("preserves natural punctuation without adding repeated pauses or commas", () => {
    const script = buildTtsScript("Baby, let me set this off. Clock it.", larae);

    expect(script).toContain("Baby, let me set this off.");
    expect(script).toContain("Clock it");
    expect(script).not.toContain("Baby,,");
    expect(script).not.toContain("...");
  });

  it("normalizes common speech-hostile tokens before sending to ElevenLabs", () => {
    const script = buildTtsScript(
      "Meet at 8:00 PM with a $25 budget, 42% confidence, 5GB file, and this URL: https://example.com/test.",
      larae
    );

    expect(script).toContain("8 o'clock P.M.");
    expect(script).toContain("25 dollars");
    expect(script).toContain("42 percent");
    expect(script).toContain("5 gigabytes");
    expect(script).not.toContain("https://example.com/test");
  });

  it("uses mechanical mode when no inline OpenAI TTS script is available", async () => {
    const result = await buildTtsScriptForSpeech("Dallas, **TX** is loud.", larae);

    expect(result.mode).toBe("mechanical");
    expect(result.script).toContain("Dallas, Texas");
  });
});
