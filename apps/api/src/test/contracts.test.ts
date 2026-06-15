import { describe, expect, it } from "vitest";
import { chatRequestSchema, chatResponseSchema, llmInputSchema } from "@persona/shared";

describe("shared schemas", () => {
  it("applies chat request defaults", () => {
    const parsed = chatRequestSchema.parse({
      personaId: "larae",
      message: "Hello"
    });

    expect(parsed.provider).toBe("local");
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

  it("accepts separate full-style and base-style llm prompt tracks", () => {
    const parsed = llmInputSchema.parse({
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
        supportedProviders: ["openai"],
        biography: "Bio",
        personalityTraits: ["confident"],
        speechStyle: ["rhythmic"],
        catchphrases: ["Clock it."],
        visualStyle: ["glam"],
        safetyBoundaries: ["No unsafe content."],
        voiceProfile: {
          defaultVoiceId: "voice_test",
          speakingStyle: "animated"
        },
        defaultTools: ["web_search"]
      },
      systemPrompt: "Full persona prompt",
      baseSystemPrompt: "Persona-lite prompt",
      messages: [
        { role: "system", content: "Full persona prompt" },
        { role: "user", content: "Who was president in 2010?" }
      ],
      baseMessages: [
        { role: "system", content: "Persona-lite prompt" },
        { role: "user", content: "Who was president in 2010?" }
      ],
      userMessage: "Who was president in 2010?",
      toolDefinitions: [
        {
          name: "web_search",
          description: "Search the web",
          inputSchema: {}
        }
      ]
    });

    expect(parsed.baseSystemPrompt).toBe("Persona-lite prompt");
    expect(parsed.baseMessages).toHaveLength(2);
  });

  it("accepts OpenAI artifact blocks and per-request tool options", () => {
    const parsed = chatRequestSchema.parse({
      personaId: "larae",
      message: "Analyze this file and cite sources.",
      provider: "openai",
      attachments: [{
        id: "asset_1",
        kind: "file",
        fileName: "data.csv",
        mimeType: "text/csv",
        sizeBytes: 42,
        openaiFileId: "file_1"
      }],
      toolOptions: {
        webSearch: true,
        codeInterpreter: true
      }
    });

    expect(parsed.attachments?.[0]?.openaiFileId).toBe("file_1");
    expect(parsed.toolOptions?.webSearch).toBe(true);
    expect(parsed.toolOptions?.vectorStoreIds).toEqual([]);
  });
});
