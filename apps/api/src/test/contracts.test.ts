import { describe, expect, it } from "vitest";
import { accountDeletionResponseSchema, activeSessionsResponseSchema, chatRequestSchema, chatResponseSchema, dataExportJobRequestSchema, dataTransferJobSchema, deleteAccountRequestSchema, llmInputSchema, restoreAccountRequestSchema } from "@persona/shared";

describe("shared schemas", () => {
  it("validates cancellable data-transfer jobs and selected exports", () => {
    const job = dataTransferJobSchema.parse({
      id: "data_job_test",
      kind: "export",
      status: "running",
      phase: "Adding media",
      progress: 64,
      processedItems: 32,
      totalItems: 50,
      createdAt: "2026-07-18T12:00:00.000Z",
      updatedAt: "2026-07-18T12:01:00.000Z"
    });
    expect(job.progress).toBe(64);
    expect(dataExportJobRequestSchema.parse({ scope: "conversations", conversationIds: ["conv_1"] }).conversationIds).toEqual(["conv_1"]);
    expect(() => dataExportJobRequestSchema.parse({ scope: "conversations" })).toThrow();
  });

  it("validates active device session responses", () => {
    const parsed = activeSessionsResponseSchema.parse({
      sessions: [{
        id: "session_current",
        clientType: "android",
        deviceId: "mobile-device",
        userAgent: "For the Baddiez Android",
        createdAt: "2026-07-14T12:00:00.000Z",
        lastActiveAt: "2026-07-14T13:00:00.000Z",
        refreshExpiresAt: "2026-08-13T12:00:00.000Z",
        current: true
      }]
    });

    expect(parsed.sessions[0]?.clientType).toBe("android");
    expect(parsed.sessions[0]?.current).toBe(true);
  });

  it("validates account deletion and restoration contracts", () => {
    expect(deleteAccountRequestSchema.parse({ confirmation: "DELETE", password: "password123" })).toEqual({
      confirmation: "DELETE",
      password: "password123"
    });
    expect(() => deleteAccountRequestSchema.parse({ confirmation: "delete" })).toThrow();
    expect(restoreAccountRequestSchema.parse({
      identifier: "user@example.com",
      password: "password123",
      clientType: "web"
    }).clientType).toBe("web");
    expect(accountDeletionResponseSchema.parse({
      status: "pending_deletion",
      deletionRequestedAt: "2026-07-11T12:00:00.000Z",
      deletionScheduledFor: "2026-08-10T12:00:00.000Z"
    }).status).toBe("pending_deletion");
  });
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
        legalName: "LaRae Candace Bronson",
        age: "25",
        height: "5 ft 3 in",
        weight: "129 lbs",
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
        legalName: "LaRae Candace Bronson",
        age: "25",
        height: "5 ft 3 in",
        weight: "129 lbs",
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
