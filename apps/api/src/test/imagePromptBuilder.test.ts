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
    expect(prompt).toContain("Persona character influences for scene and styling choices");
    expect(prompt).toContain("high-end rooftop brunch party");
    expect(prompt).toContain("The user's requested subject, setting, outfit, action, and constraints always take priority");
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

  it("uses image-safe phrase replacements configured by the active persona", () => {
    const input = imageInput("Create a moon queen portrait.");
    input.persona = {
      ...input.persona,
      imagePromptSanitization: {
        replacements: [{ phrases: ["moon queen"], replaceWith: "silver celestial leader" }]
      }
    };

    const prompt = buildImageGenerationPrompt(input);
    expect(prompt).toContain("silver celestial leader portrait");
    expect(prompt).not.toContain("moon queen");
  });

  it("does not include persona profile details for unrelated image requests", () => {
    const prompt = buildImageGenerationPrompt(imageInput("Can you give me a picture of a puppy sleeping?"));

    expect(prompt).toContain("This image request is not about the current persona");
    expect(prompt).toContain("puppy sleeping");
    expect(prompt).not.toContain("LaRae");
    expect(prompt).not.toContain("Persona character influences for scene and styling choices");
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

    expect(prompt).toContain("separate attached full-body and face images are the persona's visual references");
  });

  it("tells the direct image path how to use one or more user image references", () => {
    const input = imageInput("Turn these reference images into an editorial street-style portrait.");
    input.attachments = [
      { id: "asset_1", kind: "image", fileName: "look-one.jpg", mimeType: "image/jpeg", sizeBytes: 123 },
      { id: "asset_2", kind: "image", fileName: "look-two.jpg", mimeType: "image/jpeg", sizeBytes: 456 }
    ];

    expect(buildImageGenerationPrompt(input, { includeUserImageReferences: true })).toContain(
      "The user's attached image or images are source references for this edit"
    );
  });

  it("includes recent text history when a direct image follow-up reuses earlier visual context", () => {
    const input = imageInput("Now combine their designs into one new character.");
    input.baseMessages = [
      { role: "system", content: "System instructions." },
      { role: "user", content: "Mix the two character images I uploaded." },
      { role: "assistant", content: "I combined the two characters into a superhero-inspired result." },
      { role: "user", content: input.userMessage }
    ];
    input.messages = input.baseMessages;
    input.attachments = [
      {
        id: "conversation-upload:asset_1",
        kind: "image",
        fileName: "first.jpg",
        mimeType: "image/jpeg",
        sizeBytes: 123
      },
      {
        id: "conversation-upload:asset_2",
        kind: "image",
        fileName: "second.jpg",
        mimeType: "image/jpeg",
        sizeBytes: 456
      }
    ];
    input.visualContext = {
      intent: "transform",
      source: "user_uploads",
      summary: "Resolved visual lineage: original uploaded source set from the character-combination turn.",
      selectedTurnIndexes: [0],
      selectedPositions: [1, 2]
    };

    const prompt = buildImageGenerationPrompt(input, { includeUserImageReferences: true });

    expect(prompt).toContain("Relevant recent conversation context for interpreting this follow-up:");
    expect(prompt).toContain("Resolved visual lineage: original uploaded source set");
    expect(prompt).toContain("User: Mix the two character images I uploaded.");
    expect(prompt).toContain("Assistant: I combined the two characters into a superhero-inspired result.");
    expect(prompt).toContain("The current visual request remains the instruction to execute.");
  });

  it("does not add prior chat text to a new image request with fresh uploads", () => {
    const input = imageInput("Combine these new reference images.");
    input.baseMessages = [
      { role: "user", content: "An unrelated earlier image request." },
      { role: "assistant", content: "An unrelated earlier result." },
      { role: "user", content: input.userMessage }
    ];
    input.messages = input.baseMessages;
    input.attachments = [
      { id: "asset_1", kind: "image", fileName: "new.jpg", mimeType: "image/jpeg", sizeBytes: 123 }
    ];

    const prompt = buildImageGenerationPrompt(input, { includeUserImageReferences: true });

    expect(prompt).not.toContain("Relevant recent conversation context");
    expect(prompt).not.toContain("An unrelated earlier image request");
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
      expect(prompt).toContain("Persona character influences for scene and styling choices");
    }
  });

  it("does not include persona profile details when the user explicitly opts out", () => {
    const prompt = buildImageGenerationPrompt(
      imageInput("Make a neon Miami fashion poster, but do not use the persona or LaRae.")
    );

    expect(prompt).toContain("This image request is not about the current persona");
    expect(prompt).not.toContain("Fictional persona: LaRae");
    expect(prompt).not.toContain("Use the persona profile only as visual identity guidance");
    expect(prompt).not.toContain("Persona character influences for scene and styling choices");
  });
});
