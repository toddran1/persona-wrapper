import { describe, expect, it } from "vitest";
import { ConversationStore } from "../services/conversationStore.js";

describe("ConversationStore prompt context", () => {
  it("keeps complete recent turns and never starts context with an assistant reply", () => {
    const store = new ConversationStore();
    const conversation = store.getOrCreate("context-test", [
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
});
