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
  it("automatically enables web search for current information", async () => {
    await expect(selectTools(request("Who is the current CEO of Apple?"))).resolves.toMatchObject({
      toolOptions: { webSearch: true }
    });
  });

  it("automatically enables image generation for image requests", async () => {
    await expect(selectTools(request("Create an image of a neon Dallas skyline."))).resolves.toMatchObject({
      toolOptions: { imageGeneration: true }
    });
    await expect(selectTools(request("Can you give me an image of Knuckles in a black suit?"))).resolves.toMatchObject({
      toolOptions: { imageGeneration: true }
    });
    await expect(selectTools(request("Show me a realistic photo of a red sports car."))).resolves.toMatchObject({
      toolOptions: { imageGeneration: true }
    });
  });

  it("automatically enables analysis for dashboard, chart, and file output requests", async () => {
    await expect(selectTools(request("Turn this into a dashboard."))).resolves.toMatchObject({
      toolOptions: { codeInterpreter: true }
    });
    await expect(selectTools(request("Make a pie chart for apples 40, oranges 35, bananas 25."))).resolves.toMatchObject({
      toolOptions: { codeInterpreter: true }
    });
    await expect(selectTools(request("Make this into a downloadable CSV file."))).resolves.toMatchObject({
      toolOptions: { codeInterpreter: true }
    });
  });

  it("does not enable expensive tools for ordinary chat", async () => {
    const tools = (await selectTools(request("Help me write a friendly apology."))).toolOptions;
    expect(tools?.webSearch).toBe(false);
    expect(tools?.codeInterpreter).toBe(false);
    expect(tools?.imageGeneration).toBe(false);
  });
});
