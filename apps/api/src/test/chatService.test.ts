import { describe, expect, it } from "vitest";
import { ChatService } from "../services/chatService.js";
import { ConversationStore } from "../services/conversationStore.js";

describe("ChatService", () => {
  it("does not echo the raw user prompt as the assistant reply", async () => {
    const service = new ChatService();

    const response = await service.handleChat({
      personaId: "larae",
      provider: "openai",
      message: "Hi LaRae, please introduce yourself.",
      audio: false,
      testMode: false,
      history: []
    });

    const assistantReply = response.outputs.find((output) => output.type === "text");

    expect(assistantReply?.type).toBe("text");
    expect(assistantReply?.type === "text" ? assistantReply.text : "").not.toContain(
      "Hi LaRae, please introduce yourself."
    );
    expect(assistantReply?.type === "text" ? assistantReply.text : "").toContain("I’m LaRae the Baddest");
    expect(assistantReply?.type === "text" ? assistantReply.text : "").toContain("Ok bitch!");
  });

  it("persists conversation history across turns", async () => {
    const service = new ChatService();

    const first = await service.handleChat({
      personaId: "larae",
      provider: "openai",
      message: "Give me a dramatic intro.",
      audio: false,
      testMode: false,
      history: []
    });

    const second = await service.handleChat({
      personaId: "larae",
      provider: "openai",
      message: "Now turn that into a chart and a csv file.",
      audio: false,
      testMode: false,
      conversationId: first.conversationId,
      history: []
    });

    expect(second.conversationId).toBe(first.conversationId);
    expect(second.history).toHaveLength(4);
    expect(second.outputs.some((output) => output.type === "chart")).toBe(true);
    expect(second.outputs.some((output) => output.type === "file")).toBe(true);
  });

  it("streams neutral text and returns the final styled response", async () => {
    const service = new ChatService();
    const deltas: string[] = [];

    const response = await service.handleChat({
      personaId: "larae",
      provider: "openai",
      message: "Give me a short introduction.",
      audio: false,
      testMode: false,
      history: []
    }, {
      onTextDelta: (delta) => deltas.push(delta)
    });

    expect(deltas.join("")).toContain("LaRae the Baddest");
    const finalText = response.outputs.find((output) => output.type === "text");
    expect(finalText?.type === "text" ? finalText.text : "").toContain("Ok bitch!");
  });

  it("uses OpenAI direct persona without the separate style transfer pass", async () => {
    const service = new ChatService();

    const response = await service.handleChat({
      personaId: "larae",
      provider: "openai_persona",
      message: "Hi LaRae, please introduce yourself.",
      audio: false,
      testMode: true,
      history: []
    });

    const assistantReply = response.outputs.find((output) => output.type === "text");
    const assistantText = assistantReply?.type === "text" ? assistantReply.text : "";

    expect(response.provider).toBe("openai_persona");
    expect(response.diagnostics.neutralResponse).toBe(assistantText);
    expect(assistantText).toContain("I’m LaRae the Baddest");
    expect(assistantText).not.toContain("Bitch, be serious.");
  });

  it("stops before generation when the request is cancelled", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(new ChatService().handleChat({
      personaId: "larae",
      provider: "openai",
      message: "Do not finish this request.",
      audio: false,
      testMode: false,
      history: []
    }, undefined, controller.signal)).rejects.toThrow();
  });

  it("returns a deterministic fallback when referenced generated media is no longer available", async () => {
    const conversationStore = new ConversationStore();
    const service = new ChatService(conversationStore);
    const conversation = await conversationStore.getOrCreate(undefined, [], {
      userId: "owner-a",
      personaId: "larae",
      titleSeed: "Give me an image of a sleeping puppy."
    });

    const seededConversation = await conversationStore.appendTurn(conversation, [
      {
        role: "user",
        content: "Give me an image of a sleeping puppy."
      },
      {
        role: "assistant",
        content: "Here is the image.",
        metadata: {
          provider: "openai_persona",
          outputs: [
            {
              type: "image",
              url: "/api/generated-media/media_missing",
              alt: "sleeping puppy",
              mimeType: "image/png",
              metadata: {
                generatedMediaId: "media_missing"
              }
            }
          ]
        }
      }
    ]);

    const response = await service.handleChat(
      {
        personaId: "larae",
        provider: "openai_persona",
        message: "What breed of puppy did you just send me?",
        audio: true,
        testMode: false,
        conversationId: seededConversation.id,
        history: []
      },
      undefined,
      undefined,
      undefined,
      { ownerId: "owner-a" }
    );

    const assistantReply = response.outputs.find((output) => output.type === "text");
    expect(assistantReply?.type === "text" ? assistantReply.text : "").toContain("image file is no longer available");
    expect(response.outputs.some((output) => output.type === "audio")).toBe(false);
    expect(response.history.at(-1)?.content).toContain("image file is no longer available");
  });
});
