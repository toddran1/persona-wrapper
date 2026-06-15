import { describe, expect, it } from "vitest";
import { selectTools } from "../services/toolSelectionService.js";

function request(message: string) {
  return {
    personaId: "larae",
    provider: "openai" as const,
    message,
    audio: false,
    testMode: false,
    history: []
  };
}

describe("tool selection", () => {
  it("automatically enables web search for current information", () => {
    expect(selectTools(request("Who is the current CEO of Apple?")).toolOptions?.webSearch).toBe(true);
  });

  it("automatically enables image generation for image requests", () => {
    expect(selectTools(request("Create an image of a neon Dallas skyline.")).toolOptions?.imageGeneration).toBe(true);
  });

  it("does not enable expensive tools for ordinary chat", () => {
    const tools = selectTools(request("Help me write a friendly apology.")).toolOptions;
    expect(tools?.webSearch).toBe(false);
    expect(tools?.codeInterpreter).toBe(false);
    expect(tools?.imageGeneration).toBe(false);
  });
});
