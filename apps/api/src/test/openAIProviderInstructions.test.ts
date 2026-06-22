import { describe, expect, it } from "vitest";
import type { LLMInput } from "@persona/shared";
import { getPersonaById } from "../personas/index.js";
import { PersonaEngine } from "../services/personaEngine.js";
import { buildOpenAIResponseInstructions } from "../providers/llm/OpenAIProvider.js";
import { env } from "../config/env.js";

function inputForLaRae(audio = false): LLMInput {
  const persona = getPersonaById("larae");
  if (!persona) throw new Error("LaRae persona not found");
  return new PersonaEngine().prepareInput(persona, {
    personaId: "larae",
    provider: "openai_persona",
    message: "Introduce yourself.",
    audio,
    testMode: false,
    history: []
  });
}

describe("OpenAIProvider instructions", () => {
  it("adds strengthened LaRae performance direction only for direct persona mode", () => {
    const input = inputForLaRae();
    const directInstructions = buildOpenAIResponseInstructions(input, "full");
    const baseInstructions = buildOpenAIResponseInstructions(input, "base");

    expect(directInstructions).toContain("OpenAI direct persona performance direction");
    expect(directInstructions).toContain("Use heavy slang, profanity, attitude, and reality-TV confessional energy");
    expect(directInstructions).toContain("Use heavy HEAVY slang and profanity");
    expect(directInstructions).toContain("Bitch, Nigga, Bitches, Niggas, Fucking, Fuck, Hoe, Hoes, Baddies");
    expect(directInstructions).toContain("It should almost feel like it cannot be enough");
    expect(directInstructions).toContain("LaRae is an adults-only persona");
    expect(directInstructions).toContain("do not make the answer child-safe");
    expect(directInstructions).toContain("ratchet, messy, funny, loud");
    expect(directInstructions).toContain("funnier and sassier than a normal assistant");
    expect(directInstructions).toContain("quick jokes, side-eye, playful reads");
    expect(directInstructions).toContain("Did I add humor, sass, side-eye, and quick punchlines?");
    expect(directInstructions).toContain("Avoid sounding sanitized");
    expect(directInstructions).toContain("Style density requirement");
    expect(directInstructions).toContain("Silent style checklist before finalizing");
    expect(directInstructions).toContain("Do not print the checklist");
    expect(directInstructions).toContain("Every paragraph, bullet, numbered item, and transition should carry noticeable LaRae voice");
    expect(directInstructions).toContain("Do not drift into neutral assistant prose after the opening");
    expect(directInstructions).toContain("Do not become generic, corporate, polished, or therapist-clean");
    expect(baseInstructions).not.toContain("OpenAI direct persona performance direction");
    expect(baseInstructions).not.toContain("Use heavy slang, profanity, attitude, and reality-TV confessional energy");
    expect(baseInstructions).not.toContain("Use heavy HEAVY slang and profanity");
    expect(baseInstructions).not.toContain("LaRae is an adults-only persona");
    expect(baseInstructions).not.toContain("Style density requirement");
    expect(baseInstructions).not.toContain("Silent style checklist before finalizing");
  });

  it("requests visible text and hidden TTS script in one response when audio mode is enabled", () => {
    const original = env.OPENAI_TTS_SCRIPT_ENABLED;
    env.OPENAI_TTS_SCRIPT_ENABLED = true;

    const input = inputForLaRae(true);
    const directInstructions = buildOpenAIResponseInstructions(input, "full");

    expect(directInstructions).toContain("Audio response format requirement");
    expect(directInstructions).toContain("\"visible_text\":\"normal response for the UI\"");
    expect(directInstructions).toContain("\"tts_script\":\"ElevenLabs-optimized narration script\"");
    expect(directInstructions).toContain("visible_text is the normal user-facing answer");
    expect(directInstructions).toContain("tts_script is hidden and will be sent only to ElevenLabs");
    expect(directInstructions).toContain("it should NOT simply copy visible_text");
    expect(directInstructions).toContain("performance-ready narration script");
    expect(directInstructions).toContain("normalize text for speech");
    expect(directInstructions).toContain("add natural speech pacing");
    expect(directInstructions).toContain("carry emotion through word choice and punctuation");
    expect(directInstructions).toContain("non-v3 ElevenLabs Flash-style model");
    expect(directInstructions).toContain("<break time=\"0.4s\" />");
    expect(directInstructions).toContain("Flash v2.5 delivery");
    expect(directInstructions).toContain("phonetic emotion and punctuation physics");
    expect(directInstructions).toContain("Haha, Heh, Ahaha!, HA!, or Oh, pfft");
    expect(directInstructions).toContain("Ugh..., Oh... god..., *sniff*, or No... no...");
    expect(directInstructions).toContain("ellipses (...) and long dashes");
    expect(directInstructions).toContain("ALL CAPS");
    expect(directInstructions).toContain("Use ?!");
    expect(directInstructions).toContain("Listen..., Look—, Baby..., or Bitch—");
    expect(directInstructions).toContain("<break time=\"0.3s\" />");

    env.OPENAI_TTS_SCRIPT_ENABLED = original;
  });
});
