import { describe, expect, it } from "vitest";
import type { LLMInput } from "@persona/shared";
import { getPersonaById } from "../personas/index.js";
import { PersonaEngine } from "../services/personaEngine.js";
import { buildImageGenerationPrompt } from "../services/imagePromptBuilder.js";

function imageInput(message: string): LLMInput {
  const persona = getPersonaById("larae");
  if (!persona) throw new Error("LaRae persona not found");

  const input = new PersonaEngine().prepareInput(persona, {
    personaId: "larae",
    provider: "openai_persona",
    message,
    audio: false,
    testMode: false,
    history: []
  });
  input.toolOptions = {
    webSearch: false,
    fileSearch: false,
    codeInterpreter: false,
    imageGeneration: true,
    appFunctions: false,
    background: true,
    vectorStoreIds: []
  };
  return input;
}

describe("imagePromptBuilder", () => {
  it("cleans persona-style wording before image generation", () => {
    const prompt = buildImageGenerationPrompt(
      imageInput("LaRae, make a sexy picture of you as a bad bitch in Miami with a big butt and big boobs.")
    );

    expect(prompt).toContain("Fictional adult persona: LaRae the Baddest");
    expect(prompt).toContain("clothed Miami nightlife fashion");
    expect(prompt).toContain("confident glamorous");
    expect(prompt).toContain("confident fashionable woman");
    expect(prompt).toContain("curvy frame");
    expect(prompt).not.toMatch(/\bsexy\b/i);
    expect(prompt).not.toMatch(/\bbad bitch\b/i);
    expect(prompt).not.toMatch(/\bbig butt\b/i);
    expect(prompt).not.toMatch(/\bbig boobs?\b/i);
  });

  it("removes profanity from the image tool prompt without changing chat persona globally", () => {
    const prompt = buildImageGenerationPrompt(
      imageInput("Bitch make a fucking Miami fashion portrait with baddies and hoes in the club.")
    );

    expect(prompt).toContain("Miami fashion portrait");
    expect(prompt).toContain("fashion-forward confident women");
    expect(prompt).not.toMatch(/\bbitch\b/i);
    expect(prompt).not.toMatch(/\bfucking\b/i);
    expect(prompt).not.toMatch(/\bhoes?\b/i);
  });
});
