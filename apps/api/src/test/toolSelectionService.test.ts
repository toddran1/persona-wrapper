import { describe, expect, it } from "vitest";
import { mergeImageOrientation, mergeMediaReference, selectTools, shouldEnableWebSearchForMessage } from "../services/toolSelectionService.js";

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
      toolOptions: { codeInterpreter: false, appFunctions: true }
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

  it("uses resolved-link context by default and native video only for deep audiovisual requests", async () => {
    await expect(selectTools(request("Summarize https://youtu.be/0Y4FoTy0Bf0"))).resolves.toMatchObject({
      toolOptions: { webSearch: true, videoAnalysis: false }
    });
    await expect(selectTools(request(
      "Watch https://youtu.be/0Y4FoTy0Bf0 and identify the on-screen scenes with timestamps."
    ))).resolves.toMatchObject({
      toolOptions: { webSearch: true, videoAnalysis: true, videoAnalysisMode: "explicit" }
    });
  });

  it("keeps the final web-search guard narrow", () => {
    expect(shouldEnableWebSearchForMessage("Help me write a friendly apology.")).toBe(false);
    expect(shouldEnableWebSearchForMessage("Who is the current CEO of Apple?")).toBe(true);
    expect(shouldEnableWebSearchForMessage("What was Playboi Carti's last album and first-week sales?")).toBe(true);
    expect(shouldEnableWebSearchForMessage("How many points did Morez Johnson Jr. score in his last Dallas Mavericks game?")).toBe(true);
    expect(shouldEnableWebSearchForMessage("https://youtu.be/0Y4FoTy0Bf0?si=test")).toBe(true);
    expect(shouldEnableWebSearchForMessage("Tell me about https://example.com/article")).toBe(true);
  });

  it("stamps a deterministic media-reference hint from the visual patterns", async () => {
    await expect(selectTools(request("ok now remove the sunglasses"))).resolves.toMatchObject({
      mediaReferenceHint: "transform"
    });
    await expect(selectTools(request("Does it have sunglasses?"))).resolves.toMatchObject({
      mediaReferenceHint: "inspect"
    });
    await expect(selectTools(request("Give me a pound cake recipe."))).resolves.toMatchObject({
      mediaReferenceHint: "none"
    });
  });

  it("uses the router verdict only as a backstop for pattern misses", () => {
    expect(mergeMediaReference("none", "transform")).toBe("transform");
    expect(mergeMediaReference("none", "inspect")).toBe("inspect");
    expect(mergeMediaReference("inspect", "transform")).toBe("inspect");
    expect(mergeMediaReference("transform", "none")).toBe("transform");
    expect(mergeMediaReference("none", "none")).toBe("none");
    expect(mergeMediaReference("none", undefined)).toBe("none");
  });

  it("stamps image orientation from deterministic hints and merges router verdicts", async () => {
    await expect(selectTools(request("make it 16:9"))).resolves.toMatchObject({
      imageOrientation: "landscape"
    });
    await expect(selectTools(request("a phone wallpaper of her"))).resolves.toMatchObject({
      imageOrientation: "portrait"
    });
    // No hint and (in tests) no router: the field is omitted.
    const plain = await selectTools(request("a picture of a sunset over the ocean"));
    expect(plain.imageOrientation).toBeUndefined();

    expect(mergeImageOrientation("auto", "portrait")).toBe("portrait");
    expect(mergeImageOrientation("landscape", "portrait")).toBe("landscape");
    expect(mergeImageOrientation("auto", "auto")).toBe("auto");
    expect(mergeImageOrientation("auto", undefined)).toBe("auto");
  });

  it("never trusts a client-supplied imageOrientation stamp", async () => {
    // With no hint of our own, a spoofed stamp is dropped entirely.
    const spoofed = await selectTools({
      ...request("a picture of a sunset over the ocean"),
      imageOrientation: "landscape" as const
    });
    expect(spoofed.imageOrientation).toBeUndefined();
    // With a real hint, the server's verdict replaces the spoofed one.
    const overridden = await selectTools({
      ...request("make it 9:16"),
      imageOrientation: "landscape" as const
    });
    expect(overridden.imageOrientation).toBe("portrait");
  });
});
