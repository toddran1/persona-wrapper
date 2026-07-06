import { afterEach, describe, expect, it } from "vitest";
import { env } from "../config/env.js";
import { ConversationStore } from "../services/conversationStore.js";
import { estimateChatMessagesTokens } from "../utils/tokenBudget.js";

const originalContextMessages = env.OPENAI_MAX_CONTEXT_MESSAGES;
const originalContextCharacters = env.OPENAI_MAX_CONTEXT_CHARACTERS;
const originalContextTokens = env.OPENAI_MAX_CONTEXT_TOKENS;
const originalMemorySummaryMaxTokens = env.CONVERSATION_MEMORY_SUMMARY_MAX_TOKENS;

afterEach(() => {
  env.OPENAI_MAX_CONTEXT_MESSAGES = originalContextMessages;
  env.OPENAI_MAX_CONTEXT_CHARACTERS = originalContextCharacters;
  env.OPENAI_MAX_CONTEXT_TOKENS = originalContextTokens;
  env.CONVERSATION_MEMORY_SUMMARY_MAX_TOKENS = originalMemorySummaryMaxTokens;
});

describe("ConversationStore prompt context", () => {
  it("keeps complete recent turns and never starts context with an assistant reply", async () => {
    const store = new ConversationStore();
    const conversation = await store.getOrCreate("context-test", [
      { role: "assistant", content: "orphaned old reply" },
      { role: "user", content: "first question" },
      { role: "assistant", content: "first answer" },
      { role: "user", content: "recent question" },
      { role: "assistant", content: "recent answer" }
    ]);

    const history = store.getPromptHistory(conversation);
    expect(history[0]?.role).toBe("user");
    expect(history.at(-1)?.content).toBe("recent answer");
  });

  it("skips empty assistant messages when building prompt history", async () => {
    const store = new ConversationStore();
    const conversation = await store.getOrCreate("empty-message-context-test", [
      { role: "user", content: "make an image" },
      { role: "assistant", content: "" },
      { role: "user", content: "describe the image" }
    ]);

    const history = store.getPromptHistory(conversation);
    expect(history.map((message) => message.content)).toEqual(["make an image", "describe the image"]);
  });

  it("respects the configured context message budget", async () => {
    env.OPENAI_MAX_CONTEXT_MESSAGES = 4;
    env.OPENAI_MAX_CONTEXT_CHARACTERS = 10000;
    env.OPENAI_MAX_CONTEXT_TOKENS = 10000;
    const store = new ConversationStore();
    const seed = Array.from({ length: 12 }, (_, index) => ({
      role: index % 2 === 0 ? "user" as const : "assistant" as const,
      content: `message ${index}`
    }));
    const conversation = await store.getOrCreate("message-budget-test", seed);

    const history = store.getPromptHistory(conversation);
    expect(history).toHaveLength(4);
    expect(history[0]?.role).toBe("user");
    expect(history.map((message) => message.content)).toEqual(["message 8", "message 9", "message 10", "message 11"]);
  });

  it("respects the configured context character budget", async () => {
    env.OPENAI_MAX_CONTEXT_MESSAGES = 20;
    env.OPENAI_MAX_CONTEXT_CHARACTERS = 90;
    env.OPENAI_MAX_CONTEXT_TOKENS = 10000;
    const store = new ConversationStore();
    const conversation = await store.getOrCreate("character-budget-test", [
      { role: "user", content: "older user message ".repeat(5) },
      { role: "assistant", content: "older assistant message ".repeat(5) },
      { role: "user", content: "recent user message with enough text" },
      { role: "assistant", content: "recent assistant answer with enough text" }
    ]);

    const history = store.getPromptHistory(conversation);
    expect(history.map((message) => message.content)).toEqual([
      "recent user message with enough text",
      "recent assistant answer with enough text"
    ]);
    expect(history.reduce((total, message) => total + message.content.length, 0)).toBeLessThanOrEqual(90);
  });

  it("respects the configured context token budget", async () => {
    env.OPENAI_MAX_CONTEXT_MESSAGES = 20;
    env.OPENAI_MAX_CONTEXT_CHARACTERS = 10000;
    env.OPENAI_MAX_CONTEXT_TOKENS = 34;
    const store = new ConversationStore();
    const conversation = await store.getOrCreate("token-budget-test", [
      { role: "user", content: "older user message ".repeat(16) },
      { role: "assistant", content: "older assistant message ".repeat(16) },
      { role: "user", content: "recent user question" },
      { role: "assistant", content: "recent assistant answer" }
    ]);

    const history = store.getPromptHistory(conversation);
    expect(history.map((message) => message.content)).toEqual([
      "recent user question",
      "recent assistant answer"
    ]);
    expect(estimateChatMessagesTokens(history)).toBeLessThanOrEqual(34);
  });

  it("trims an oversized newest message instead of dropping the whole context", async () => {
    env.OPENAI_MAX_CONTEXT_MESSAGES = 20;
    env.OPENAI_MAX_CONTEXT_CHARACTERS = 10000;
    env.OPENAI_MAX_CONTEXT_TOKENS = 120;
    const store = new ConversationStore();
    const conversation = await store.getOrCreate("oversized-token-budget-test", [
      { role: "user", content: "current very long prompt ".repeat(120) }
    ]);

    const history = store.getPromptHistory(conversation);
    expect(history).toHaveLength(1);
    expect(history[0]?.role).toBe("user");
    expect(history[0]?.content).toContain("[truncated to fit context budget]");
    expect(estimateChatMessagesTokens(history)).toBeLessThanOrEqual(130);
  });

  it("adds a compact memory summary for older turns before recent context", async () => {
    env.OPENAI_MAX_CONTEXT_MESSAGES = originalContextMessages;
    env.OPENAI_MAX_CONTEXT_TOKENS = originalContextTokens;
    env.CONVERSATION_MEMORY_SUMMARY_MAX_TOKENS = 800;
    const store = new ConversationStore();
    const seed = Array.from({ length: 26 }, (_, index) => ({
      role: index % 2 === 0 ? "user" as const : "assistant" as const,
      content: index === 0 ? "My favorite color is purple." : `message ${index}`
    }));
    const conversation = await store.getOrCreate("memory-context-test", seed);
    const updated = await store.appendTurn(conversation, [
      { role: "user", content: "What color did I say I liked?" },
      { role: "assistant", content: "You said purple." }
    ]);

    const context = store.getPromptContext(updated);
    expect(context[0]?.role).toBe("system");
    expect(context[0]?.content).toContain("Conversation memory summary");
    expect(context[0]?.content).toContain("My favorite color is purple.");
    expect(context.at(-2)?.content).toBe("What color did I say I liked?");
  });

  it("renames a conversation for the history list", async () => {
    const store = new ConversationStore();
    await store.getOrCreate("rename-test", [], {
      titleSeed: "Original title",
      personaId: "larae"
    });

    const renamed = await store.rename("rename-test", "  Better chat title  ");
    expect(renamed?.title).toBe("Better chat title");

    const listed = await store.list();
    expect(listed.find((conversation) => conversation.id === "rename-test")?.title).toBe("Better chat title");
  });

  it("pins conversations to the top without changing their title", async () => {
    const store = new ConversationStore();
    const first = await store.getOrCreate("pin-first", [], { titleSeed: "First chat" });
    const second = await store.getOrCreate("pin-second", [], { titleSeed: "Second chat" });
    await store.appendTurn(first, [
      { role: "user", content: "first" },
      { role: "assistant", content: "first answer" }
    ]);
    await store.appendTurn(second, [
      { role: "user", content: "second" },
      { role: "assistant", content: "second answer" }
    ]);

    const pinned = await store.setPinned("pin-first", true);
    expect(pinned?.pinned).toBe(true);
    expect(pinned?.title).toBe("First chat");

    const listed = await store.list();
    expect(listed[0]?.id).toBe("pin-first");
  });

  it("deletes a conversation from the history list", async () => {
    const store = new ConversationStore();
    await store.getOrCreate("delete-test", [], { titleSeed: "Delete me" });

    expect(await store.delete("delete-test")).toBe(true);
    expect(await store.get("delete-test")).toBeUndefined();
    expect((await store.list()).some((conversation) => conversation.id === "delete-test")).toBe(false);
  });

  it("restores rich rendered turns from message metadata", async () => {
    const store = new ConversationStore();
    const conversation = await store.getOrCreate("turns-test");
    const updated = await store.appendTurn(conversation, [
      {
        role: "user",
        content: "Make an image.",
        metadata: {
          userAssets: [{
            id: "asset_1",
            kind: "image",
            fileName: "reference.png",
            mimeType: "image/png",
            url: "/api/uploads/asset_1"
          }]
        }
      },
      {
        role: "assistant",
        content: "Done.",
        metadata: {
          outputs: [{
            type: "image",
            url: "/api/generated/image.png",
            mimeType: "image/png",
            alt: "Generated image"
          }],
          usage: {
            inputTokens: 10,
            outputTokens: 5,
            totalTokens: 15
          },
          provider: "openai_persona",
          providerModel: "gpt-test",
          responseId: "resp_123",
          styleTransferProvider: "stub_style_transfer"
        }
      }
    ]);

    expect(updated.turns).toHaveLength(1);
    expect(updated.turns?.[0]?.userAssets?.[0]?.fileName).toBe("reference.png");
    expect(updated.turns?.[0]?.outputs[0]?.type).toBe("image");

    const restored = await store.get("turns-test");
    expect(restored?.turns[0]?.outputs[0]?.type).toBe("image");
    expect(restored?.turns[0]?.usage?.totalTokens).toBe(15);
    expect(restored?.turns[0]?.provider).toBe("openai_persona");
    expect(restored?.turns[0]?.providerModel).toBe("gpt-test");
    expect(restored?.turns[0]?.responseId).toBe("resp_123");
    expect(restored?.turns[0]?.styleTransferProvider).toBe("stub_style_transfer");
  });

  it("falls back to plain text when saved render metadata is malformed", async () => {
    const store = new ConversationStore();
    const conversation = await store.getOrCreate("malformed-metadata-test");
    const updated = await store.appendTurn(conversation, [
      {
        role: "user",
        content: "Use this broken asset.",
        metadata: {
          userAssets: "not an asset list"
        } as never
      },
      {
        role: "assistant",
        content: "Still readable.",
        metadata: {
          outputs: [{ type: "image", url: "/missing-required-alt.png" }],
          usage: { inputTokens: -1, outputTokens: 2 }
        } as never
      }
    ]);

    expect(updated.turns).toHaveLength(1);
    expect(updated.turns?.[0]?.userAssets).toEqual([]);
    expect(updated.turns?.[0]?.outputs).toEqual([{ type: "text", text: "Still readable." }]);
    expect(updated.turns?.[0]?.usage).toBeUndefined();
  });
});
