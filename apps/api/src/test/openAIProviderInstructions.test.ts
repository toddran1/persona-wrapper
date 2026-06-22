import { describe, expect, it } from "vitest";
import type { LLMInput } from "@persona/shared";
import { getPersonaById } from "../personas/index.js";
import { PersonaEngine } from "../services/personaEngine.js";
import { buildOpenAIResponseInstructions } from "../providers/llm/OpenAIProvider.js";

function inputForLaRae(): LLMInput {
  const persona = getPersonaById("larae");
  if (!persona) throw new Error("LaRae persona not found");
  return new PersonaEngine().prepareInput(persona, {
    personaId: "larae",
    provider: "openai_persona",
    message: "Introduce yourself.",
    audio: false,
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
});
