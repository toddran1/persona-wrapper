import { describe, expect, it } from "vitest";
import type { ConversationStore } from "../services/conversationStore.js";
import { DataTransferService, parseImportArchive } from "../services/dataTransferService.js";

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

  it("preserves the responding persona for mixed-persona archive messages", () => {
    const result = parseImportArchive({
      format: "for-the-baddiez-export",
      version: 1,
      exportedAt: "2026-07-12T00:00:00.000Z",
      scope: "conversations",
      conversations: [{
        title: "Mixed personas",
        messages: [
          { role: "user", content: "Answer this" },
          { role: "assistant", content: "First answer", personaId: "larae" },
          { role: "user", content: "Now you answer" },
          { role: "assistant", content: "Second answer", personaId: "future-persona" }
        ]
      }]
    });

    expect(result.conversations[0]?.messages
      .filter((message) => message.role === "assistant")
      .map((message) => message.personaId)).toEqual(["larae", "future-persona"]);
  });

  it("exports the persona attached to each assistant turn", async () => {
    const store = {
      list: async () => [{ id: "conv_mixed" }],
      get: async () => ({
        id: "conv_mixed",
        title: "Mixed export",
        pinned: false,
        messageCount: 4,
        createdAt: "2026-07-12T00:00:00.000Z",
        updatedAt: "2026-07-12T00:01:00.000Z",
        history: [
          { role: "user", content: "First" },
          { role: "assistant", content: "LaRae answer" },
          { role: "user", content: "Second" },
          { role: "assistant", content: "Other answer" }
        ],
        turns: [
          {
            personaId: "larae",
            userMessage: "First",
            userAssets: [],
            assistantText: "LaRae answer",
            outputs: [{ type: "text", text: "LaRae answer" }]
          },
          {
            personaId: "future-persona",
            userMessage: "Second",
            userAssets: [],
            assistantText: "Other answer",
            outputs: [{ type: "text", text: "Other answer" }]
          }
        ]
      })
    } as unknown as ConversationStore;

    const archive = await new DataTransferService(store).exportConversations("user_test");
    expect(archive.conversations[0]?.messages
      .filter((message) => message.role === "assistant")
      .map((message) => message.personaId)).toEqual(["larae", "future-persona"]);
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

  it("imports only the active ChatGPT branch", () => {
    const result = parseImportArchive([{
      title: "Branched conversation",
      current_node: "assistant-current",
      mapping: {
        root: { parent: null, message: { author: { role: "system" }, content: { parts: ["System"] }, create_time: 1 } },
        user: { parent: "root", message: { author: { role: "user" }, content: { parts: ["Question"] }, create_time: 2 } },
        "assistant-abandoned": { parent: "user", message: { author: { role: "assistant" }, content: { parts: ["Abandoned answer"] }, create_time: 3 } },
        "assistant-current": { parent: "user", message: { author: { role: "assistant" }, content: { parts: ["Current answer"] }, create_time: 4 } }
      }
    }]);

    expect(result.conversations[0]?.messages.map((message) => message.content)).toEqual(["System", "Question", "Current answer"]);
  });

  it("reports external conversations beyond the import limit as skipped", () => {
    const result = parseImportArchive(Array.from({ length: 101 }, (_, index) => ({
      name: `Claude export ${index}`,
      chat_messages: [{ sender: "human", text: "Hello" }]
    })));

    expect(result.conversations).toHaveLength(100);
    expect(result.skipped).toBe(1);
  });

  it("ignores invalid external timestamps instead of failing the import", () => {
    const result = parseImportArchive([{
      title: "Invalid timestamp",
      mapping: {
        user: { message: { author: { role: "user" }, content: { parts: ["Hello"] }, create_time: Number.MAX_VALUE } }
      }
    }]);

    expect(result.conversations[0]?.messages[0]).toEqual({ role: "user", content: "Hello" });
  });

  it("normalizes a Claude messages export", () => {
    const result = parseImportArchive({ conversations: [{
      name: "Claude export",
      chat_messages: [{ sender: "human", text: "Hello" }, { sender: "assistant", text: "Hi" }]
    }] });
    expect(result.source).toBe("claude");
    expect(result.conversations[0]?.messages.map((message) => message.role)).toEqual(["user", "assistant"]);
  });

  it("normalizes nested text blocks from current ChatGPT and Claude exports", () => {
    const chatGpt = parseImportArchive([{
      title: "Multimodal export",
      mapping: {
        user: { message: { author: { role: "user" }, content: { content_type: "multimodal_text", parts: [{ type: "text", text: "Describe this" }] } } }
      }
    }]);
    const claude = parseImportArchive([{
      name: "Block export",
      chat_messages: [{ sender: "assistant", content: [{ type: "text", text: "Nested Claude text" }] }]
    }]);

    expect(chatGpt.conversations[0]?.messages[0]?.content).toBe("Describe this");
    expect(claude.conversations[0]?.messages[0]?.content).toBe("Nested Claude text");
  });

  it("rejects unsupported input", () => {
    expect(() => parseImportArchive({ unexpected: true })).toThrow("Unsupported export file");
  });

  it("reports persistence failures as server errors instead of invalid imports", async () => {
    const store = {
      importPortable: async () => { throw new Error("database unavailable"); }
    } as unknown as ConversationStore;
    const service = new DataTransferService(store);

    await expect(service.importArchive("user_test", {
      format: "for-the-baddiez-export",
      version: 1,
      exportedAt: "2026-07-12T00:00:00.000Z",
      scope: "conversations",
      conversations: [{ title: "Hello", messages: [{ role: "user", content: "Hi" }] }]
    })).rejects.toMatchObject({
      statusCode: 500,
      message: "The export was valid, but its conversations could not be saved. Please try again."
    });
  });
});
