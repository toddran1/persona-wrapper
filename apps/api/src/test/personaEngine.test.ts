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
    expect(prompt).toContain("Safety boundaries");
    expect(prompt).toContain("Return multimodal output when useful");
  });
});

