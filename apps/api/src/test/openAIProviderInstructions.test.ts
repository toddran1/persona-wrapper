import { describe, expect, it } from "vitest";
import type { LLMInput } from "@persona/shared";
import { getPersonaById } from "../personas/index.js";
import { PersonaEngine } from "../services/personaEngine.js";
import {
  buildDirectImageApiParams,
  buildOpenAIResponseInstructions,
  buildOpenAITools,
  shouldRetryForImageGeneration,
  shouldUseDirectImageApi,
  stripExternalCitationLinks
} from "../providers/llm/OpenAIProvider.js";
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
      moderation: "low"
    });
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

  it("keeps image edits and image-plus-description requests on Responses", () => {
    const editInput = inputForLaRae();
    editInput.userMessage = "Add sunglasses to her in the previous image.";
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

    expect(shouldUseDirectImageApi(editInput)).toBe(false);
    expect(shouldUseDirectImageApi(describeInput)).toBe(false);
  });
});
