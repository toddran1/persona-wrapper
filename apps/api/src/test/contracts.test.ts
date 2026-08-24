import { describe, expect, it } from "vitest";
import { accountDeletionResponseSchema, activeSessionsResponseSchema, chatRequestSchema, chatResponseSchema, clampFiniteNumber, clientContextSchema, contentBlockSchema, currentPoliciesResponseSchema, dataExportJobRequestSchema, dataTransferJobSchema, deleteAccountRequestSchema, finiteNonnegativeIntegerOr, finiteNumberOr, hasCompletePersonaVisualVideoSet, llmInputSchema, PASSWORD_MAX_LENGTH, personaVisualStageSchema, registerRequestSchema, requestMayNeedLocation, restoreAccountRequestSchema, statusOutputSchema, tableOutputSchema, ttsOutputSchema, unsafeOutputReportRequestSchema, updateUserProfileRequestSchema } from "@persona/shared";

describe("shared schemas", () => {
  it("rejects or normalizes non-finite numeric values at application boundaries", () => {
    expect(finiteNumberOr(Number.NaN, 7)).toBe(7);
    expect(finiteNumberOr(Number.POSITIVE_INFINITY, 7)).toBe(7);
    expect(finiteNonnegativeIntegerOr(Number.NaN, 3)).toBe(3);
    expect(finiteNonnegativeIntegerOr(-10, 3)).toBe(3);
    expect(clampFiniteNumber(Number.NaN, 0, 100, 25)).toBe(25);
    expect(clampFiniteNumber(Number.POSITIVE_INFINITY, 0, 100, 25)).toBe(25);
    expect(clampFiniteNumber(140, 0, 100)).toBe(100);

    expect(tableOutputSchema.safeParse({ type: "table", columns: ["Value"], rows: [[Number.NaN]] }).success).toBe(false);
    expect(statusOutputSchema.safeParse({ type: "status", status: "completed", message: "Done", progress: Number.POSITIVE_INFINITY }).success).toBe(false);
    expect(clientContextSchema.safeParse({ location: { latitude: Number.NaN, longitude: -96.8 } }).success).toBe(false);
    expect(clientContextSchema.safeParse({ currentDateTime: "not-a-date" }).success).toBe(false);
    expect(clientContextSchema.safeParse({ locale: "" }).success).toBe(false);
    expect(clientContextSchema.safeParse({ timeZone: "x".repeat(101) }).success).toBe(false);
  });

  it("detects location-dependent requests without matching unrelated weather words", () => {
    expect(requestMayNeedLocation("How is the weather today?")).toBe(true);
    expect(requestMayNeedLocation("Will it rain tonight?")).toBe(true);
    expect(requestMayNeedLocation("Find the closest pharmacy to me")).toBe(true);
    expect(requestMayNeedLocation("Make an image of a storm over the closest planet to Earth")).toBe(false);
    expect(requestMayNeedLocation("Write a song about rain")).toBe(false);
  });

  it("defaults omitted persona videos to image-only stages", () => {
    const stage = personaVisualStageSchema.parse({
      fallbackImages: {
        idle: "/personas/new/idle.png",
        thinking: "/personas/new/thinking.png",
        speaking: "/personas/new/speaking.png"
      }
    });

    expect(stage.loops).toEqual({ idle: [], thinking: [], speaking: [] });
    expect(hasCompletePersonaVisualVideoSet(stage)).toBe(false);
  });

  it("validates profile updates and real month/day combinations", () => {
    expect(updateUserProfileRequestSchema.parse({
      username: "Baddie.Test",
      birthday: { month: 2, day: 29 },
      conciseAudioResponses: false
    })).toEqual({
      username: "Baddie.Test",
      birthday: { month: 2, day: 29 },
      conciseAudioResponses: false
    });
    expect(() => updateUserProfileRequestSchema.parse({ birthday: { month: 2, day: 30 } })).toThrow();
    expect(() => updateUserProfileRequestSchema.parse({ username: "not allowed" })).toThrow();
    expect(() => updateUserProfileRequestSchema.parse({})).toThrow();
    expect(updateUserProfileRequestSchema.parse({ personaInfluenceLevel: "professional" }))
      .toEqual({ personaInfluenceLevel: "professional" });
    expect(() => updateUserProfileRequestSchema.parse({ personaInfluenceLevel: "anything" })).toThrow();
  });

  it("defaults chat requests to the existing uncensored persona experience", () => {
    const request = chatRequestSchema.parse({
      personaId: "larae",
      message: "Hello",
      provider: "openai",
      audio: false
    });
    expect(request.personaInfluenceLevel).toBe("uncensored");
    expect(() => chatRequestSchema.parse({
      personaId: "larae",
      personaInfluenceLevel: "invalid",
      message: "Hello"
    })).toThrow();
  });

  it("validates bounded unsafe-output reports", () => {
    expect(unsafeOutputReportRequestSchema.parse({
      conversationId: "conv_1",
      category: "child_safety",
      outputExcerpt: "Reported response",
      details: "The response was inappropriate."
    }).category).toBe("child_safety");
    expect(() => unsafeOutputReportRequestSchema.parse({
      conversationId: "conv_1",
      category: "unsupported",
      outputExcerpt: "Reported response"
    })).toThrow();
    expect(() => unsafeOutputReportRequestSchema.parse({
      conversationId: "conv_1",
      category: "other",
      outputExcerpt: "x".repeat(4001)
    })).toThrow();
  });
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

  it("requires versioned Terms and Privacy consent at registration", () => {
    const policies = currentPoliciesResponseSchema.parse({
      termsVersion: "2026-07-29",
      privacyVersion: "2026-07-29",
      termsPath: "/terms",
      privacyPath: "/privacy"
    });
    expect(registerRequestSchema.parse({
      email: "new@example.com",
      password: "password123",
      policyConsent: {
        termsVersion: policies.termsVersion,
        privacyVersion: policies.privacyVersion
      },
      clientType: "web"
    }).policyConsent).toEqual({
      termsVersion: "2026-07-29",
      privacyVersion: "2026-07-29"
    });
    expect(() => registerRequestSchema.parse({
      email: "new@example.com",
      password: "password123",
      clientType: "web"
    })).toThrow();
  });

  it("aligns the registration password rule with the server-side limits", () => {
    const consent = { termsVersion: "2026-07-29", privacyVersion: "2026-07-29" };

    expect(() => registerRequestSchema.parse({
      email: "new@example.com",
      password: "short1234",
      policyConsent: consent
    })).toThrow();
    expect(registerRequestSchema.parse({
      email: "new@example.com",
      password: "longenough1",
      policyConsent: consent
    }).password).toBe("longenough1");
    expect(() => registerRequestSchema.parse({
      email: "new@example.com",
      password: "x".repeat(PASSWORD_MAX_LENGTH + 1),
      policyConsent: consent
    })).toThrow();
  });

  it("requires a real email at registration while username stays optional", () => {
    const consent = { termsVersion: "2026-07-29", privacyVersion: "2026-07-29" };

    expect(() => registerRequestSchema.parse({
      username: "baddie42",
      password: "longenough1",
      policyConsent: consent
    })).toThrow();
    expect(registerRequestSchema.parse({
      email: "new@example.com",
      password: "longenough1",
      policyConsent: consent
    }).username).toBeUndefined();
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

  it("accepts a saved assistant message id for response regeneration", () => {
    const parsed = chatRequestSchema.parse({
      personaId: "bambam",
      message: "Bam Bam, introduce yourself.",
      retryAssistantMessageId: "msg_assistant_1"
    });

    expect(parsed.retryAssistantMessageId).toBe("msg_assistant_1");
  });

  it("normalizes the retired OpenAI direct provider id for older clients", () => {
    const parsed = chatRequestSchema.parse({
      personaId: "larae",
      provider: "openai_persona",
      message: "Hello"
    });

    expect(parsed.provider).toBe("openai");
  });

  it("keeps current and legacy TTS provider records compatible with provider-neutral audio blocks", () => {
    expect(ttsOutputSchema.parse({
      provider: "fish_audio_tts",
      url: "/api/generated-audio/fish-token",
      mimeType: "audio/opus"
    }).provider).toBe("fish_audio_tts");
    expect(ttsOutputSchema.parse({
      provider: "elevenlabs_tts",
      url: "/api/generated-audio/legacy-token",
      mimeType: "audio/mpeg"
    }).provider).toBe("elevenlabs_tts");
    expect(contentBlockSchema.parse({
      type: "audio",
      url: "/api/generated-audio/legacy-token",
      mimeType: "audio/mpeg",
      transcript: "Legacy saved response."
    })).toMatchObject({ type: "audio", mimeType: "audio/mpeg" });
  });

  it("accepts an attachment-only chat turn without inventing message text", () => {
    const parsed = chatRequestSchema.parse({
      personaId: "larae",
      message: "",
      attachments: [{
        id: "asset_attachment_only",
        kind: "image",
        fileName: "follow-up.jpg",
        mimeType: "image/jpeg",
        sizeBytes: 42,
        openaiFileId: "file_attachment_only"
      }]
    });

    expect(parsed.message).toBe("");
    expect(parsed.attachments).toHaveLength(1);
  });

  it("rejects a chat turn with neither message text nor attachments", () => {
    const parsed = chatRequestSchema.safeParse({
      personaId: "larae",
      message: "   "
    });

    expect(parsed.success).toBe(false);
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
    expect(parsed.persona.theme.backgroundAlt).toBe("#170f21");
    expect(parsed.persona.theme.rail).toBe("#d6b55e");
    expect(parsed.persona.theme.danger).toBe("#ff6b7a");
    expect(parsed.persona.theme.chartColors).toHaveLength(6);
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
    expect(parsed.persona.directResponseInstructions).toEqual([]);
    expect(parsed.persona.voiceProfile.performancePreset).toBe("neutral");
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
