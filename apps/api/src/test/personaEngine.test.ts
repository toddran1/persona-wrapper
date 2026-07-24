import { describe, expect, it } from "vitest";
import { getPersonaById } from "../personas/index.js";
import { PersonaEngine } from "../services/personaEngine.js";

describe("PersonaEngine", () => {
  it("builds a system prompt with persona traits and boundaries", () => {
    const persona = getPersonaById("larae");
    const engine = new PersonaEngine();

    expect(persona).toBeDefined();

    const prompt = engine.createSystemPrompt(persona!);

    expect(prompt).toContain("LaRae the Baddest");
    expect(prompt).toContain("fictional AI persona");
    expect(prompt).toContain("Character influences and personal taste");
    expect(prompt).toContain("high-end rooftop brunch party");
    expect(prompt).toContain("The user's location, budget, dietary needs");
    expect(prompt).toContain("Safety boundaries");
    expect(prompt).toContain("Return multimodal output when useful");
  });

  it("builds a persona-lite base prompt without catchphrase-heavy styling", () => {
    const persona = getPersonaById("larae");
    const engine = new PersonaEngine();

    expect(persona).toBeDefined();

    const prompt = engine.createBaseSystemPrompt(persona!);

    expect(prompt).toContain("light version of this persona");
    expect(prompt).toContain("Recommendation lens");
    expect(prompt).toContain("let this taste profile influence what you select");
    expect(prompt).toContain("Do not use catchphrases");
    expect(prompt).not.toContain("Catchphrases:");
    expect(prompt).not.toContain("Clock it.");
  });
});
