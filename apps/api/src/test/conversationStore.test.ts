import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { env } from "../config/env.js";
import { ConversationStore } from "../services/conversationStore.js";
import { estimateChatMessagesTokens } from "../utils/tokenBudget.js";

const originalContextMessages = env.OPENAI_MAX_CONTEXT_MESSAGES;
const originalContextCharacters = env.OPENAI_MAX_CONTEXT_CHARACTERS;
const originalContextTokens = env.OPENAI_MAX_CONTEXT_TOKENS;
const originalMemorySummaryMaxCharacters = env.CONVERSATION_MEMORY_SUMMARY_MAX_CHARACTERS;
const originalMemorySummaryMaxTokens = env.CONVERSATION_MEMORY_SUMMARY_MAX_TOKENS;
const originalMemorySummaryAfterMessages = env.CONVERSATION_MEMORY_SUMMARY_AFTER_MESSAGES;

afterEach(() => {
  env.OPENAI_MAX_CONTEXT_MESSAGES = originalContextMessages;
  env.OPENAI_MAX_CONTEXT_CHARACTERS = originalContextCharacters;
  env.OPENAI_MAX_CONTEXT_TOKENS = originalContextTokens;
  env.CONVERSATION_MEMORY_SUMMARY_MAX_CHARACTERS = originalMemorySummaryMaxCharacters;
  env.CONVERSATION_MEMORY_SUMMARY_MAX_TOKENS = originalMemorySummaryMaxTokens;
  env.CONVERSATION_MEMORY_SUMMARY_AFTER_MESSAGES = originalMemorySummaryAfterMessages;
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

  it("hides leaked persona attribution metadata from restored conversations", async () => {
    const store = new ConversationStore();
    const conversation = await store.getOrCreate("attribution-leak-test", [
      { role: "user", content: "Who is your best friend?" },
      {
        role: "assistant",
        content: "[Assistant persona: LaRae the Baddest | id=larae]\nThe visible answer.",
        personaId: "larae"
      }
    ]);

    const restored = await store.get(conversation.id);
    expect(restored?.history.at(-1)?.content).toBe("The visible answer.");
    expect(restored?.turns.at(-1)?.assistantText).toBe("The visible answer.");
    expect(restored?.turns.at(-1)?.outputs).toContainEqual({ type: "text", text: "The visible answer." });
    expect(store.getPromptHistory(conversation).at(-1)?.content).toBe("The visible answer.");
  });

  it("does not expose or transfer a conversation between owners", async () => {
    const store = new ConversationStore();
    const conversation = await store.getOrCreate(`owner-isolation-${randomUUID()}`, [], {
      userId: "owner-a"
    });
    const updated = await store.appendTurn(conversation, [
      { role: "user", content: "owner A's private question" },
      { role: "assistant", content: "owner A's private answer" }
    ]);

    await expect(store.getOrCreate(updated.id, [], { userId: "owner-b" }))
      .rejects.toMatchObject({ statusCode: 404 });
    await expect(store.getOrCreate(updated.id))
      .rejects.toMatchObject({ statusCode: 404 });
    expect(await store.get(updated.id, "owner-b")).toBeUndefined();
    expect(await store.get(updated.id)).toBeUndefined();
    expect((await store.get(updated.id, "owner-a"))?.history[0]?.content)
      .toBe("owner A's private question");
  });

  it("does not expose ownerless conversations through owner-scoped memory operations", async () => {
    const store = new ConversationStore();
    const conversation = await store.getOrCreate(`anonymous-isolation-${randomUUID()}`);

    await expect(store.getOrCreate(conversation.id, [], { userId: "owner-a" }))
      .rejects.toMatchObject({ statusCode: 404 });
    expect(await store.get(conversation.id, "owner-a")).toBeUndefined();
    expect(await store.getTurnsPage(conversation.id, "owner-a")).toBeUndefined();
    expect(await store.rename(conversation.id, "Claimed", "owner-a")).toBeUndefined();
    expect(await store.setPinned(conversation.id, true, "owner-a")).toBeUndefined();
    expect(await store.delete(conversation.id, "owner-a")).toBe(false);
    expect(await store.get(conversation.id)).toBeDefined();
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

  it("does not generate or inject memory while memory is disabled", async () => {
    env.OPENAI_MAX_CONTEXT_MESSAGES = 4;
    env.OPENAI_MAX_CONTEXT_CHARACTERS = 10000;
    env.OPENAI_MAX_CONTEXT_TOKENS = 10000;
    env.CONVERSATION_MEMORY_SUMMARY_AFTER_MESSAGES = 2;
    const store = new ConversationStore();
    let conversation = await store.getOrCreate(`disabled-memory-${randomUUID()}`, [], {
      userId: "memory-owner",
      memoryEnabled: false
    });
    for (let index = 0; index < 5; index += 1) {
      conversation = await store.appendTurn(conversation, [
        { role: "user", content: `Private preference ${index}` },
        { role: "assistant", content: `Acknowledged ${index}` }
      ]);
    }

    const context = store.getPromptContext(conversation);
    expect(context.some((message) => message.role === "system" && message.content.includes("memory"))).toBe(false);
    expect(conversation.metadata).not.toHaveProperty("memorySummary");
    expect(conversation.metadata).not.toHaveProperty("structuredMemory");
  });

  it("clears memory for one chat or every chat without crossing owner boundaries", async () => {
    env.OPENAI_MAX_CONTEXT_MESSAGES = 4;
    env.OPENAI_MAX_CONTEXT_CHARACTERS = 10000;
    env.OPENAI_MAX_CONTEXT_TOKENS = 10000;
    env.CONVERSATION_MEMORY_SUMMARY_AFTER_MESSAGES = 2;
    const store = new ConversationStore();
    const createRememberingConversation = async (id: string, userId: string) => {
      let conversation = await store.getOrCreate(id, [], { userId });
      for (let index = 0; index < 5; index += 1) {
        conversation = await store.appendTurn(conversation, [
          { role: "user", content: `Remember ${id} ${index}` },
          { role: "assistant", content: `Saved ${index}` }
        ]);
      }
      return conversation;
    };
    const first = await createRememberingConversation(`memory-a-${randomUUID()}`, "owner-a");
    const second = await createRememberingConversation(`memory-b-${randomUUID()}`, "owner-a");
    const otherOwner = await createRememberingConversation(`memory-c-${randomUUID()}`, "owner-b");

    expect(store.getPromptContext(first)[0]?.role).toBe("system");
    expect(await store.clearMemory(first.id, "owner-b")).toBe(false);
    expect(await store.clearMemory(first.id, "owner-a")).toBe(true);
    expect(store.getPromptContext(first)[0]?.role).not.toBe("system");
    expect(store.getPromptContext(second)[0]?.role).toBe("system");

    expect(await store.clearAllMemory("owner-a")).toBe(2);
    expect(store.getPromptContext(second)[0]?.role).not.toBe("system");
    expect(store.getPromptContext(otherOwner)[0]?.role).toBe("system");
  });

  it("adds structured goals, decisions, and referenced assets for older turns", async () => {
    env.OPENAI_MAX_CONTEXT_MESSAGES = 2;
    env.OPENAI_MAX_CONTEXT_CHARACTERS = 10000;
    env.OPENAI_MAX_CONTEXT_TOKENS = 10000;
    env.CONVERSATION_MEMORY_SUMMARY_AFTER_MESSAGES = 4;
    const store = new ConversationStore();
    const conversation = await store.getOrCreate(`structured-memory-${randomUUID()}`);
    const withOlderTurn = await store.appendTurn(conversation, [
      {
        role: "user",
        content: "I prefer compact layouts. I want to build a launch page. Let's use the uploaded purple logo.",
        metadata: {
          userAssets: [{
            id: "asset-purple-logo",
            kind: "image",
            fileName: "purple-logo.png",
            mimeType: "image/png"
          }]
        }
      },
      { role: "assistant", content: "I can help with that launch page." }
    ]);
    const updated = await store.appendTurn(withOlderTurn, [
      { role: "user", content: "What should we do next?" },
      { role: "assistant", content: "Next, we should define the page sections." }
    ]);

    const context = store.getPromptContext(updated);
    expect(context[0]?.role).toBe("system");
    expect(context[0]?.content).toContain("Structured conversation memory");
    expect(context[0]?.content).toContain("Explicit conversation preferences:");
    expect(context[0]?.content).toContain("Active goals:");
    expect(context[0]?.content).toContain("Decisions and constraints:");
    expect(context[0]?.content).toContain("asset-purple-logo");
    expect(context[0]?.content).toContain("purple-logo.png");
    expect(context.slice(1).map((message) => message.content)).toEqual([
      "What should we do next?",
      "Next, we should define the page sections."
    ]);
  });

  it("compacts messages omitted by token limits even before the message threshold", async () => {
    env.OPENAI_MAX_CONTEXT_MESSAGES = 24;
    env.OPENAI_MAX_CONTEXT_CHARACTERS = 10000;
    env.OPENAI_MAX_CONTEXT_TOKENS = 40;
    env.CONVERSATION_MEMORY_SUMMARY_AFTER_MESSAGES = 24;
    const store = new ConversationStore();
    const conversation = await store.getOrCreate(`token-memory-${randomUUID()}`, [
      { role: "user", content: "Remember that the launch codename is Purple Comet." },
      { role: "assistant", content: "I will remember the launch codename." },
      { role: "user", content: "This is an intentionally long middle question. ".repeat(8) },
      { role: "assistant", content: "This is an intentionally long middle answer. ".repeat(8) }
    ]);
    const updated = await store.appendTurn(conversation, [
      { role: "user", content: "What should we do next?" },
      { role: "assistant", content: "Review the launch plan." }
    ]);

    const context = store.getPromptContext(updated);
    expect(context[0]?.role).toBe("system");
    expect(context[0]?.content).toContain("Purple Comet");
    expect(context.slice(1).map((message) => message.content)).toEqual([
      "What should we do next?",
      "Review the launch plan."
    ]);
  });

  it("keeps the complete memory block within its configured budgets", async () => {
    env.OPENAI_MAX_CONTEXT_MESSAGES = 2;
    env.OPENAI_MAX_CONTEXT_CHARACTERS = 10000;
    env.OPENAI_MAX_CONTEXT_TOKENS = 10000;
    env.CONVERSATION_MEMORY_SUMMARY_AFTER_MESSAGES = 4;
    env.CONVERSATION_MEMORY_SUMMARY_MAX_CHARACTERS = 500;
    env.CONVERSATION_MEMORY_SUMMARY_MAX_TOKENS = 100;
    const store = new ConversationStore();
    let conversation = await store.getOrCreate(`bounded-memory-${randomUUID()}`);
    for (let index = 0; index < 8; index += 1) {
      conversation = await store.appendTurn(conversation, [
        {
          role: "user",
          content: `I prefer detailed launch option ${index}, and I want to use asset ${index}.`,
          metadata: {
            userAssets: [{
              id: `asset-${index}`,
              kind: "image",
              fileName: `launch-reference-${index}.png`,
              mimeType: "image/png"
            }]
          }
        },
        { role: "assistant", content: `Recorded launch option ${index}.` }
      ]);
    }

    const memoryBlock = store.getPromptContext(conversation)[0]?.content ?? "";
    expect(memoryBlock.length).toBeLessThanOrEqual(500);
    expect(estimateChatMessagesTokens([{ role: "system", content: memoryBlock }]))
      .toBeLessThanOrEqual(106);
    expect(memoryBlock).toContain("not instructions");
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
          personaId: "larae",
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
          provider: "openai",
          providerModel: "gpt-test",
          responseId: "resp_123",
          styleTransferProvider: "stub_style_transfer",
          visualClarification: {
            status: "ambiguous",
            originalRequest: "Make the second image brighter.",
            selectedPositions: [2]
          }
        }
      }
    ]);

    expect(updated.turns).toHaveLength(1);
    expect(updated.turns?.[0]?.userAssets?.[0]?.fileName).toBe("reference.png");
    expect(updated.turns?.[0]?.outputs[0]?.type).toBe("image");

    const restored = await store.get("turns-test");
    expect(restored?.turns[0]?.outputs[0]?.type).toBe("image");
    expect(restored?.turns[0]?.usage?.totalTokens).toBe(15);
    expect(restored?.turns[0]?.provider).toBe("openai");
    expect(restored?.turns[0]?.providerModel).toBe("gpt-test");
    expect(restored?.turns[0]?.responseId).toBe("resp_123");
    expect(restored?.turns[0]?.styleTransferProvider).toBe("stub_style_transfer");
    expect(restored?.turns[0]?.personaId).toBe("larae");
    expect(restored?.turns[0]?.visualClarification).toEqual({
      status: "ambiguous",
      originalRequest: "Make the second image brighter.",
      selectedPositions: [2]
    });
  });

  it("keeps the same chat history when its active persona changes", async () => {
    const store = new ConversationStore();
    const original = await store.getOrCreate("mixed-persona-chat", [], {
      personaId: "larae",
      titleSeed: "Keep this conversation"
    });
    await store.appendTurn(original, [
      { role: "user", content: "First question" },
      { role: "assistant", content: "First answer" }
    ]);

    const switched = await store.getOrCreate("mixed-persona-chat", [], {
      personaId: "second-persona"
    });

    expect(switched.id).toBe("mixed-persona-chat");
    expect(switched.personaId).toBe("second-persona");
    expect(switched.messages.map((message) => message.content)).toEqual([
      "First question",
      "First answer"
    ]);
    expect(switched.turns?.[0]?.personaId).toBe("larae");
    expect(store.getPromptHistory(switched)[1]).toMatchObject({
      role: "assistant",
      content: "First answer",
      personaId: "larae"
    });

    const updated = await store.appendTurn(switched, [
      { role: "user", content: "Second question" },
      {
        role: "assistant",
        content: "Second answer",
        metadata: { personaId: "second-persona" }
      }
    ]);
    expect(updated.turns?.map((turn) => turn.personaId)).toEqual(["larae", "second-persona"]);
    expect(store.getPromptHistory(updated)
      .filter((message) => message.role === "assistant")
      .map((message) => message.personaId))
      .toEqual(["larae", "second-persona"]);
  });

  it("restores per-turn personas from a portable mixed-persona conversation", async () => {
    const store = new ConversationStore();
    const imported = await store.importPortable({
      title: "Imported mixed chat",
      pinned: false,
      messages: [
        { role: "user", content: "First" },
        { role: "assistant", content: "LaRae answer", personaId: "larae" },
        { role: "user", content: "Second" },
        { role: "assistant", content: "Other answer", personaId: "future-persona" }
      ]
    }, "user_test");

    const restored = await store.get(imported.id, "user_test");
    expect(restored?.turns.map((turn) => turn.personaId)).toEqual(["larae", "future-persona"]);
    expect(restored?.history
      .filter((message) => message.role === "assistant")
      .map((message) => message.personaId))
      .toEqual(["larae", "future-persona"]);
  });

  it("keeps persona attribution in compacted memory for mixed-persona chats", async () => {
    env.OPENAI_MAX_CONTEXT_MESSAGES = 2;
    env.OPENAI_MAX_CONTEXT_CHARACTERS = 10000;
    env.OPENAI_MAX_CONTEXT_TOKENS = 10000;
    env.CONVERSATION_MEMORY_SUMMARY_AFTER_MESSAGES = 2;
    const store = new ConversationStore();
    const conversation = await store.getOrCreate(`mixed-persona-memory-${randomUUID()}`, [], {
      personaId: "larae"
    });
    const first = await store.appendTurn(conversation, [
      { role: "user", content: "What is your favorite city?" },
      {
        role: "assistant",
        content: "Miami is my answer.",
        metadata: { personaId: "larae" }
      }
    ]);
    const switched = await store.getOrCreate(first.id, [], { personaId: "bambam" });
    const updated = await store.appendTurn(switched, [
      { role: "user", content: "And what is your answer?" },
      {
        role: "assistant",
        content: "Atlanta is my answer.",
        metadata: { personaId: "bambam" }
      }
    ]);

    const context = store.getPromptContext(updated);
    expect(context[0]?.content).toContain("Assistant (LaRae the Baddest): Miami is my answer.");
    expect(context[0]?.content).toContain("never attribute one persona's statements to another");
    expect(context.at(-1)).toMatchObject({
      role: "assistant",
      content: "Atlanta is my answer.",
      personaId: "bambam"
    });
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

  it("paginates conversation summaries without returning duplicates", async () => {
    const store = new ConversationStore();
    for (let index = 0; index < 5; index += 1) {
      await store.getOrCreate(`page-conversation-${index}`, [], { titleSeed: `Chat ${index}` });
    }

    const first = await store.listPage(undefined, 2);
    const second = await store.listPage(undefined, 2, first.nextCursor ?? undefined);

    expect(first.conversations).toHaveLength(2);
    expect(second.conversations).toHaveLength(2);
    expect(first.nextCursor).toEqual(expect.any(String));
    expect(first.nextCursor).not.toBe("2");
    expect(new Set([...first.conversations, ...second.conversations].map((item) => item.id)).size).toBe(4);
  });

  it("keeps pinned ordering correct across keyset pages", async () => {
    const store = new ConversationStore();
    for (let index = 0; index < 5; index += 1) {
      await store.getOrCreate(`pinned-page-${index}`, [], { titleSeed: `Chat ${index}` });
    }
    await store.setPinned("pinned-page-0", true);
    await store.setPinned("pinned-page-2", true);

    const first = await store.listPage(undefined, 1);
    const second = await store.listPage(undefined, 1, first.nextCursor ?? undefined);
    const third = await store.listPage(undefined, 1, second.nextCursor ?? undefined);

    expect(first.conversations[0]?.pinned).toBe(true);
    expect(second.conversations[0]?.pinned).toBe(true);
    expect(third.conversations[0]?.pinned).toBe(false);
    expect(new Set([
      ...first.conversations,
      ...second.conversations,
      ...third.conversations
    ].map((conversation) => conversation.id)).size).toBe(3);
  });

  it("searches conversation titles with filtered pagination", async () => {
    const store = new ConversationStore();
    await store.getOrCreate("search-1", [], { titleSeed: "Dallas summer league recap" });
    await store.getOrCreate("search-2", [], { titleSeed: "Recipe ideas" });
    await store.getOrCreate("search-3", [], { titleSeed: "Dallas restaurants" });

    const first = await store.listPage(undefined, 1, undefined, "DALLAS");
    const second = await store.listPage(undefined, 1, first.nextCursor ?? undefined, "dallas");

    expect(first.conversations).toHaveLength(1);
    expect(second.conversations).toHaveLength(1);
    expect([...first.conversations, ...second.conversations].every((conversation) => conversation.title.toLowerCase().includes("dallas"))).toBe(true);
    expect(new Set([...first.conversations, ...second.conversations].map((conversation) => conversation.id)).size).toBe(2);
  });

  it("rejects malformed and query-mismatched conversation cursors", async () => {
    const store = new ConversationStore();
    await store.getOrCreate("cursor-search-1", [], { titleSeed: "Dallas one" });
    await store.getOrCreate("cursor-search-2", [], { titleSeed: "Dallas two" });

    await expect(store.listPage(undefined, 1, "not-a-cursor")).rejects.toMatchObject({
      statusCode: 400
    });

    const first = await store.listPage(undefined, 1, undefined, "dallas");
    await expect(store.listPage(undefined, 1, first.nextCursor ?? undefined, "austin")).rejects.toMatchObject({
      statusCode: 400
    });
  });

  it("loads newest turns first and pages backward through long histories", async () => {
    const store = new ConversationStore();
    let conversation = await store.getOrCreate("turn-page-test");
    for (let index = 0; index < 5; index += 1) {
      conversation = await store.appendTurn(conversation, [
        { role: "user", content: `Question ${index}` },
        { role: "assistant", content: `Answer ${index}` }
      ]);
    }

    const newest = await store.getTurnsPage("turn-page-test", undefined, 2);
    const older = await store.getTurnsPage("turn-page-test", undefined, 2, newest?.nextCursor ?? undefined);

    expect(newest?.turns.map((turn) => turn.userMessage)).toEqual(["Question 3", "Question 4"]);
    expect(older?.turns.map((turn) => turn.userMessage)).toEqual(["Question 1", "Question 2"]);
    expect(older?.nextCursor).toBe("1");
  });

  it("rejects malformed turn cursors as client errors", async () => {
    const store = new ConversationStore();
    await store.getOrCreate("invalid-turn-cursor-test");

    await expect(
      store.getTurnsPage("invalid-turn-cursor-test", undefined, 20, "not-a-sequence")
    ).rejects.toMatchObject({
      statusCode: 400
    });
  });
});
