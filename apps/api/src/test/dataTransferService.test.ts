import { describe, expect, it } from "vitest";
import { parseImportArchive } from "../services/dataTransferService.js";

describe("data transfer import parsing", () => {
  it("accepts a versioned For the Baddiez archive", () => {
    const result = parseImportArchive({
      format: "for-the-baddiez-export",
      version: 1,
      exportedAt: "2026-07-12T00:00:00.000Z",
      scope: "conversations",
      conversations: [{ title: "Hello", messages: [{ role: "user", content: "Hi" }] }]
    });
    expect(result.source).toBe("for-the-baddiez");
    expect(result.conversations[0]?.title).toBe("Hello");
  });

  it("normalizes a ChatGPT conversations export", () => {
    const result = parseImportArchive([{
      title: "ChatGPT export",
      create_time: 1_700_000_000,
      mapping: {
        assistant: { message: { author: { role: "assistant" }, content: { parts: ["Hi there"] }, create_time: 1_700_000_001 } },
        user: { message: { author: { role: "user" }, content: { parts: ["Hello"] }, create_time: 1_700_000_000 } }
      }
    }]);
    expect(result.source).toBe("chatgpt");
    expect(result.conversations[0]?.messages.map((message) => message.content)).toEqual(["Hello", "Hi there"]);
  });

  it("normalizes a Claude messages export", () => {
    const result = parseImportArchive({ conversations: [{
      name: "Claude export",
      chat_messages: [{ sender: "human", text: "Hello" }, { sender: "assistant", text: "Hi" }]
    }] });
    expect(result.source).toBe("claude");
    expect(result.conversations[0]?.messages.map((message) => message.role)).toEqual(["user", "assistant"]);
  });

  it("rejects unsupported input", () => {
    expect(() => parseImportArchive({ unexpected: true })).toThrow("Unsupported export file");
  });
});
