import { describe, expect, it } from "vitest";
import type { LLMInput } from "@persona/shared";
import { getPersonaById } from "../personas/index.js";
import { PersonaEngine } from "../services/personaEngine.js";
import { buildImageGenerationPrompt, directPersonaVisualReferencePaths } from "../services/imagePromptBuilder.js";

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

    expect(prompt).toContain("Fictional persona: LaRae the Baddest");
    expect(prompt).toContain("Use the persona profile only as visual identity guidance");
    expect(prompt).toContain("Miami nightlife beauty");
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

    expect(prompt).toContain("This image request is not about the current persona");
    expect(prompt).toContain("Miami fashion portrait");
    expect(prompt).toContain("fashion-forward confident women");
    expect(prompt).not.toContain("Fictional persona: LaRae");
    expect(prompt).not.toMatch(/\bbitch\b/i);
    expect(prompt).not.toMatch(/\bfucking\b/i);
    expect(prompt).not.toMatch(/\bhoes?\b/i);
  });

  it("does not include persona profile details for unrelated image requests", () => {
    const prompt = buildImageGenerationPrompt(imageInput("Can you give me a picture of a puppy sleeping?"));

    expect(prompt).toContain("This image request is not about the current persona");
    expect(prompt).toContain("puppy sleeping");
    expect(prompt).not.toContain("LaRae");
    expect(prompt).not.toContain("Miami nightlife");
    expect(prompt).not.toContain("curvy");
    expect(prompt).not.toContain("Age:");
    expect(prompt).not.toContain("Height:");
  });

  it("includes persona profile details for generic self-image requests", () => {
    const prompt = buildImageGenerationPrompt(imageInput("Can you generate an image of yourself in Miami?"));

    expect(prompt).toContain("Fictional persona: LaRae the Baddest");
    expect(prompt).toContain("Use the persona profile only as visual identity guidance");
    expect(prompt).toContain("Miami");
  });

  it("returns LaRae's two visual references only for persona image requests", () => {
    const personaRequest = imageInput("Generate an image of LaRae in Miami.");
    const unrelatedRequest = imageInput("Generate an image of a puppy sleeping.");

    expect(directPersonaVisualReferencePaths(personaRequest)).toEqual([
      "/apps/web/public/personas/larae/reference/larae_fullbody_360.png",
      "/apps/web/public/personas/larae/reference/larae_face_360.png"
    ]);
    expect(directPersonaVisualReferencePaths(unrelatedRequest)).toEqual([]);
  });

  it("adds the reference-image direction only when reference images are attached", () => {
    const prompt = buildImageGenerationPrompt(
      imageInput("Generate an image of LaRae in Miami."),
      { includePersonaVisualReferences: true }
    );

    expect(prompt).toContain("Two attached images are the persona's full-body and face visual references");
  });

  it("includes persona profile details for avatar and character image requests", () => {
    const prompts = [
      buildImageGenerationPrompt(imageInput("Make your avatar wearing a black leather jacket.")),
      buildImageGenerationPrompt(imageInput("Create a character sheet for the current persona.")),
      buildImageGenerationPrompt(imageInput("Show your full body look in a neon Miami outfit."))
    ];

    for (const prompt of prompts) {
      expect(prompt).toContain("Fictional persona: LaRae the Baddest");
      expect(prompt).toContain("Use the persona profile only as visual identity guidance");
    }
  });

  it("does not include persona profile details when the user explicitly opts out", () => {
    const prompt = buildImageGenerationPrompt(
      imageInput("Make a neon Miami fashion poster, but do not use the persona or LaRae.")
    );

    expect(prompt).toContain("This image request is not about the current persona");
    expect(prompt).not.toContain("Fictional persona: LaRae");
    expect(prompt).not.toContain("Use the persona profile only as visual identity guidance");
  });
});
