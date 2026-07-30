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

  it("adds optional user personalization without inferring age or pronouns", () => {
    const persona = getPersonaById("larae");
    const engine = new PersonaEngine();

    expect(persona).toBeDefined();

    const prompt = engine.createSystemPrompt(persona!, {
      preferredName: "Reggie",
      gender: "male",
      birthday: { month: 2, day: 29 }
    });

    expect(prompt).toContain("Preferred name: Reggie");
    expect(prompt).toContain("Gender: male");
    expect(prompt).toContain("Birthday: February 29");
    expect(prompt).toContain("do not infer the user's age or pronouns");
  });

  it("makes the native chart renderer available to every persona", () => {
    const persona = getPersonaById("larae");
    const engine = new PersonaEngine();

    expect(persona).toBeDefined();

    const input = engine.prepareInput(persona!, {
      personaId: persona!.id,
      provider: "openai_persona",
      message: "Chart this data.",
      audio: false,
      testMode: false,
      history: []
    });

    expect(input.toolDefinitions).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: "render_chart", owner: "application" })
    ]));
  });

  it("preserves the server-stamped audio response policy for queued work", () => {
    const persona = getPersonaById("larae");
    const engine = new PersonaEngine();

    expect(persona).toBeDefined();

    const input = engine.prepareInput(persona!, {
      personaId: persona!.id,
      provider: "openai_persona",
      message: "Give me the full answer.",
      audio: true,
      conciseAudioResponse: false,
      testMode: false,
      history: []
    });

    expect(input.conciseAudioResponse).toBe(false);
  });
});
