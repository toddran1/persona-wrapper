import { describe, expect, it } from "vitest";
import { getPersonaById } from "../personas/index.js";
import { OpenAIProvider } from "../providers/llm/OpenAIProvider.js";
import { PersonaEngine } from "../services/personaEngine.js";

const runLive = process.env.OPENAI_RUN_INTEGRATION_TESTS === "true" && Boolean(process.env.OPENAI_API_KEY);
const persona = getPersonaById("larae")!;

function input(message: string, overrides: Record<string, unknown> = {}) {
  return {
    ...new PersonaEngine().prepareInput(persona, {
      personaId: persona.id,
      provider: "openai",
      message,
      audio: false,
      testMode: false,
      history: [],
      ...overrides
    }),
    ...overrides
  };
}

describe.runIf(runLive).sequential("OpenAI live integration", () => {
  const provider = new OpenAIProvider();

  it("returns real text, usage, and response metadata", async () => {
    const result = await provider.generateResponse(input("Reply with exactly: integration ready"));
    expect(result.rawText.toLowerCase()).toContain("integration ready");
    expect(result.usage?.inputTokens).toBeGreaterThan(0);
    expect(result.metadata?.responseId).toMatch(/^resp_/);
  }, 120000);

  it("streams text deltas", async () => {
    const deltas: string[] = [];
    const result = await provider.generateResponseStream(input("Reply with one short sentence about Dallas."), {
      onTextDelta: (delta) => deltas.push(delta)
    });
    expect(deltas.join("").length).toBeGreaterThan(0);
    expect(result.rawText.length).toBeGreaterThan(0);
  }, 120000);

  it("uses hosted web search and returns sources", async () => {
    const result = await provider.generateResponse(input("Use web search to find one recent OpenAI product announcement. Include and cite the source.", {
      toolOptions: {
        webSearch: true, fileSearch: false, codeInterpreter: false, imageGeneration: false,
        appFunctions: true, background: false, vectorStoreIds: []
      }
    }));
    expect(result.content.some((block) => block.type === "source_list")).toBe(true);
  }, 120000);

  it("understands an attached image", async () => {
    const result = await provider.generateResponse(input("What is the dominant color in this image?", {
      attachments: [{
        id: "integration-image",
        kind: "image",
        fileName: "pixel.png",
        mimeType: "image/png",
        sizeBytes: 68,
        url: "https://placehold.co/128x128/ff0000/ffffff.png"
      }]
    }));
    expect(result.rawText.length).toBeGreaterThan(0);
  }, 120000);

  it("runs the registered current-time application function", async () => {
    const result = await provider.generateResponse(input("Call the current_time function for America/Chicago, then tell me the returned time.", {
      clientContext: { locale: "en-US", timeZone: "America/Chicago", currentDateTime: "2026-06-15T18:00:00.000Z" }
    }));
    expect(result.rawText.length).toBeGreaterThan(0);
    expect(result.content.some((block) => block.type === "tool_call")).toBe(true);
  }, 120000);

  it("uses Code Interpreter for an explicit analysis request", async () => {
    const result = await provider.generateResponse(input("You must use Code Interpreter to calculate the sum of 17, 29, and 54 and create a small bar chart of the three values.", {
      toolOptions: {
        webSearch: false, fileSearch: false, codeInterpreter: true, imageGeneration: false,
        appFunctions: true, background: false, vectorStoreIds: []
      }
    }));
    expect(result.content.some((block) => block.type === "tool_result" && block.toolName === "data_analysis")).toBe(true);
  }, 120000);
});
