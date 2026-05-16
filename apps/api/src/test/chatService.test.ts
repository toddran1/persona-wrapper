import { describe, expect, it } from "vitest";
import { ChatService } from "../services/chatService.js";

describe("ChatService", () => {
  it("does not echo the raw user prompt as the assistant reply", async () => {
    const service = new ChatService();

    const response = await service.handleChat({
      personaId: "larae",
      provider: "openai",
      message: "LaRae, introduce yourself like you just walked into the reunion special.",
      audio: false,
      history: []
    });

    const assistantReply = response.outputs.find((output) => output.type === "text");

    expect(assistantReply?.type).toBe("text");
    expect(assistantReply?.type === "text" ? assistantReply.text : "").not.toContain(
      "LaRae, introduce yourself like you just walked into the reunion special."
    );
    expect(assistantReply?.type === "text" ? assistantReply.text : "").toContain("I’m LaRae the Baddest");
    expect(assistantReply?.type === "text" ? assistantReply.text : "").toContain("Gurl, be serious.");
  });

  it("persists conversation history across turns", async () => {
    const service = new ChatService();

    const first = await service.handleChat({
      personaId: "larae",
      provider: "openai",
      message: "Give me a dramatic intro.",
      audio: false,
      history: []
    });

    const second = await service.handleChat({
      personaId: "larae",
      provider: "openai",
      message: "Now turn that into a chart and a csv file.",
      audio: false,
      conversationId: first.conversationId,
      history: []
    });

    expect(second.conversationId).toBe(first.conversationId);
    expect(second.history).toHaveLength(4);
    expect(second.outputs.some((output) => output.type === "chart")).toBe(true);
    expect(second.outputs.some((output) => output.type === "file")).toBe(true);
  });
});
