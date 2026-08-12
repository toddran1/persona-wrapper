import { describe, expect, it } from "vitest";
import { getPersonaById } from "../personas/index.js";
import { stripPersonaAttributionMarkers } from "../services/personaAttribution.js";
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

  it("uses clean persona-specific direction in professional mode", () => {
    const persona = getPersonaById("larae");
    const engine = new PersonaEngine();

    expect(persona).toBeDefined();
    const input = engine.prepareInput(persona!, {
      personaId: "larae",
      personaInfluenceLevel: "professional",
      provider: "openai",
      message: "Help me plan a presentation.",
      audio: false,
      testMode: false,
      history: []
    });

    expect(input.personaInfluenceLevel).toBe("professional");
    expect(input.systemPrompt).toContain("Professional persona direction:");
    expect(input.systemPrompt).toContain("workplace-appropriate language");
    expect(input.systemPrompt).toContain("bold Miami energy");
    expect(input.systemPrompt).not.toContain("Speech style: slang-heavy, profanity-heavy");
    expect(input.systemPrompt).not.toContain("Catchphrases: Ok bitch!");
    expect(input.baseSystemPrompt).toBe(input.systemPrompt);
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

  it("makes provider-independent app tools available to every persona", () => {
    const persona = getPersonaById("larae");
    const engine = new PersonaEngine();

    expect(persona).toBeDefined();

    const input = engine.prepareInput(persona!, {
      personaId: persona!.id,
      provider: "openai",
      message: "Chart this data.",
      audio: false,
      testMode: false,
      history: []
    });

    expect(input.toolDefinitions).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: "render_chart", owner: "application" }),
      expect.objectContaining({ name: "generate_artifact", owner: "application" })
    ]));
    expect(input.toolDefinitions).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ name: "places_search" })
    ]));
  });

  it("preserves the server-stamped audio response policy for queued work", () => {
    const persona = getPersonaById("larae");
    const engine = new PersonaEngine();

    expect(persona).toBeDefined();

    const input = engine.prepareInput(persona!, {
      personaId: persona!.id,
      provider: "openai",
      message: "Give me the full answer.",
      audio: true,
      conciseAudioResponse: false,
      testMode: false,
      history: []
    });

    expect(input.conciseAudioResponse).toBe(false);
  });

  it("keeps mixed-persona history attributed while answering as the active persona", () => {
    const persona = getPersonaById("bambam");
    const engine = new PersonaEngine();

    expect(persona).toBeDefined();

    const input = engine.prepareInput(persona!, {
      personaId: persona!.id,
      provider: "openai",
      message: "How does your answer compare?",
      audio: false,
      testMode: false,
      history: [
        { role: "user", content: "What is your favorite team?" },
        { role: "assistant", content: "The Miami Heat.", personaId: "larae" },
        { role: "user", content: "What did the other persona say?" },
        { role: "assistant", content: "A retired answer.", personaId: "retired-persona" }
      ]
    });

    expect(input.systemPrompt).toContain("Conversation history can contain assistant replies from multiple personas.");
    expect(input.systemPrompt).toContain("Never repeat, quote, paraphrase, or include an [Assistant persona: ...] marker");
    expect(input.systemPrompt).toContain("Answer the current user only as Bam Bam");
    expect(input.messages[2]?.content).toBe(
      "[Assistant persona: LaRae the Baddest | id=larae]\nThe Miami Heat."
    );
    expect(input.messages[4]?.content).toBe(
      "[Assistant persona: Unavailable or retired persona | id=retired-persona]\nA retired answer."
    );
    expect(input.messages[2]).not.toHaveProperty("personaId");
  });

  it("builds a neutral system prompt without persona instructions for the neutral persona", () => {
    const persona = getPersonaById("neutral");
    const engine = new PersonaEngine();

    expect(persona).toBeDefined();
    expect(persona!.neutralStyle).toBe(true);

    const profile = { preferredName: "Reggie" } as const;
    const prompt = engine.createSystemPrompt(persona!, profile);

    expect(prompt).toContain("helpful AI assistant");
    expect(prompt).toContain("without any persona, character voice, or styling");
    expect(prompt).toContain("Preferred name: Reggie");
    expect(prompt).toContain("Safety boundaries");
    expect(prompt).toContain("Return multimodal output when useful");
    expect(prompt).not.toContain("fictional AI persona");
    expect(prompt).not.toContain("Biography:");
    expect(prompt).not.toContain("Catchphrases:");
    expect(prompt).not.toContain("[Assistant persona:");
    expect(engine.createBaseSystemPrompt(persona!, profile)).toBe(prompt);
  });

  it("removes leaked internal persona attribution markers from user-facing text", () => {
    expect(stripPersonaAttributionMarkers(
      "[Assistant persona: LaRae the Baddest | id=larae]\nThe visible answer."
    )).toBe("The visible answer.");
    expect(stripPersonaAttributionMarkers(
      "Intro.\n**[Assistant persona: Bam Bam | id=bambam]**\nContinue."
    )).toBe("Intro.\nContinue.");
    expect(stripPersonaAttributionMarkers("A normal response mentioning an assistant persona generally."))
      .toBe("A normal response mentioning an assistant persona generally.");
  });
});
