import { describe, expect, it, vi } from "vitest";
import type { LLMInput } from "@persona/shared";
import { getPersonaById } from "../personas/index.js";
import { GeminiProvider } from "../providers/llm/GeminiProvider.js";
import { PersonaEngine } from "../services/personaEngine.js";

function geminiInput(imageGeneration = false): LLMInput {
  const persona = getPersonaById("larae");
  if (!persona) throw new Error("LaRae persona not found");
  return new PersonaEngine().prepareInput(persona, {
    personaId: persona.id,
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
      expect.objectContaining({ type: "user_input" })
    ]));
    expect(output.usage).toMatchObject({ inputTokens: 21, outputTokens: 8, totalTokens: 29, reasoningTokens: 2 });
    expect(output.content).toContainEqual(expect.objectContaining({
      type: "source_list",
      sources: [expect.objectContaining({ url: "https://example.com/source" })]
    }));
    expect(output.metadata?.interactionStored).toBe(false);
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
    expect(request.input).toHaveLength(1);
    expect(request.input).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "model_output" })
    ]));
    expect(request.input[0]).toMatchObject({
      type: "user_input",
      content: [
        expect.objectContaining({
          type: "text",
          text: expect.stringContaining("[Assistant persona: Bam Bam | id=bambam]")
        }),
        { type: "text", text: "Current user request:\nWhat did each persona say?" }
      ]
    });
    const historyText = request.input[0]?.content?.[0]?.text;
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
    expect(request.input).toHaveLength(1);
    expect(request.input[0]?.content).toEqual(expect.arrayContaining([
      { type: "text", text: "Current user request:\nWhat is in this image?" },
      { type: "image", data: "iVBORw==", mime_type: "image/png" }
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

  it("delegates code interpreter requests to OpenAI for downloadable files", async () => {
    const input = geminiInput();
    input.toolOptions = { ...input.toolOptions, codeInterpreter: true };

    const output = await new GeminiProvider().generateResponse(input);

    expect(output.provider).toBe("gemini");
    expect(output.metadata?.delegatedProvider).toBe("openai");
    expect(output.metadata?.delegatedCapability).toBe("code_interpreter");
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
