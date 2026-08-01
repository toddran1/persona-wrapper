import { afterEach, describe, expect, it, vi } from "vitest";
import { env } from "../config/env.js";
import { ChatService } from "../services/chatService.js";
import { ConversationStore } from "../services/conversationStore.js";
import { generatedAudioService } from "../services/generatedAudioService.js";

const originalAppTestMode = env.APP_TEST_MODE;
const originalTtsProvider = env.TTS_PROVIDER;
const originalFishAudioApiKey = env.FISH_AUDIO_API_KEY;

afterEach(() => {
  env.APP_TEST_MODE = originalAppTestMode;
  env.TTS_PROVIDER = originalTtsProvider;
  env.FISH_AUDIO_API_KEY = originalFishAudioApiKey;
  vi.restoreAllMocks();
});

describe("ChatService", () => {
  it("does not echo the raw user prompt as the assistant reply", async () => {
    const service = new ChatService();

    const response = await service.handleChat({
      personaId: "larae",
      provider: "openai",
      message: "Hi LaRae, please introduce yourself.",
      audio: false,
      testMode: false,
      history: []
    });

    const assistantReply = response.outputs.find((output) => output.type === "text");

    expect(assistantReply?.type).toBe("text");
    expect(assistantReply?.type === "text" ? assistantReply.text : "").not.toContain(
      "Hi LaRae, please introduce yourself."
    );
    expect(assistantReply?.type === "text" ? assistantReply.text : "").toContain("I’m LaRae the Baddest");
    expect(assistantReply?.type === "text" ? assistantReply.text : "").toContain("Ok bitch!");
  });

  it("persists conversation history across turns", async () => {
    const service = new ChatService();

    const first = await service.handleChat({
      personaId: "larae",
      provider: "openai",
      message: "Give me a dramatic intro.",
      audio: false,
      testMode: false,
      history: []
    });

    const second = await service.handleChat({
      personaId: "larae",
      provider: "openai",
      message: "Now turn that into a chart and a csv file.",
      audio: false,
      testMode: false,
      conversationId: first.conversationId,
      history: []
    });

    expect(second.conversationId).toBe(first.conversationId);
    expect(second.history).toHaveLength(4);
    expect(second.outputs.some((output) => output.type === "chart")).toBe(true);
    expect(second.outputs.some((output) => output.type === "file")).toBe(true);
  });

  it("streams neutral text and returns the final styled response", async () => {
    const service = new ChatService();
    const deltas: string[] = [];

    const response = await service.handleChat({
      personaId: "larae",
      provider: "openai",
      message: "Give me a short introduction.",
      audio: false,
      testMode: false,
      history: []
    }, {
      onTextDelta: (delta) => deltas.push(delta)
    });

    expect(deltas.join("")).toContain("LaRae the Baddest");
    const finalText = response.outputs.find((output) => output.type === "text");
    expect(finalText?.type === "text" ? finalText.text : "").toContain("Ok bitch!");
  });

  it("uses OpenAI direct persona without the separate style transfer pass", async () => {
    const service = new ChatService();

    const response = await service.handleChat({
      personaId: "larae",
      provider: "openai_persona",
      message: "Hi LaRae, please introduce yourself.",
      audio: false,
      testMode: true,
      history: []
    });

    const assistantReply = response.outputs.find((output) => output.type === "text");
    const assistantText = assistantReply?.type === "text" ? assistantReply.text : "";

    expect(response.provider).toBe("openai_persona");
    expect(response.diagnostics.neutralResponse).toBe(assistantText);
    expect(assistantText).toContain("I’m LaRae the Baddest");
    expect(assistantText).not.toContain("Bitch, be serious.");
  });

  it("returns and persists a public-safe status when requested audio generation fails", async () => {
    env.APP_TEST_MODE = false;
    env.TTS_PROVIDER = "fish_audio";
    env.FISH_AUDIO_API_KEY = undefined;

    const conversationStore = new ConversationStore();
    const response = await new ChatService(conversationStore).handleChat({
      personaId: "larae",
      provider: "openai_persona",
      message: "Give me a short spoken greeting.",
      audio: true,
      testMode: true,
      history: []
    });

    const publicMessage = "Audio could not be generated. You can retry this response or continue with the text reply.";
    expect(response.outputs).toContainEqual({ type: "status", status: "failed", message: publicMessage });
    expect(response.outputs.some((output) => output.type === "audio")).toBe(false);
    expect(response.diagnostics.tts).toMatchObject({ status: "failed", error: publicMessage });
    expect(response.diagnostics.tts?.error).not.toContain("API key");
    const persistedConversation = await conversationStore.get(response.conversationId);
    expect(persistedConversation?.turns.at(-1)?.outputs).toContainEqual({
      type: "status",
      status: "failed",
      message: publicMessage
    });
  });

  it("associates generated audio only after the assistant message is persisted", async () => {
    env.APP_TEST_MODE = true;
    const conversationStore = new ConversationStore();
    const appendTurn = conversationStore.appendTurn.bind(conversationStore);
    let appendCompleted = false;
    vi.spyOn(conversationStore, "appendTurn").mockImplementation(async (...args) => {
      const conversation = await appendTurn(...args);
      appendCompleted = true;
      return conversation;
    });
    const associateSpy = vi.spyOn(generatedAudioService, "associateWithMessage").mockImplementation(
      async () => {
        expect(appendCompleted).toBe(true);
        return true;
      }
    );

    const response = await new ChatService(conversationStore).handleChat({
      personaId: "larae",
      provider: "openai_persona",
      message: "Give me a short spoken greeting.",
      audio: true,
      testMode: true,
      history: []
    });

    expect(associateSpy).toHaveBeenCalledWith(
      "https://example.com/local-audio/larae.wav",
      expect.stringMatching(/^msg_/)
    );
    expect(response.outputs.some((output) => output.type === "audio")).toBe(true);
  });

  it("stops before generation when the request is cancelled", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(new ChatService().handleChat({
      personaId: "larae",
      provider: "openai",
      message: "Do not finish this request.",
      audio: false,
      testMode: false,
      history: []
    }, undefined, controller.signal)).rejects.toThrow();
  });

  it("returns a deterministic fallback when referenced generated media is no longer available", async () => {
    const conversationStore = new ConversationStore();
    const service = new ChatService(conversationStore);
    const conversation = await conversationStore.getOrCreate(undefined, [], {
      userId: "owner-a",
      personaId: "larae",
      titleSeed: "Give me an image of a sleeping puppy."
    });

    const seededConversation = await conversationStore.appendTurn(conversation, [
      {
        role: "user",
        content: "Give me an image of a sleeping puppy."
      },
      {
        role: "assistant",
        content: "Here is the image.",
        metadata: {
          provider: "openai_persona",
          outputs: [
            {
              type: "image",
              url: "/api/generated-media/media_missing",
              alt: "sleeping puppy",
              mimeType: "image/png",
              metadata: {
                generatedMediaId: "media_missing"
              }
            }
          ]
        }
      }
    ]);

    const response = await service.handleChat(
      {
        personaId: "larae",
        provider: "openai_persona",
        message: "What breed of puppy did you just send me?",
        audio: true,
        testMode: false,
        conversationId: seededConversation.id,
        history: []
      },
      undefined,
      undefined,
      undefined,
      { ownerId: "owner-a" }
    );

    const assistantReply = response.outputs.find((output) => output.type === "text");
    expect(assistantReply?.type === "text" ? assistantReply.text : "").toContain("image file is no longer available");
    expect(response.outputs.some((output) => output.type === "audio")).toBe(false);
    expect(response.history.at(-1)?.content).toContain("image file is no longer available");
  });

  it("asks for promised image uploads instead of inventing a replacement image", async () => {
    const response = await new ChatService().handleChat({
      personaId: "larae",
      provider: "openai_persona",
      message: "Can you mix these 2 images, I am uploading, together to give us a brand new character?",
      audio: true,
      testMode: false,
      history: [],
      toolOptions: {
        webSearch: false,
        fileSearch: false,
        codeInterpreter: false,
        imageGeneration: true,
        appFunctions: true,
        background: true,
        vectorStoreIds: []
      }
    });

    const assistantReply = response.outputs.find((output) => output.type === "text");
    expect(assistantReply?.type === "text" ? assistantReply.text : "").toBe(
      "Please attach the 2 images you want me to use, then send the request again."
    );
    expect(response.outputs.some((output) => output.type === "image")).toBe(false);
    expect(response.outputs.some((output) => output.type === "audio")).toBe(false);
    expect(response.history.at(-1)?.content).toContain("attach the 2 images");
  });

  it("asks for only the missing image when a two-image request supplies one", async () => {
    const response = await new ChatService().handleChat({
      personaId: "larae",
      provider: "openai_persona",
      message: "Combine these two images into one character.",
      audio: false,
      testMode: false,
      history: [],
      attachments: [{
        id: "asset_one",
        kind: "image",
        fileName: "one.png",
        mimeType: "image/png",
        sizeBytes: 128
      }],
      toolOptions: {
        webSearch: false,
        fileSearch: false,
        codeInterpreter: false,
        imageGeneration: true,
        appFunctions: true,
        background: true,
        vectorStoreIds: []
      }
    });

    const assistantReply = response.outputs.find((output) => output.type === "text");
    expect(assistantReply?.type === "text" ? assistantReply.text : "").toContain(
      "Please attach one more image"
    );
    expect(response.outputs.some((output) => output.type === "image")).toBe(false);
  });

  it("blocks generation when any explicitly requested reference count is incomplete", async () => {
    const response = await new ChatService().handleChat({
      personaId: "larae",
      provider: "openai_persona",
      message: "Combine these 4 uploaded images into one character.",
      audio: false,
      testMode: false,
      history: [],
      attachments: [
        { id: "asset_one", kind: "image", fileName: "one.png", mimeType: "image/png", sizeBytes: 128 },
        { id: "asset_two", kind: "image", fileName: "two.png", mimeType: "image/png", sizeBytes: 128 },
        { id: "asset_three", kind: "image", fileName: "three.png", mimeType: "image/png", sizeBytes: 128 }
      ],
      toolOptions: {
        webSearch: false,
        fileSearch: false,
        codeInterpreter: false,
        imageGeneration: true,
        appFunctions: true,
        background: true,
        vectorStoreIds: []
      }
    });

    const assistantReply = response.outputs.find((output) => output.type === "text");
    expect(assistantReply?.type === "text" ? assistantReply.text : "").toContain(
      "this request needs 4"
    );
    expect(assistantReply?.type === "text" ? assistantReply.text : "").toContain(
      "attach one more image"
    );
    expect(response.outputs.some((output) => output.type === "image")).toBe(false);
  });

  it("uses two available conversation images when the request explicitly refers to previous images", async () => {
    const conversationStore = new ConversationStore();
    const service = new ChatService(conversationStore);
    const conversation = await conversationStore.getOrCreate(undefined, [], {
      personaId: "larae",
      titleSeed: "Create two references."
    });
    const seededConversation = await conversationStore.appendTurn(conversation, [
      { role: "user", content: "Create two references." },
      {
        role: "assistant",
        content: "Here they are.",
        metadata: {
          provider: "openai_persona",
          outputs: [
            {
              type: "image",
              url: `data:image/png;base64,${Buffer.from("first-reference").toString("base64")}`,
              alt: "first reference",
              mimeType: "image/png"
            },
            {
              type: "image",
              url: `data:image/png;base64,${Buffer.from("second-reference").toString("base64")}`,
              alt: "second reference",
              mimeType: "image/png"
            }
          ]
        }
      }
    ]);

    const response = await service.handleChat({
      personaId: "larae",
      provider: "openai_persona",
      message: "Combine these two previous images into one character.",
      audio: false,
      testMode: false,
      conversationId: seededConversation.id,
      history: [],
      toolOptions: {
        webSearch: false,
        fileSearch: false,
        codeInterpreter: false,
        imageGeneration: true,
        appFunctions: true,
        background: true,
        vectorStoreIds: []
      }
    });

    const assistantReply = response.outputs.find((output) => output.type === "text");
    expect(assistantReply?.type === "text" ? assistantReply.text : "").not.toContain("Please attach");
  });

  it("does not substitute previous images when the user promises new uploads", async () => {
    const conversationStore = new ConversationStore();
    const service = new ChatService(conversationStore);
    const conversation = await conversationStore.getOrCreate(undefined, [], {
      personaId: "larae",
      titleSeed: "Create an old reference."
    });
    const seededConversation = await conversationStore.appendTurn(conversation, [
      { role: "user", content: "Create an old reference." },
      {
        role: "assistant",
        content: "Here it is.",
        metadata: {
          provider: "openai_persona",
          outputs: [{
            type: "image",
            url: `data:image/png;base64,${Buffer.from("old-reference").toString("base64")}`,
            alt: "old reference",
            mimeType: "image/png"
          }]
        }
      }
    ]);

    const response = await service.handleChat({
      personaId: "larae",
      provider: "openai_persona",
      message: "Mix these two images I am uploading into one character.",
      audio: false,
      testMode: false,
      conversationId: seededConversation.id,
      history: [],
      toolOptions: {
        webSearch: false,
        fileSearch: false,
        codeInterpreter: false,
        imageGeneration: true,
        appFunctions: true,
        background: true,
        vectorStoreIds: []
      }
    });

    const assistantReply = response.outputs.find((output) => output.type === "text");
    expect(assistantReply?.type === "text" ? assistantReply.text : "").toBe(
      "Please attach the 2 images you want me to use, then send the request again."
    );
  });

  it("automatically enables image generation for a resolved historical visual transformation", async () => {
    const conversationStore = new ConversationStore();
    const service = new ChatService(conversationStore);
    const conversation = await conversationStore.getOrCreate(undefined, [], {
      personaId: "larae",
      titleSeed: "Create a character portrait."
    });
    const seededConversation = await conversationStore.appendTurn(conversation, [
      { role: "user", content: "Create a character portrait." },
      {
        role: "assistant",
        content: "Here is the portrait.",
        metadata: {
          provider: "openai_persona",
          outputs: [{
            type: "image",
            url: `data:image/png;base64,${Buffer.from("portrait").toString("base64")}`,
            alt: "character portrait",
            mimeType: "image/png"
          }]
        }
      }
    ]);

    const response = await service.handleChat({
      personaId: "larae",
      provider: "openai_persona",
      message: "Make the background blue.",
      audio: false,
      testMode: false,
      conversationId: seededConversation.id,
      history: [],
      toolOptions: {
        webSearch: false,
        fileSearch: false,
        codeInterpreter: false,
        imageGeneration: false,
        appFunctions: true,
        background: false,
        vectorStoreIds: []
      }
    });

    expect(response.outputs.some((output) => output.type === "image")).toBe(true);
  });

  it("does not enable image generation for inspection of historical visual context", async () => {
    const conversationStore = new ConversationStore();
    const service = new ChatService(conversationStore);
    const conversation = await conversationStore.getOrCreate(undefined, [], {
      personaId: "larae",
      titleSeed: "Show a street sign."
    });
    const seededConversation = await conversationStore.appendTurn(conversation, [
      { role: "user", content: "Show a street sign." },
      {
        role: "assistant",
        content: "Here is the sign.",
        metadata: {
          provider: "openai_persona",
          outputs: [{
            type: "image",
            url: `data:image/png;base64,${Buffer.from("street-sign").toString("base64")}`,
            alt: "street sign",
            mimeType: "image/png"
          }]
        }
      }
    ]);

    const response = await service.handleChat({
      personaId: "larae",
      provider: "openai_persona",
      message: "Can you read the sign?",
      audio: false,
      testMode: false,
      conversationId: seededConversation.id,
      history: [],
      toolOptions: {
        webSearch: false,
        fileSearch: false,
        codeInterpreter: false,
        imageGeneration: false,
        appFunctions: true,
        background: false,
        vectorStoreIds: []
      }
    });

    expect(response.outputs.some((output) => output.type === "image")).toBe(false);
  });

  it("continues the original edit after the user answers a visual ambiguity", async () => {
    const conversationStore = new ConversationStore();
    const service = new ChatService(conversationStore);
    const conversation = await conversationStore.getOrCreate(undefined, [], {
      personaId: "larae",
      titleSeed: "Create image sets."
    });
    const image = (label: string) => ({
      type: "image" as const,
      url: `data:image/png;base64,${Buffer.from(label).toString("base64")}`,
      alt: label,
      mimeType: "image/png"
    });
    const older = await conversationStore.appendTurn(conversation, [
      { role: "user", content: "Create the older pair." },
      {
        role: "assistant",
        content: "Here is the older pair.",
        metadata: {
          outputs: [image("older first"), image("older second")],
          provider: "openai_persona"
        }
      }
    ]);
    const seededConversation = await conversationStore.appendTurn(older, [
      { role: "user", content: "Create the latest pair." },
      {
        role: "assistant",
        content: "Here is the latest pair.",
        metadata: {
          outputs: [image("latest first"), image("latest second")],
          provider: "openai_persona"
        }
      }
    ]);
    const request = {
      personaId: "larae" as const,
      provider: "openai_persona" as const,
      audio: false,
      testMode: false,
      conversationId: seededConversation.id,
      history: [],
      toolOptions: {
        webSearch: false,
        fileSearch: false,
        codeInterpreter: false,
        imageGeneration: false,
        appFunctions: true,
        background: false,
        vectorStoreIds: []
      }
    };

    const clarification = await service.handleChat({
      ...request,
      message: "Make the second image more realistic."
    });
    expect(clarification.outputs.some((output) => output.type === "image")).toBe(false);
    expect(clarification.outputs.find((output) => output.type === "text")).toMatchObject({
      type: "text",
      text: expect.stringContaining("earlier visual sets")
    });
    expect((await conversationStore.get(seededConversation.id))?.turns.at(-1)?.visualClarification)
      .toMatchObject({
        status: "ambiguous",
        originalRequest: "Make the second image more realistic.",
        selectedPositions: [2]
      });

    const completed = await service.handleChat({
      ...request,
      message: "The latest result."
    });
    expect(completed.outputs.some((output) => output.type === "image")).toBe(true);
  });
});
