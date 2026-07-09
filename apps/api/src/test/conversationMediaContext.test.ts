import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ContentBlock } from "@persona/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let storageRoot: string;

beforeEach(async () => {
  storageRoot = await mkdtemp(join(tmpdir(), "persona-conversation-media-"));
  process.env.STORAGE_LOCAL_ROOT = storageRoot;
  process.env.DATABASE_URL = "";
  vi.resetModules();
});

afterEach(async () => {
  await rm(storageRoot, { recursive: true, force: true });
  delete process.env.STORAGE_LOCAL_ROOT;
  delete process.env.DATABASE_URL;
});

describe("conversation media context", () => {
  it("detects follow-up prompts that need the previous generated image", async () => {
    const { shouldUseConversationMediaContext } = await import("../services/conversationMediaContext.js");

    expect(shouldUseConversationMediaContext("What breed of puppy did you just send me?")).toBe(true);
    expect(shouldUseConversationMediaContext("What car was in the image you just gave me?")).toBe(true);
    expect(shouldUseConversationMediaContext("Can you make the image brighter?")).toBe(true);
    expect(shouldUseConversationMediaContext("Give me a pound cake recipe.")).toBe(false);
  });

  it("detects broad natural follow-up references to prior visual output", async () => {
    const { shouldUseConversationMediaContext } = await import("../services/conversationMediaContext.js");

    const prompts = [
      "What am I looking at?",
      "Tell me what you see.",
      "Caption this.",
      "What color is the dress?",
      "Does it have sunglasses?",
      "Can you tell what kind of dog that is?",
      "Use that as the reference and make another version.",
      "Run it back but make the background darker.",
      "Keep the same skin tone and change the outfit.",
      "Change her hair and add hoop earrings.",
      "What is in the top image?",
      "Make the second one more realistic.",
      "Compare it to the reference image.",
      "Use the uploaded picture and make it anime style.",
      "What text is visible in that photo?",
      "Can you inspect the file I attached?",
      "Now add a red hoodie to it.",
      "Do it again but with better lighting.",
      "What breed is it?",
      "What is going on here?"
    ];

    for (const prompt of prompts) {
      expect(shouldUseConversationMediaContext(prompt), prompt).toBe(true);
    }
  });

  it("resolves the latest generated image as a hidden OpenAI image attachment", async () => {
    const { generatedMediaService } = await import("../services/generatedMediaService.js");
    const { resolveConversationMediaContext } = await import("../services/conversationMediaContext.js");
    const pngDataUrl = `data:image/png;base64,${Buffer.from("puppy-image").toString("base64")}`;
    const persisted = await generatedMediaService.persistDataUrl(pngDataUrl, { ownerId: "owner-a" });
    const imageBlock: ContentBlock = {
      type: "image",
      url: persisted.url,
      alt: "sleeping puppy",
      mimeType: persisted.mimeType,
      metadata: {
        generatedMediaId: persisted.id
      }
    };

    const result = await resolveConversationMediaContext(
      {
        id: "conv-test",
        turns: [
          {
            outputs: [imageBlock]
          }
        ]
      },
      {
        message: "What breed of puppy did you just send me?",
        ownerId: "owner-a"
      }
    );

    const attachments = result.attachments;
    expect(result).toMatchObject({
      referenced: true,
      candidateCount: 1,
      unavailableCount: 0
    });
    expect(attachments).toHaveLength(1);
    expect(attachments[0]).toMatchObject({
      kind: "image",
      fileName: expect.stringMatching(/^media_.+\.png$/),
      mimeType: "image/png",
      sizeBytes: Buffer.byteLength("puppy-image")
    });
    expect(attachments[0]?.url).toBe(`data:image/png;base64,${Buffer.from("puppy-image").toString("base64")}`);
  });

  it("uses legacy data URL image outputs as follow-up visual context", async () => {
    const { resolveConversationMediaContext } = await import("../services/conversationMediaContext.js");
    const pngDataUrl = `data:image/png;base64,${Buffer.from("lexus-image").toString("base64")}`;

    const result = await resolveConversationMediaContext(
      {
        id: "conv-test",
        turns: [
          {
            outputs: [
              {
                type: "image",
                url: pngDataUrl,
                alt: "LaRae driving",
                mimeType: "image/png"
              }
            ]
          }
        ]
      },
      {
        message: "What car was in the image you just gave me?",
        ownerId: "owner-a"
      }
    );

    expect(result).toMatchObject({
      referenced: true,
      candidateCount: 1,
      unavailableCount: 0
    });
    expect(result.attachments).toHaveLength(1);
    expect(result.attachments[0]).toMatchObject({
      kind: "image",
      fileName: "conversation-image-1.png",
      mimeType: "image/png",
      sizeBytes: Buffer.byteLength("lexus-image"),
      url: pngDataUrl
    });
  });

  it("does not leak generated media across owners", async () => {
    const { generatedMediaService } = await import("../services/generatedMediaService.js");
    const { resolveConversationMediaContext } = await import("../services/conversationMediaContext.js");
    const persisted = await generatedMediaService.persistDataUrl(
      `data:image/png;base64,${Buffer.from("owned-image").toString("base64")}`,
      { ownerId: "owner-a" }
    );

    const result = await resolveConversationMediaContext(
      {
        id: "conv-test",
        turns: [
          {
            outputs: [
              {
                type: "image",
                url: persisted.url,
                alt: "owned image",
                metadata: {
                  generatedMediaId: persisted.id
                }
              }
            ]
          }
        ]
      },
      {
        message: "What is in that image?",
        ownerId: "owner-b"
      }
    );

    expect(result).toMatchObject({
      referenced: true,
      candidateCount: 1,
      attachments: [],
      unavailableCount: 1
    });
  });
});
