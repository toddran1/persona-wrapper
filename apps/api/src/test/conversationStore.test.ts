import { describe, expect, it } from "vitest";
import { ConversationStore } from "../services/conversationStore.js";

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

  it("adds a compact memory summary for older turns before recent context", async () => {
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
