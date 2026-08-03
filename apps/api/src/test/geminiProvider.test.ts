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
