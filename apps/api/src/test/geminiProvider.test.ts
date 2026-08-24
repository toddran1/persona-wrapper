import { describe, expect, it, vi } from "vitest";
import type { LLMInput } from "@persona/shared";
import { env } from "../config/env.js";
import { getPersonaById } from "../personas/index.js";
import { GeminiProvider } from "../providers/llm/GeminiProvider.js";
import type {
  PublicMediaAnalysis,
  PublicMediaAnalysisCache
} from "../services/publicMediaAnalysisCacheService.js";
import { PersonaEngine } from "../services/personaEngine.js";

function geminiInput(imageGeneration = false, professional = false): LLMInput {
  const persona = getPersonaById("larae");
  if (!persona) throw new Error("LaRae persona not found");
  return new PersonaEngine().prepareInput(persona, {
    personaId: persona.id,
    ...(professional ? { personaInfluenceLevel: "professional" as const } : {}),
    provider: "gemini",
    message: imageGeneration ? "Create an image of a neon skyline." : "Introduce yourself.",
    audio: false,
    testMode: false,
    history: [],
    ...(imageGeneration ? {
      requestedOutputs: ["image"],
      toolOptions: { imageGeneration: true }
    } : {})
  });
}

describe("GeminiProvider", () => {
  it("uses deterministic Gemini output in tests without making paid calls", async () => {
    const output = await new GeminiProvider().generateResponse(geminiInput());

    expect(output.provider).toBe("gemini");
    expect(output.rawText).toContain("LaRae");
  });

  it("delegates image generation while preserving Gemini as the selected provider", async () => {
    const output = await new GeminiProvider().generateResponse(geminiInput(true));

    expect(output.provider).toBe("gemini");
    expect(output.content.some((block) => block.type === "image")).toBe(true);
    expect(output.metadata?.delegatedProvider).toBe("openai");
    expect(output.metadata?.delegatedCapability).toBe("image_generation");
  });

  it("uses stateless Interactions requests and maps usage and URL annotations", async () => {
    const createInteraction = vi.fn().mockResolvedValue({
      id: "interaction_123",
      status: "completed",
      model: "gemini-3.5-flash-lite",
      output_text: "A grounded answer.",
      steps: [{
        type: "model_output",
        content: [{
          type: "text",
          text: "A grounded answer.",
          annotations: [{
            type: "url_citation",
            title: "Official source",
            url: "https://example.com/source"
          }]
        }]
      }],
      usage: {
        total_input_tokens: 21,
        total_output_tokens: 8,
        total_thought_tokens: 2,
        total_tokens: 29
      }
    });
    const input = geminiInput();
    input.toolOptions = { ...input.toolOptions, webSearch: true };

    const output = await new GeminiProvider({ createInteraction }).generateResponse(input);

    expect(createInteraction).toHaveBeenCalledTimes(1);
    const request = createInteraction.mock.calls[0]?.[0];
    expect(request).toMatchObject({
      model: "gemini-3.5-flash-lite",
      store: false,
      stream: false,
      tools: expect.arrayContaining([{ type: "google_search" }])
    });
    expect(request.input).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "text", text: expect.stringContaining("Current user request:") })
    ]));
    expect(output.usage).toMatchObject({ inputTokens: 21, outputTokens: 8, totalTokens: 29, reasoningTokens: 2 });
    expect(output.content).toContainEqual(expect.objectContaining({
      type: "source_list",
      sources: [expect.objectContaining({ url: "https://example.com/source" })]
    }));
    expect(output.metadata?.interactionStored).toBe(false);
  });

  it("streams Gemini text deltas without exposing the hidden audio-script envelope", async () => {
    const createInteractionStream = vi.fn().mockResolvedValue((async function* () {
      yield {
        data: {
          event_type: "interaction.created",
          interaction: {
            id: "interaction_stream",
            status: "in_progress",
            model: "gemini-3.5-flash-lite"
          }
        }
      };
      yield {
        data: {
          event_type: "step.start",
          index: 0,
          step: { type: "model_output", content: [] }
        }
      };
      yield {
        data: {
          event_type: "step.delta",
          index: 0,
          delta: { type: "text", text: "A streamed " },
          metadata: { total_usage: { total_input_tokens: 12 } }
        }
      };
      yield {
        data: {
          event_type: "step.delta",
          index: 0,
          delta: { type: "text", text: "answer." }
        }
      };
      yield {
        data: {
          event_type: "step.stop",
          index: 0,
          usage: { total_output_tokens: 3, total_tokens: 15 }
        }
      };
      yield {
        data: {
          event_type: "interaction.completed",
          interaction: {
            id: "interaction_stream",
            status: "completed",
            model: "gemini-3.5-flash-lite",
            usage: {
              total_input_tokens: 12,
              total_output_tokens: 3,
              total_tokens: 15
            }
          }
        }
      };
    })());
    const input = geminiInput();
    input.audio = true;
    const deltas: string[] = [];

    const output = await new GeminiProvider({ createInteractionStream }).generateResponseStream(input, {
      onTextDelta: (delta) => deltas.push(delta)
    });

    expect(deltas.join("")).toBe("A streamed answer.");
    expect(output.rawText).toBe("A streamed answer.");
    expect(output.usage).toMatchObject({ inputTokens: 12, outputTokens: 3, totalTokens: 15 });
    const request = createInteractionStream.mock.calls[0]?.[0];
    expect(request).toMatchObject({ stream: true, store: false });
    expect(request.response_format).toBeUndefined();
    expect(String(request.system_instruction)).not.toContain("visible_text");
  });

  it("does not append uncensored style references in professional mode", async () => {
    const createInteraction = vi.fn().mockResolvedValue({
      id: "interaction_professional",
      status: "completed",
      output_text: "A polished answer.",
      steps: [{ type: "model_output", content: [{ type: "text", text: "A polished answer." }] }],
      usage: { total_input_tokens: 12, total_output_tokens: 4, total_tokens: 16 }
    });

    await new GeminiProvider({ createInteraction }).generateResponse(geminiInput(false, true));

    const instruction = String(createInteraction.mock.calls[0]?.[0]?.system_instruction ?? "");
    expect(instruction).toContain("Professional persona direction:");
    expect(instruction).toContain("workplace-appropriate language");
    expect(instruction).not.toContain("LaRae style reference examples");
    expect(instruction).not.toContain("Catchphrases and vocabulary cues");
  });

  it("encodes mixed-provider and mixed-persona history as quoted context instead of Gemini model steps", async () => {
    const createInteraction = vi.fn().mockResolvedValue({
      id: "interaction_history",
      status: "completed",
      output_text: "LaRae keeps the personas distinct.",
      steps: [{ type: "model_output", content: [{ type: "text", text: "LaRae keeps the personas distinct." }] }],
      usage: { total_input_tokens: 42, total_output_tokens: 7, total_tokens: 49 }
    });
    const input = geminiInput();
    input.messages = [
      input.messages[0]!,
      { role: "user", content: "What team do you like?" },
      {
        role: "assistant",
        content: "[Assistant persona: Bam Bam | id=bambam]\nThe Atlanta Hawks.",
        personaId: "bambam"
      },
      { role: "assistant", content: "An answer previously returned by another provider." },
      { role: "user", content: "What did each persona say?" }
    ];

    await new GeminiProvider({ createInteraction }).generateResponse(input);

    const request = createInteraction.mock.calls[0]?.[0];
    expect(request.input).toHaveLength(2);
    expect(request.input).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "model_output" })
    ]));
    expect(request.input[0]).toMatchObject({
      type: "text",
      text: expect.stringContaining("[Assistant persona: Bam Bam | id=bambam]")
    });
    expect(request.input[1]).toEqual({ type: "text", text: "Current user request:\nWhat did each persona say?" });
    const historyText = request.input[0]?.text;
    expect(historyText).toContain("An answer previously returned by another provider.");
    expect(historyText).not.toContain("What did each persona say?");
  });

  it("attaches media to the single current user input without fabricating historical model output", async () => {
    const createInteraction = vi.fn().mockResolvedValue({
      id: "interaction_attachment",
      status: "completed",
      output_text: "I can see it.",
      steps: [{ type: "model_output", content: [{ type: "text", text: "I can see it." }] }]
    });
    const input = geminiInput();
    input.messages = [
      input.messages[0]!,
      { role: "user", content: "Remember this earlier request." },
      { role: "assistant", content: "I remember it." },
      { role: "user", content: "What is in this image?" }
    ];
    input.attachments = [{
      id: "upload_test",
      fileName: "pixel.png",
      mimeType: "image/png",
      sizeBytes: 4,
      url: "data:image/png;base64,iVBORw=="
    }];

    await new GeminiProvider({ createInteraction }).generateResponse(input);

    const request = createInteraction.mock.calls[0]?.[0];
    expect(request.input).toEqual(expect.arrayContaining([
      { type: "text", text: "Current user request:\nWhat is in this image?" },
      { type: "image", data: "iVBORw==", mime_type: "image/png" }
    ]));
  });

  it("uses compact resolved-link context by default for public YouTube links", async () => {
    const createInteraction = vi.fn().mockResolvedValue({
      id: "interaction_youtube",
      status: "completed",
      output_text: "The video explains an EXP system.",
      steps: [{ type: "model_output", content: [{ type: "text", text: "The video explains an EXP system." }] }]
    });
    const input = geminiInput();
    input.messages = [
      input.messages[0]!,
      {
        role: "user",
        content: "Tell me about https://youtu.be/0Y4FoTy0Bf0?si=tracking and https://www.youtube.com/watch?v=0Y4FoTy0Bf0"
      }
    ];
    input.toolOptions = { ...input.toolOptions, webSearch: true };

    await new GeminiProvider({ createInteraction }).generateResponse(input);

    const content = createInteraction.mock.calls[0]?.[0]?.input;
    expect(createInteraction.mock.calls[0]?.[0]?.tools).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "google_search" })
    ]));
    expect(content).not.toEqual(expect.arrayContaining([expect.objectContaining({ type: "video" })]));
    expect(content.at(-1)).toEqual({
      type: "text",
      text: "Current user request:\nTell me about https://youtu.be/0Y4FoTy0Bf0?si=tracking and https://www.youtube.com/watch?v=0Y4FoTy0Bf0"
    });
  });

  it("does not run a redundant Google search for a resolved YouTube follow-up", async () => {
    const createInteraction = vi.fn().mockResolvedValue({
      id: "interaction_youtube_followup",
      status: "completed",
      output_text: "The resolved evidence covers the video.",
      steps: [{ type: "model_output", content: [{ type: "text", text: "The resolved evidence covers the video." }] }]
    });
    const input = geminiInput();
    input.messages = [
      input.messages[0]!,
      {
        role: "user",
        content: "Tool context for the next answer:\nCanonical URL: https://www.youtube.com/watch?v=0Y4FoTy0Bf0"
      },
      { role: "user", content: "What happens next in that video?" }
    ];
    input.toolOptions = { ...input.toolOptions, webSearch: true };

    await new GeminiProvider({ createInteraction }).generateResponse(input);

    expect(createInteraction.mock.calls[0]?.[0]?.tools).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "google_search" })
    ]));
  });

  it("runs explicit native video analysis as a neutral prepass and injects only its compact evidence", async () => {
    const createInteraction = vi.fn()
      .mockResolvedValueOnce({
        id: "video_analysis",
        status: "completed",
        output_text: "Observed: a presenter explains the EXP system at the start.",
        steps: [{ type: "model_output", content: [{
          type: "text",
          text: "Observed: a presenter explains the EXP system at the start."
        }] }],
        usage: { total_input_tokens: 100, total_output_tokens: 12, total_tokens: 112 }
      })
      .mockResolvedValueOnce({
        id: "persona_answer",
        status: "completed",
        output_text: "The presenter breaks down the EXP system.",
        steps: [{ type: "model_output", content: [{
          type: "text",
          text: "The presenter breaks down the EXP system."
        }] }],
        usage: { total_input_tokens: 20, total_output_tokens: 8, total_tokens: 28 }
      });
    const values = new Map<string, PublicMediaAnalysis>();
    const cacheSet = vi.fn<PublicMediaAnalysisCache["set"]>(async (key, value) => {
      values.set(JSON.stringify(key), value);
    });
    const cache: PublicMediaAnalysisCache = {
      get: vi.fn(async () => values.values().next().value),
      set: cacheSet
    };
    const input = geminiInput();
    input.messages = [input.messages[0]!, {
      role: "user",
      content: "Watch https://youtu.be/0Y4FoTy0Bf0 and identify the opening scene."
    }];
    input.toolOptions = { ...input.toolOptions, videoAnalysis: true, videoAnalysisMode: "explicit" };

    const output = await new GeminiProvider({ createInteraction, publicMediaAnalysisCache: cache })
      .generateResponse(input);

    expect(createInteraction).toHaveBeenCalledTimes(2);
    expect(createInteraction.mock.calls[0]?.[0]?.input[0]).toEqual({
      type: "video",
      uri: "https://www.youtube.com/watch?v=0Y4FoTy0Bf0",
      resolution: "low"
    });
    expect(createInteraction.mock.calls[0]?.[0]?.system_instruction).toContain("neutral media-analysis");
    const answerInput = createInteraction.mock.calls[1]?.[0]?.input;
    expect(answerInput).not.toEqual(expect.arrayContaining([expect.objectContaining({ type: "video" })]));
    expect(answerInput).toEqual(expect.arrayContaining([expect.objectContaining({
      type: "text",
      text: expect.stringContaining("Observed: a presenter explains the EXP system")
    })]));
    expect(cacheSet).toHaveBeenCalledTimes(1);
    expect(output.usage).toMatchObject({ inputTokens: 120, outputTokens: 20, totalTokens: 140 });
    expect(output.metadata?.videoAnalysis).toMatchObject({ attempted: true, status: "completed", cacheHit: false });
  });

  it("reuses cached public video analysis without billing or sending the video again", async () => {
    const createInteraction = vi.fn().mockResolvedValue({
      id: "cached_persona_answer",
      status: "completed",
      output_text: "The cached evidence covers the opening scene.",
      steps: [{ type: "model_output", content: [{
        type: "text",
        text: "The cached evidence covers the opening scene."
      }] }],
      usage: { total_input_tokens: 21, total_output_tokens: 9, total_tokens: 30 }
    });
    const cacheSet = vi.fn<PublicMediaAnalysisCache["set"]>();
    const cache: PublicMediaAnalysisCache = {
      get: vi.fn(async () => ({
        analysisText: "Cached observation: the opening introduces the EXP system.",
        inputTokens: 380_000,
        outputTokens: 500,
        reasoningTokens: 0
      })),
      set: cacheSet
    };
    const input = geminiInput();
    input.messages = [input.messages[0]!, {
      role: "user",
      content: "Watch https://youtu.be/0Y4FoTy0Bf0 and identify the opening scene."
    }];
    input.toolOptions = { ...input.toolOptions, videoAnalysis: true, videoAnalysisMode: "explicit" };

    const output = await new GeminiProvider({ createInteraction, publicMediaAnalysisCache: cache })
      .generateResponse(input);

    expect(createInteraction).toHaveBeenCalledTimes(1);
    expect(createInteraction.mock.calls[0]?.[0]?.input).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "video" })
    ]));
    expect(createInteraction.mock.calls[0]?.[0]?.input).toEqual(expect.arrayContaining([
      expect.objectContaining({ text: expect.stringContaining("Cached observation") })
    ]));
    expect(cacheSet).not.toHaveBeenCalled();
    expect(output.usage).toMatchObject({ inputTokens: 21, outputTokens: 9, totalTokens: 30 });
    expect(output.metadata?.videoAnalysis).toMatchObject({ status: "completed", cacheHit: true });
  });

  it("skips native analysis when a verified duration exceeds the explicit ceiling", async () => {
    const createInteraction = vi.fn().mockResolvedValue({
      id: "long_video_answer",
      status: "completed",
      output_text: "The verified metadata identifies a very long video.",
      steps: [{ type: "model_output", content: [{
        type: "text",
        text: "The verified metadata identifies a very long video."
      }] }]
    });
    const cache: PublicMediaAnalysisCache = {
      get: vi.fn(),
      set: vi.fn()
    };
    const input = geminiInput();
    input.messages = [
      input.messages[0]!,
      { role: "user", content: "Tool context for the next answer:\nDuration seconds: 80000" },
      { role: "user", content: "Watch https://youtu.be/0Y4FoTy0Bf0 and analyze every scene." }
    ];
    input.toolOptions = { ...input.toolOptions, videoAnalysis: true, videoAnalysisMode: "explicit" };

    const output = await new GeminiProvider({ createInteraction, publicMediaAnalysisCache: cache })
      .generateResponse(input);

    expect(createInteraction).toHaveBeenCalledTimes(1);
    expect(cache.get).not.toHaveBeenCalled();
    expect(createInteraction.mock.calls[0]?.[0]?.input).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "video" })
    ]));
    expect(output.metadata?.videoAnalysis).toMatchObject({
      attempted: false,
      status: "skipped",
      reason: `duration_exceeds_${env.GEMINI_VIDEO_ANALYSIS_EXPLICIT_MAX_DURATION_SECONDS}_seconds`
    });
  });

  it("keeps ordinary YouTube audio requests on the normal compact route", async () => {
    const createInteraction = vi.fn().mockResolvedValue({
      id: "interaction_youtube_audio",
      status: "completed",
      output_text: "A concise video summary.",
      steps: [{ type: "model_output", content: [{ type: "text", text: "A concise video summary." }] }]
    });
    const input = geminiInput();
    input.audio = true;
    input.messages = [
      input.messages[0]!,
      { role: "user", content: "Summarize https://youtu.be/0Y4FoTy0Bf0" }
    ];

    await new GeminiProvider({ createInteraction }).generateResponse(input);

    const request = createInteraction.mock.calls[0]?.[0];
    expect(request.input).not.toEqual(expect.arrayContaining([expect.objectContaining({ type: "video" })]));
  });

  it("falls back to verified resolved-link context when Gemini rejects an individual YouTube video", async () => {
    const invalidVideoError = Object.assign(new Error("Request contains an invalid argument."), {
      status: 400,
      error: { error: { code: "invalid_request" } }
    });
    const createInteraction = vi.fn()
      .mockRejectedValueOnce(invalidVideoError)
      .mockResolvedValueOnce({
        id: "interaction_youtube_fallback",
        status: "completed",
        output_text: "The verified title and captions describe an EXP system.",
        steps: [{
          type: "model_output",
          content: [{ type: "text", text: "The verified title and captions describe an EXP system." }]
        }]
      });
    const input = geminiInput();
    input.messages = [
      input.messages[0]!,
      {
        role: "user",
        content: [
          "Tool context for the next answer:",
          "Access status: accessible",
          "Title: Everyone Mocked Him Until His EXP System Let Him Gain 1 EXP/Sec"
        ].join("\n")
      },
      { role: "user", content: "Tell me about https://youtu.be/0Y4FoTy0Bf0" }
    ];
    input.toolOptions = { ...input.toolOptions, videoAnalysis: true, videoAnalysisMode: "explicit" };

    const output = await new GeminiProvider({ createInteraction }).generateResponse(input);

    expect(createInteraction).toHaveBeenCalledTimes(2);
    expect(createInteraction.mock.calls[0]?.[0]?.input[0]).toEqual(
      { type: "video", uri: "https://www.youtube.com/watch?v=0Y4FoTy0Bf0", resolution: "low" }
    );
    expect(createInteraction.mock.calls[1]?.[0]?.input).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "video" })
    ]));
    expect(createInteraction.mock.calls[1]?.[0]?.input[0]?.text).toContain("Access status: accessible");
    expect(output.rawText).toContain("verified title and captions");
  });

  it("falls back to resolved-link context when native YouTube processing times out", async () => {
    const timeoutError = Object.assign(new Error("The operation timed out."), { name: "TimeoutError" });
    const createInteraction = vi.fn()
      .mockRejectedValueOnce(timeoutError)
      .mockResolvedValueOnce({
        id: "interaction_youtube_timeout_fallback",
        status: "completed",
        output_text: "The verified title describes the livestream.",
        steps: [{
          type: "model_output",
          content: [{ type: "text", text: "The verified title describes the livestream." }]
        }]
      });
    const input = geminiInput();
    input.messages = [
      input.messages[0]!,
      { role: "user", content: "Tool context for the next answer:\nTitle: A verified livestream" },
      { role: "user", content: "Tell me about https://www.youtube.com/live/Ck_aptcPDek?si=tracking" }
    ];
    input.toolOptions = { ...input.toolOptions, videoAnalysis: true, videoAnalysisMode: "explicit" };

    const output = await new GeminiProvider({ createInteraction }).generateResponse(input);

    expect(createInteraction).toHaveBeenCalledTimes(2);
    expect(createInteraction.mock.calls[0]?.[0]?.input).toEqual(expect.arrayContaining([
      { type: "video", uri: "https://www.youtube.com/watch?v=Ck_aptcPDek", resolution: "low" }
    ]));
    expect(createInteraction.mock.calls[0]?.[1]?.timeout).toBe(
      env.GEMINI_NATIVE_YOUTUBE_REQUEST_TIMEOUT_MS
    );
    expect(createInteraction.mock.calls[1]?.[0]?.input).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "video" })
    ]));
    expect(createInteraction.mock.calls[1]?.[1]?.timeout).toBe(env.GEMINI_REQUEST_TIMEOUT_MS);
    expect(output.rawText).toContain("verified title");
  });

  it("enables Gemini URL context for non-YouTube links", async () => {
    const createInteraction = vi.fn().mockResolvedValue({
      id: "interaction_url",
      status: "completed",
      output_text: "The article is available.",
      steps: [{ type: "model_output", content: [{ type: "text", text: "The article is available." }] }]
    });
    const input = geminiInput();
    input.messages = [input.messages[0]!, { role: "user", content: "Summarize https://example.com/article" }];
    input.toolOptions = { ...input.toolOptions, webSearch: true };

    await new GeminiProvider({ createInteraction }).generateResponse(input);

    expect(createInteraction.mock.calls[0]?.[0]?.tools).toEqual(expect.arrayContaining([
      { type: "google_search" },
      { type: "url_context" }
    ]));
  });

  it("continues application function calls without provider-side stored state", async () => {
    const createInteraction = vi.fn()
      .mockResolvedValueOnce({
        id: "interaction_tool_1",
        status: "requires_action",
        steps: [{
          type: "function_call",
          id: "call_1",
          name: "current_time",
          arguments: { timeZone: "America/Chicago" }
        }]
      })
      .mockResolvedValueOnce({
        id: "interaction_tool_2",
        status: "completed",
        output_text: "It is noon.",
        steps: [{ type: "model_output", content: [{ type: "text", text: "It is noon." }] }],
        usage: { total_input_tokens: 30, total_output_tokens: 4, total_tokens: 34 }
      });
    const input = geminiInput();
    input.clientContext = {
      timeZone: "America/Chicago",
      locale: "en-US",
      currentDateTime: "2026-08-03T17:00:00.000Z"
    };

    const output = await new GeminiProvider({ createInteraction }).generateResponse(input);

    expect(createInteraction).toHaveBeenCalledTimes(2);
    const continuation = createInteraction.mock.calls[1]?.[0];
    expect(continuation.store).toBe(false);
    expect(continuation).not.toHaveProperty("previous_interaction_id");
    expect(continuation.input).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "user_input", content: expect.any(Array) }),
      expect.objectContaining({ type: "function_call", id: "call_1" }),
      expect.objectContaining({ type: "function_result", call_id: "call_1", name: "current_time" })
    ]));
    expect(output.rawText).toBe("It is noon.");
    expect(output.content).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "tool_call", toolName: "current_time" }),
      expect.objectContaining({ type: "tool_result", toolName: "current_time", status: "completed" })
    ]));
  });

  it("does not combine Gemini tools with the structured audio response format", async () => {
    const createInteraction = vi.fn().mockResolvedValue({
      id: "interaction_audio_tools",
      status: "completed",
      output_text: JSON.stringify({
        visible_text: "I do not have any siblings in my established background.",
        tts_script: "I don't have any siblings in my established background."
      }),
      steps: [{
        type: "model_output",
        content: [{
          type: "text",
          text: JSON.stringify({
            visible_text: "I do not have any siblings in my established background.",
            tts_script: "I don't have any siblings in my established background."
          })
        }]
      }]
    });
    const input = geminiInput();
    input.audio = true;
    input.toolOptions = { ...input.toolOptions, appFunctions: true };

    const output = await new GeminiProvider({ createInteraction }).generateResponse(input);

    const request = createInteraction.mock.calls[0]?.[0];
    expect(request.tools).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "function" })
    ]));
    expect(request).not.toHaveProperty("response_format");
    expect(output.rawText).toBe("I do not have any siblings in my established background.");
    expect(output.metadata?.ttsScript).toBe("I don't have any siblings in my established background.");
  });

  it("keeps the structured audio response format when no Gemini tools are present", async () => {
    const createInteraction = vi.fn().mockResolvedValue({
      id: "interaction_audio_without_tools",
      status: "completed",
      output_text: JSON.stringify({ visible_text: "Hey.", tts_script: "Hey..." }),
      steps: [{ type: "model_output", content: [{ type: "text", text: "Hey." }] }]
    });
    const input = geminiInput();
    input.audio = true;
    input.toolOptions = {
      webSearch: false,
      fileSearch: false,
      codeInterpreter: false,
      imageGeneration: false,
      appFunctions: false,
      background: false,
      vectorStoreIds: []
    };

    await new GeminiProvider({ createInteraction }).generateResponse(input);

    expect(createInteraction.mock.calls[0]?.[0]).toMatchObject({
      response_format: {
        type: "text",
        mime_type: "application/json"
      }
    });
  });

  it("converts render_chart results into a native chart block", async () => {
    const createInteraction = vi.fn()
      .mockResolvedValueOnce({
        id: "interaction_chart_1",
        status: "requires_action",
        steps: [{
          type: "function_call",
          id: "call_chart",
          name: "render_chart",
          arguments: {
            version: 1,
            title: "Weekend plans",
            chartType: "donut",
            categories: ["Brunch", "Naps"],
            datasets: [{ id: "share", label: "Share", values: [60, 40] }],
            xAxis: { label: "Plan", dataType: "category" },
            yAxis: { label: "Share", format: "percent", currency: null, unit: null },
            summary: "Brunch wins the weekend.",
            sourceNote: null
          }
        }]
      })
      .mockResolvedValueOnce({
        id: "interaction_chart_2",
        status: "completed",
        output_text: "Here is your chart.",
        steps: [{ type: "model_output", content: [{ type: "text", text: "Here is your chart." }] }],
        usage: { total_input_tokens: 30, total_output_tokens: 4, total_tokens: 34 }
      });

    const output = await new GeminiProvider({ createInteraction }).generateResponse(geminiInput());

    expect(output.content).toContainEqual(expect.objectContaining({
      type: "chart",
      chartType: "donut",
      title: "Weekend plans"
    }));
    expect(output.content).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "tool_call", toolName: "render_chart" }),
      expect.objectContaining({ type: "tool_result", toolName: "render_chart" })
    ]));
    const continuation = createInteraction.mock.calls[1]?.[0];
    expect(continuation.input).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "function_result", call_id: "call_chart", name: "render_chart" })
    ]));
  });

  it("keeps analysis on Gemini now that downloadable files use an application tool", async () => {
    const input = geminiInput();
    input.toolOptions = { ...input.toolOptions, codeInterpreter: true };

    const output = await new GeminiProvider().generateResponse(input);

    expect(output.provider).toBe("gemini");
    expect(output.metadata?.delegatedProvider).toBeUndefined();
    expect(output.metadata?.delegatedCapability).toBeUndefined();
  });

  it("does not expose developer-facing Interactions failure details", async () => {
    const createInteraction = vi.fn().mockResolvedValue({
      id: "interaction_failed",
      status: "failed",
      steps: [{
        type: "model_output",
        error: { code: 13, message: "internal backend host and request details" }
      }]
    });

    await expect(new GeminiProvider({ createInteraction }).generateResponse(geminiInput()))
      .rejects.toMatchObject({
        statusCode: 502,
        message: "Gemini could not complete the response. Please try again."
      });
  });
});
