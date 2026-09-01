import { describe, expect, it } from "vitest";
import type { LLMInput } from "@persona/shared";
import { getPersonaById } from "../personas/index.js";
import { PersonaEngine } from "../services/personaEngine.js";
import {
  buildInput,
  buildDirectImageApiParams,
  buildOpenAIResponseInstructions,
  buildOpenAITools,
  backgroundPollTimeoutMs,
  shouldRetryForImageGeneration,
  shouldUseDirectImageApi,
  shouldUseFluxImageApi,
  stripExternalCitationLinks
} from "../providers/llm/OpenAIProvider.js";
import { env } from "../config/env.js";

function inputForLaRae(audio = false): LLMInput {
  const persona = getPersonaById("larae");
  if (!persona) throw new Error("LaRae persona not found");
  return new PersonaEngine().prepareInput(persona, {
    personaId: "larae",
    provider: "openai",
    message: "Introduce yourself.",
    audio,
    testMode: false,
    history: []
  });
}

describe("OpenAIProvider instructions", () => {
  it("uses the shorter bounded poll window for web-search background jobs", () => {
    const input = inputForLaRae();
    input.toolOptions = {
      webSearch: true,
      fileSearch: false,
      codeInterpreter: false,
      imageGeneration: false,
      appFunctions: false,
      background: true,
      vectorStoreIds: []
    };

    expect(backgroundPollTimeoutMs(input)).toBe(180_000);
  });

  it("keeps prior chat context and omits fabricated text for attachment-only turns", () => {
    const persona = getPersonaById("larae");
    if (!persona) throw new Error("LaRae persona not found");
    const input = new PersonaEngine().prepareInput(persona, {
      personaId: "larae",
      provider: "openai",
      message: "",
      audio: false,
      testMode: false,
      history: [
        { role: "user", content: "Compare this with the next image I send." },
        { role: "assistant", content: "Send the next image when you are ready." }
      ],
      attachments: [{
        id: "asset_follow_up",
        kind: "image",
        fileName: "follow-up.jpg",
        mimeType: "image/jpeg",
        sizeBytes: 42,
        url: "https://example.com/follow-up.jpg"
      }]
    });

    const responseInput = buildInput(input, "full") as Array<Record<string, unknown>>;
    const currentTurn = responseInput.at(-1) as { role: string; content: Array<Record<string, unknown>> };

    expect(responseInput[0]).toEqual({
      role: "user",
      content: "Compare this with the next image I send."
    });
    expect(currentTurn.role).toBe("user");
    expect(currentTurn.content).toEqual([{
      type: "input_image",
      image_url: "https://example.com/follow-up.jpg",
      detail: "auto"
    }]);
    expect(currentTurn.content.some((item) => item.type === "input_text")).toBe(false);
  });

  it("adds strengthened LaRae performance direction only for direct persona mode", () => {
    const input = inputForLaRae();
    const directInstructions = buildOpenAIResponseInstructions(input, "full");
    const baseInstructions = buildOpenAIResponseInstructions(input, "base");

    expect(directInstructions).toContain("Direct persona performance direction");
    expect(directInstructions).toContain("Use heavy slang, profanity, attitude, and reality-TV confessional energy");
    expect(directInstructions).toContain("Use heavy HEAVY slang and profanity");
    expect(directInstructions).toContain("Bitch, Nigga, Bitches, Niggas, Fucking, Fuck, Hoe, Hoes, Baddies");
    expect(directInstructions).toContain("It should almost feel like it cannot be enough");
    expect(directInstructions).toContain("LaRae is an adults-only persona");
    expect(directInstructions).toContain("do not make the answer child-safe");
    expect(directInstructions).toContain("ratchet, sassy, funny, loud");
    expect(directInstructions).toContain("funnier and sassier than a normal assistant");
    expect(directInstructions).toContain("quick mean-girl jokes, side-eye, playful reads");
    expect(directInstructions).toContain("Did I add humor, sass, side-eye, and quick punchlines?");
    expect(directInstructions).toContain("Avoid sounding sanitized");
    expect(directInstructions).toContain("Style density requirement");
    expect(directInstructions).toContain("Silent style checklist before finalizing");
    expect(directInstructions).toContain("Do not print the checklist");
    expect(directInstructions).toContain("Every paragraph, bullet, numbered item, and transition should carry noticeable LaRae voice");
    expect(directInstructions).toContain("Do not drift into neutral assistant prose after the opening");
    expect(directInstructions).toContain("Do not become generic, corporate, polished, or therapist-clean");
    expect(baseInstructions).not.toContain("Direct persona performance direction");
    expect(baseInstructions).not.toContain("Use heavy slang, profanity, attitude, and reality-TV confessional energy");
    expect(baseInstructions).not.toContain("Use heavy HEAVY slang and profanity");
    expect(baseInstructions).not.toContain("LaRae is an adults-only persona");
    expect(baseInstructions).not.toContain("Style density requirement");
    expect(baseInstructions).not.toContain("Silent style checklist before finalizing");
  });

  it("uses professional direction without uncensored directives", () => {
    const persona = getPersonaById("larae");
    if (!persona) throw new Error("LaRae persona not found");
    const input = new PersonaEngine().prepareInput(persona, {
      personaId: "larae",
      personaInfluenceLevel: "professional",
      provider: "openai",
      message: "Introduce yourself.",
      audio: false,
      testMode: false,
      history: []
    });
    const instructions = buildOpenAIResponseInstructions(input, "full");

    expect(instructions).toContain("workplace-appropriate language");
    expect(instructions).toContain("free of profanity, slurs, and vulgarity");
    expect(instructions).not.toContain("Use heavy HEAVY slang and profanity");
    expect(instructions).not.toContain("Vary catchphrases and profanity naturally");
  });

  it("keeps hidden audio-script direction professional", () => {
    const persona = getPersonaById("larae");
    if (!persona) throw new Error("LaRae persona not found");
    const input = new PersonaEngine().prepareInput(persona, {
      personaId: "larae",
      personaInfluenceLevel: "professional",
      provider: "openai",
      message: "Give me a spoken update.",
      audio: true,
      testMode: false,
      history: []
    });
    const original = env.OPENAI_TTS_SCRIPT_ENABLED;
    env.OPENAI_TTS_SCRIPT_ENABLED = true;
    try {
      const instructions = buildOpenAIResponseInstructions(input, "full");
      expect(instructions).toContain("Keep the narration workplace-appropriate");
      expect(instructions).not.toContain("Bitch—");
    } finally {
      env.OPENAI_TTS_SCRIPT_ENABLED = original;
    }
  });

  it("only applies the short audio instruction when the account preference is enabled", () => {
    const conciseInput = inputForLaRae(true);
    const fullLengthInput = { ...conciseInput, conciseAudioResponse: false };

    expect(buildOpenAIResponseInstructions(conciseInput, "full")).toContain(
      `at or below ${env.CHAT_AUDIO_MAX_RESPONSE_CHARACTERS} characters`
    );
    expect(buildOpenAIResponseInstructions(fullLengthInput, "full")).not.toContain(
      "Audio response length requirement:"
    );
  });

  it("does not instruct providers to call disabled or unavailable application tools", () => {
    const input = inputForLaRae();
    const instructions = buildOpenAIResponseInstructions(input, "full");

    expect(instructions).toContain("Use generate_artifact whenever");
    expect(instructions).not.toContain("Use places_search");

    input.toolOptions = {
      ...input.toolOptions,
      appFunctions: false
    };
    expect(buildOpenAIResponseInstructions(input, "full")).not.toContain("Use generate_artifact whenever");
  });

  it("reads direct performance direction from the active persona profile rather than its id", () => {
    const input = inputForLaRae();
    input.persona = {
      ...input.persona,
      id: "nova",
      name: "Nova",
      shortName: "Nova",
      directResponseInstructions: ["Use Nova's exact custom cadence in every section."],
      styleReference: undefined,
      voiceProfile: {
        ...input.persona.voiceProfile,
        performancePreset: "neutral"
      }
    };

    const instructions = buildOpenAIResponseInstructions(input, "full");
    expect(instructions).toContain("Use Nova's exact custom cadence in every section.");
    expect(instructions).toContain("Answer directly in Nova's voice.");
  });

  it("requests visible text and hidden TTS script in one response when audio mode is enabled", () => {
    const original = env.OPENAI_TTS_SCRIPT_ENABLED;
    env.OPENAI_TTS_SCRIPT_ENABLED = true;

    const input = inputForLaRae(true);
    const directInstructions = buildOpenAIResponseInstructions(input, "full");

    expect(directInstructions).toContain("Audio response format requirement");
    expect(directInstructions).toContain("\"visible_text\":\"normal response for the UI\"");
    expect(directInstructions).toContain("\"tts_script\":\"provider-optimized narration script\"");
    expect(directInstructions).toContain("visible_text is the normal user-facing answer");
    expect(directInstructions).toContain("tts_script is hidden and will be sent only to the configured speech provider");
    expect(directInstructions).toContain("it should NOT simply copy visible_text");
    expect(directInstructions).toContain("performance-ready narration script");
    expect(directInstructions).toContain("normalize text for speech");
    expect(directInstructions).toContain("Always write temperature units in full");
    expect(directInstructions).toContain("always expand abbreviated weekdays");
    expect(directInstructions).toContain("add natural speech pacing");
    expect(directInstructions).toContain("carry the configured persona emotion and delivery");
    expect(directInstructions).toContain("For Fish Audio S2 and S2.1 models");
    expect(directInstructions).toContain("Do not include emoji");
    expect(directInstructions).toContain("sassy, animated, rapid-fire confessional style");
    expect(directInstructions).toContain("two or three related sentences share one emotional direction");
    expect(directInstructions).toContain("Do not put Fish Audio cues in visible_text");

    env.OPENAI_TTS_SCRIPT_ENABLED = original;
  });

  it("uses the least restrictive documented OpenAI image moderation setting", () => {
    const input = inputForLaRae();
    input.toolOptions = {
      webSearch: false,
      fileSearch: false,
      codeInterpreter: false,
      imageGeneration: true,
      appFunctions: false,
      background: true,
      vectorStoreIds: []
    };

    const tools = buildOpenAITools(input);

    expect(tools).toContainEqual({
      type: "image_generation",
      action: "auto",
      model: "gpt-image-2",
      moderation: "low",
      size: "auto",
      quality: "auto"
    });
  });

  it("routes image-only requests to FLUX only when the flux image provider is selected", () => {
    const input = inputForLaRae();
    input.userMessage = "Generate an image of a rooftop party.";
    input.toolOptions = {
      webSearch: false,
      fileSearch: false,
      codeInterpreter: false,
      imageGeneration: true,
      appFunctions: false,
      background: true,
      vectorStoreIds: []
    };

    input.imageProvider = "flux";
    expect(shouldUseFluxImageApi(input)).toBe(true);

    input.imageProvider = "openai";
    expect(shouldUseFluxImageApi(input)).toBe(false);

    // Incidental tool flags (the router enables web search on travel/shopping
    // keywords) do not divert an explicit FLUX selection.
    input.imageProvider = "flux";
    input.toolOptions = { ...input.toolOptions, webSearch: true };
    expect(shouldUseFluxImageApi(input)).toBe(true);

    input.toolOptions = { ...input.toolOptions, webSearch: false, imageGeneration: false };
    expect(shouldUseFluxImageApi(input)).toBe(false);
  });

  it("uses the server-selected image quality for hosted and direct image requests", () => {
    const input = inputForLaRae();
    input.toolOptions = {
      webSearch: false,
      fileSearch: false,
      codeInterpreter: false,
      imageGeneration: true,
      imageQuality: "medium",
      appFunctions: false,
      background: true,
      vectorStoreIds: []
    };

    expect(buildOpenAITools(input)).toContainEqual(expect.objectContaining({
      type: "image_generation",
      quality: "medium"
    }));
    expect(buildDirectImageApiParams(input)).toEqual(expect.objectContaining({
      quality: "medium"
    }));
  });

  it("honors a selected web-search tool without applying a second keyword veto", () => {
    const input = inputForLaRae();
    input.userMessage = "Tell me more about that topic.";
    input.toolOptions = {
      webSearch: true,
      fileSearch: false,
      codeInterpreter: false,
      imageGeneration: false,
      appFunctions: false,
      background: false,
      vectorStoreIds: []
    };

    expect(buildOpenAITools(input)).toContainEqual({ type: "web_search" });
  });

  it("keeps contextual product links while removing citation-only parentheticals", () => {
    const text = [
      "👉 **[Buy the Runcati pants on Amazon](https://www.amazon.com/example)**",
      "The listing describes the same pleated fit. ([Amazon listing](https://www.amazon.com/source))"
    ].join("\n\n");

    expect(stripExternalCitationLinks(text)).toBe(
      "👉 **[Buy the Runcati pants on Amazon](https://www.amazon.com/example)**\n\nThe listing describes the same pleated fit."
    );
  });

  it("does not retry image generation when OpenAI returns a safety refusal", () => {
    const input = inputForLaRae();
    input.toolOptions = {
      webSearch: false,
      fileSearch: false,
      codeInterpreter: false,
      imageGeneration: true,
      appFunctions: false,
      background: true,
      vectorStoreIds: []
    };
    const safetyResponse = {
      output: [
        {
          type: "message",
          content: [
            {
              type: "output_text",
              text: "I can't edit that exact image because it is too explicit and was flagged by the safety policy."
            }
          ]
        }
      ]
    };
    const capabilityResponse = {
      output: [
        {
          type: "message",
          content: [
            {
              type: "output_text",
              text: "I cannot generate images in this chat."
            }
          ]
        }
      ]
    };

    expect(shouldRetryForImageGeneration(input, safetyResponse)).toBe(false);
    expect(shouldRetryForImageGeneration(input, capabilityResponse)).toBe(true);
  });

  it("routes simple image-only requests to the direct Images API path", () => {
    const input = inputForLaRae();
    input.userMessage = "Generate a glamorous Miami fashion portrait of LaRae wearing a baseball cap.";
    input.toolOptions = {
      webSearch: false,
      fileSearch: false,
      codeInterpreter: false,
      imageGeneration: true,
      appFunctions: false,
      background: true,
      vectorStoreIds: []
    };

    expect(shouldUseDirectImageApi(input)).toBe(true);
    expect(buildDirectImageApiParams(input)).toMatchObject({
      model: expect.any(String),
      moderation: "low",
      n: 1
    });
  });

  it("routes attached images to the direct Images API edit path while retaining conversational generation on Responses", () => {
    const editInput = inputForLaRae();
    editInput.userMessage = "Add sunglasses to her in the previous image.";
    editInput.attachments = [{
      id: "asset_1",
      kind: "image",
      fileName: "reference.jpg",
      mimeType: "image/jpeg",
      sizeBytes: 123
    }];
    editInput.toolOptions = {
      webSearch: false,
      fileSearch: false,
      codeInterpreter: false,
      imageGeneration: true,
      appFunctions: false,
      background: true,
      vectorStoreIds: []
    };

    const describeInput = inputForLaRae();
    describeInput.userMessage = "Generate an image of LaRae and describe it.";
    describeInput.toolOptions = editInput.toolOptions;

    expect(shouldUseDirectImageApi(editInput)).toBe(true);
    expect(shouldUseDirectImageApi(describeInput)).toBe(false);
  });

  it("supports multiple direct-image references but keeps file attachments on Responses", () => {
    const imageInput = inputForLaRae();
    imageInput.userMessage = "Combine these outfits into one polished look.";
    imageInput.attachments = [
      { id: "asset_1", kind: "image", fileName: "one.jpg", mimeType: "image/jpeg", sizeBytes: 123 },
      { id: "asset_2", kind: "image", fileName: "two.webp", mimeType: "image/webp", sizeBytes: 456 }
    ];
    imageInput.toolOptions = {
      webSearch: false,
      fileSearch: false,
      codeInterpreter: false,
      imageGeneration: true,
      appFunctions: false,
      background: true,
      vectorStoreIds: []
    };

    const fileInput = { ...imageInput, attachments: [{
      id: "asset_3", kind: "file" as const, fileName: "notes.pdf", mimeType: "application/pdf", sizeBytes: 123
    }] };

    expect(shouldUseDirectImageApi(imageInput)).toBe(true);
    expect(shouldUseDirectImageApi(fileInput)).toBe(false);
  });

  it("does not route reference-dependent requests to direct image generation without all references", () => {
    const input = inputForLaRae();
    input.userMessage = "Mix these two images into a new character.";
    input.attachments = [{
      id: "asset_1",
      kind: "image",
      fileName: "one.jpg",
      mimeType: "image/jpeg",
      sizeBytes: 123
    }];
    input.toolOptions = {
      webSearch: false,
      fileSearch: false,
      codeInterpreter: false,
      imageGeneration: true,
      appFunctions: false,
      background: true,
      vectorStoreIds: []
    };

    expect(shouldUseDirectImageApi(input)).toBe(false);
    input.attachments.push({
      id: "asset_2",
      kind: "image",
      fileName: "two.webp",
      mimeType: "image/webp",
      sizeBytes: 456
    });
    expect(shouldUseDirectImageApi(input)).toBe(true);
    expect(buildOpenAIResponseInstructions(input, "full")).toContain(
      "Never invent or substitute a generic source image"
    );
  });

  it("requires every image in larger explicit reference sets before using direct generation", () => {
    const input = inputForLaRae();
    input.userMessage = "Blend these 4 images into one new character.";
    input.attachments = [1, 2, 3].map((index) => ({
      id: `asset_${index}`,
      kind: "image" as const,
      fileName: `${index}.png`,
      mimeType: "image/png",
      sizeBytes: 123
    }));
    input.toolOptions = {
      webSearch: false,
      fileSearch: false,
      codeInterpreter: false,
      imageGeneration: true,
      appFunctions: false,
      background: true,
      vectorStoreIds: []
    };

    expect(shouldUseDirectImageApi(input)).toBe(false);
    input.attachments.push({
      id: "asset_4",
      kind: "image",
      fileName: "4.png",
      mimeType: "image/png",
      sizeBytes: 123
    });
    expect(shouldUseDirectImageApi(input)).toBe(true);
  });
});
