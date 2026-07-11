import { describe, expect, it } from "vitest";
import { selectTools, shouldEnableWebSearchForMessage } from "../services/toolSelectionService.js";

function request(message: string, attachments: Array<{ id: string; kind: "file" | "image"; fileName: string; mimeType: string; sizeBytes: number }> = []) {
  return {
    personaId: "larae",
    provider: "openai" as const,
    message,
    audio: false,
    testMode: false,
    history: [],
    attachments
  };
}

describe("tool selection", () => {
  it("automatically enables web search for current information", async () => {
    await expect(selectTools(request("Who is the current CEO of Apple?"))).resolves.toMatchObject({
      toolOptions: { webSearch: true }
    });
    for (const prompt of [
      "What is the weather in Dallas tomorrow?",
      "Find the latest iPhone price and availability.",
      "Who won last night's game?",
      "Verify this claim and cite your sources.",
      "What are the current visa requirements for Japan?",
      "Recommend the best reviewed hotel near the convention center."
    ]) {
      await expect(selectTools(request(prompt))).resolves.toMatchObject({ toolOptions: { webSearch: true } });
    }
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
    await expect(selectTools(request("What would LaRae look like as a comic-book hero?"))).resolves.toMatchObject({
      toolOptions: { imageGeneration: true }
    });
    await expect(selectTools(request("Remove the background and recolor her jacket.", [
      { id: "image-1", kind: "image", fileName: "portrait.png", mimeType: "image/png", sizeBytes: 1024 }
    ]))).resolves.toMatchObject({ toolOptions: { imageGeneration: true } });
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
    await expect(selectTools(request("Calculate the median, find outliers, and plot a histogram."))).resolves.toMatchObject({
      toolOptions: { codeInterpreter: true }
    });
    await expect(selectTools(request("Clean and deduplicate the rows in this spreadsheet."))).resolves.toMatchObject({
      toolOptions: { codeInterpreter: true }
    });
  });

  it("enables file search only when an uploaded file is relevant", async () => {
    const file = { id: "file-1", kind: "file" as const, fileName: "contract.pdf", mimeType: "application/pdf", sizeBytes: 2048 };
    await expect(selectTools(request("Summarize the attached contract and quote its cancellation clause.", [file]))).resolves.toMatchObject({
      toolOptions: { fileSearch: true }
    });
    await expect(selectTools(request("Summarize the attached contract and quote its cancellation clause."))).resolves.toMatchObject({
      toolOptions: { fileSearch: false }
    });
  });

  it("does not enable expensive tools for ordinary chat", async () => {
    for (const prompt of [
      "Help me write a friendly apology.",
      "Rate this outfit from one to ten.",
      "Which AI model are you?",
      "Make this paragraph clearer."
    ]) {
      const tools = (await selectTools(request(prompt))).toolOptions;
      expect(tools?.webSearch).toBe(false);
      expect(tools?.codeInterpreter).toBe(false);
      expect(tools?.imageGeneration).toBe(false);
      expect(tools?.fileSearch).toBe(false);
    }
  });

  it("keeps the final web-search guard narrow", () => {
    expect(shouldEnableWebSearchForMessage("Help me write a friendly apology.")).toBe(false);
    expect(shouldEnableWebSearchForMessage("Who is the current CEO of Apple?")).toBe(true);
    expect(shouldEnableWebSearchForMessage("What was Playboi Carti's last album and first-week sales?")).toBe(true);
    expect(shouldEnableWebSearchForMessage("How many points did Morez Johnson Jr. score in his last Dallas Mavericks game?")).toBe(true);
  });
});
