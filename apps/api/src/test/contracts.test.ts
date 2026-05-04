import { describe, expect, it } from "vitest";
import { chatRequestSchema, chatResponseSchema } from "@persona/shared";

describe("shared schemas", () => {
  it("applies chat request defaults", () => {
    const parsed = chatRequestSchema.parse({
      personaId: "larae",
      message: "Hello"
    });

    expect(parsed.provider).toBe("openai");
    expect(parsed.audio).toBe(false);
    expect(parsed.history).toEqual([]);
  });

  it("accepts structured chat responses with history", () => {
    const parsed = chatResponseSchema.parse({
      persona: {
        id: "larae",
        name: "LaRae the Baddest",
        tagline: "Tagline",
        description: "Description",
        avatarColor: "#ff5f6d",
        theme: {
          mode: "dark",
          themeName: "Test",
          background: "#000",
          backgroundAccent: "#111",
          backgroundAccentSecondary: "#222",
          surface: "#333",
          surfaceStrong: "#444",
          border: "#555",
          accent: "#666",
          accent2: "#777",
          text: "#fff",
          muted: "#999"
        },
        supportedProviders: ["openai"]
      },
      provider: "openai",
      conversationId: "conv_test",
      history: [
        { role: "user", content: "Hi" },
        { role: "assistant", content: "Hello there" }
      ],
      outputs: [{ type: "text", text: "Hello there" }],
      generatedAt: new Date().toISOString(),
      diagnostics: {
        requestedAudio: false,
        toolsAvailable: ["web_search"],
        messageCount: 2
      }
    });

    expect(parsed.history).toHaveLength(2);
  });
});
