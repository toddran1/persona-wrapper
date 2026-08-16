import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ContentBlock } from "@persona/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let storageRoot: string;
const originalAuthRequired = process.env.AUTH_REQUIRED;
const originalDatabaseUrl = process.env.DATABASE_URL;
const originalOpenAiApiKey = process.env.OPENAI_API_KEY;

beforeEach(async () => {
  storageRoot = await mkdtemp(join(tmpdir(), "persona-conversation-media-"));
  process.env.STORAGE_LOCAL_ROOT = storageRoot;
  process.env.DATABASE_URL = "";
  process.env.AUTH_REQUIRED = "false";
  process.env.OPENAI_API_KEY = "";
  vi.resetModules();
});

afterEach(async () => {
  await rm(storageRoot, { recursive: true, force: true });
  delete process.env.STORAGE_LOCAL_ROOT;
  if (originalDatabaseUrl === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = originalDatabaseUrl;
  if (originalAuthRequired === undefined) delete process.env.AUTH_REQUIRED;
  else process.env.AUTH_REQUIRED = originalAuthRequired;
  if (originalOpenAiApiKey === undefined) delete process.env.OPENAI_API_KEY;
  else process.env.OPENAI_API_KEY = originalOpenAiApiKey;
});

describe("conversation media context", () => {
  it("detects follow-up prompts that need the previous generated image", async () => {
    const { shouldUseConversationMediaContext } = await import("../services/conversationMediaContext.js");

    expect(shouldUseConversationMediaContext("What breed of puppy did you just send me?")).toBe(true);
    expect(shouldUseConversationMediaContext("What car was in the image you just gave me?")).toBe(true);
    expect(shouldUseConversationMediaContext("Can you make the image brighter?")).toBe(true);
    expect(shouldUseConversationMediaContext("ok now remove the sunglasses")).toBe(true);
    expect(shouldUseConversationMediaContext("Remove the sunglasses.")).toBe(true);
    expect(shouldUseConversationMediaContext("Add a necklace.")).toBe(true);
    expect(shouldUseConversationMediaContext("take those off")).toBe(false);
    expect(shouldUseConversationMediaContext("Give me a pound cake recipe.")).toBe(false);
  }, 15_000);

  it("resolves prior visuals when the tool-router hint flags a transform the patterns miss", async () => {
    const { resolveConversationMediaContext } = await import("../services/conversationMediaContext.js");
    const image = (label: string) => ({
      type: "image" as const,
      url: `data:image/png;base64,${Buffer.from(label).toString("base64")}`,
      alt: label
    });

    const conversation = {
      id: "conv-router-hint",
      turns: [{ userMessage: "Create a portrait with sunglasses.", outputs: [image("portrait")] }]
    };
    const patternMiss = await resolveConversationMediaContext(conversation, { message: "take those off" });
    expect(patternMiss.referenced).toBe(false);

    const hinted = await resolveConversationMediaContext(conversation, {
      message: "take those off",
      mediaReferenceHint: "transform"
    });
    expect(hinted).toMatchObject({
      referenced: true,
      intent: "transform",
      source: "generated_outputs",
      selectedPositions: [1]
    });
    expect(hinted.attachments).toHaveLength(1);
  });

  it("detects broad natural follow-up references to prior visual output", async () => {
    const { inferConversationMediaMinimum, shouldUseConversationMediaContext } = await import("../services/conversationMediaContext.js");

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
      "What is going on here?",
      "Now merge their faces to make something new.",
      "Combine them into a new character.",
      "Then restyle the character.",
      "Make her taller.",
      "Put them on a beach.",
      "Give him blue eyes.",
      "Make the background blue.",
      "More realistic.",
      "Same pose, different outfit.",
      "What does she look like?",
      "Can you read the sign?",
      "Go back to the original uploads.",
      "Use them as the reference.",
      "Try it in watercolor.",
      "Now in anime style.",
      "Now in anime",
      "In watercolor.",
      "Put these images side by side.",
      "Use images 1 and 3.",
      "Zoom in.",
      "Crop tighter.",
      "Remove background.",
      "Add a hat.",
      "Put a hat on her.",
      "Choose the best one.",
      "Use the one where she is smiling."
    ];

    for (const prompt of prompts) {
      expect(shouldUseConversationMediaContext(prompt), prompt).toBe(true);
    }
    expect(inferConversationMediaMinimum("Now merge their faces to make something new.")).toBe(2);
    expect(inferConversationMediaMinimum("Put these images side by side.")).toBe(2);
    expect(inferConversationMediaMinimum("Make the result brighter.")).toBe(1);
  });

  it("preflights historical visual edits without treating inspection or promised uploads as generation", async () => {
    const { shouldPlanHistoricalVisualTransformation } = await import("../services/conversationMediaContext.js");
    const conversation = {
      id: "conv_visual_preflight",
      turns: [{
        userMessage: "Create a portrait.",
        assistantText: "Here it is.",
        outputs: [{
          type: "image" as const,
          url: "data:image/png;base64,dGVzdA==",
          alt: "Portrait"
        }]
      }]
    };

    expect(shouldPlanHistoricalVisualTransformation(conversation, "Make the background blue.")).toBe(true);
    expect(shouldPlanHistoricalVisualTransformation(conversation, "Now in anime style.")).toBe(true);
    expect(shouldPlanHistoricalVisualTransformation(conversation, "Now in anime")).toBe(true);
    expect(shouldPlanHistoricalVisualTransformation(conversation, "In watercolor.")).toBe(true);
    expect(shouldPlanHistoricalVisualTransformation(conversation, "What color is the background?")).toBe(false);
    expect(shouldPlanHistoricalVisualTransformation(conversation, "Start over from scratch with a new image.")).toBe(false);
    expect(shouldPlanHistoricalVisualTransformation(conversation, "I am uploading a new image to edit.")).toBe(false);
    expect(shouldPlanHistoricalVisualTransformation({ id: "empty", turns: [] }, "Make the background blue.")).toBe(false);
  });

  it("returns an ambiguity instead of guessing when an ordinal matches multiple visual sets", async () => {
    const { resolveConversationMediaContext } = await import("../services/conversationMediaContext.js");
    const image = (label: string) => ({
      type: "image" as const,
      url: `data:image/png;base64,${Buffer.from(label).toString("base64")}`,
      alt: label
    });
    const result = await resolveConversationMediaContext({
      id: "conv-ambiguous",
      turns: [
        {
          userMessage: "Create an older pair.",
          outputs: [image("older first"), image("older second")]
        },
        {
          userMessage: "Create a newer pair.",
          outputs: [image("newer first"), image("newer second")]
        }
      ]
    }, {
      message: "Make the second image more realistic."
    });

    expect(result).toMatchObject({
      referenced: true,
      intent: "transform",
      source: "none",
      selectedPositions: [2]
    });
    expect(result.ambiguityMessage).toContain("2 earlier visual sets");
    expect(result.attachments).toHaveLength(0);
  });

  it("uses structured source and position selectors when the request is specific", async () => {
    const { resolveConversationMediaContext } = await import("../services/conversationMediaContext.js");
    const image = (label: string) => ({
      type: "image" as const,
      url: `data:image/png;base64,${Buffer.from(label).toString("base64")}`,
      alt: label
    });
    const latestSecondUrl = image("latest second").url;
    const result = await resolveConversationMediaContext({
      id: "conv-specific",
      turns: [
        {
          userMessage: "Create an older pair.",
          assistantText: "Here is the older pair.",
          outputs: [image("older first"), image("older second")]
        },
        {
          userMessage: "Create the latest pair.",
          assistantText: "Here is the latest pair.",
          outputs: [image("latest first"), { ...image("latest second"), url: latestSecondUrl }]
        }
      ]
    }, {
      message: "Make the second image from the latest result more realistic."
    });

    expect(result).toMatchObject({
      referenced: true,
      intent: "transform",
      source: "generated_outputs",
      selectedTurnIndexes: [1],
      selectedPositions: [2]
    });
    expect(result.ambiguityMessage).toBeUndefined();
    expect(result.attachments).toHaveLength(1);
    expect(result.attachments[0]?.url).toBe(latestSecondUrl);
    expect(result.promptContext).toContain("Originating user request: Create the latest pair.");
    expect(result.promptContext).toContain("position 2 (latest second)");
  });

  it("returns to the original uploads when the request contrasts them with a generated result", async () => {
    const { uploadService } = await import("../services/uploadService.js");
    const { resolveConversationMediaContext } = await import("../services/conversationMediaContext.js");
    const gif = Buffer.from("47494638396101000100800000ffffff00000021f90401000000002c00000000010001000002024401003b", "hex");
    const original = await uploadService.save("owner-a", {
      originalname: "original.gif",
      mimetype: "image/gif",
      size: gif.byteLength,
      buffer: gif
    } as Express.Multer.File);

    const result = await resolveConversationMediaContext({
      id: "conv-return-to-upload",
      turns: [{
        userMessage: "Use this as the source.",
        userAssets: [original],
        assistantText: "Here is the generated version.",
        outputs: [{
          type: "image",
          url: `data:image/png;base64,${Buffer.from("generated-result").toString("base64")}`,
          alt: "generated result"
        }]
      }]
    }, {
      message: "Go back to the original upload instead of the latest generated result and make it darker.",
      ownerId: "owner-a"
    });

    expect(result).toMatchObject({
      referenced: true,
      intent: "transform",
      source: "user_uploads",
      selectedTurnIndexes: [0],
      selectedPositions: [1]
    });
    expect(result.attachments).toHaveLength(1);
    expect(result.attachments[0]?.id).toBe(`conversation-upload:${original.id}`);
  });

  it("selects an earlier generated attempt by version ordinal", async () => {
    const { resolveConversationMediaContext } = await import("../services/conversationMediaContext.js");
    const image = (label: string) => ({
      type: "image" as const,
      url: `data:image/png;base64,${Buffer.from(label).toString("base64")}`,
      alt: label
    });
    const firstAttemptUrl = image("first attempt").url;

    const result = await resolveConversationMediaContext({
      id: "conv-version-selector",
      turns: [
        {
          userMessage: "Create the first version.",
          outputs: [{ ...image("first attempt"), url: firstAttemptUrl }]
        },
        {
          userMessage: "Try a second version.",
          outputs: [image("second attempt")]
        }
      ]
    }, {
      message: "Go back to the first attempt and make it darker."
    });

    expect(result).toMatchObject({
      referenced: true,
      intent: "transform",
      source: "generated_outputs",
      selectedTurnIndexes: [0],
      selectedPositions: [1]
    });
    expect(result.attachments[0]?.url).toBe(firstAttemptUrl);
  });

  it("does not interpret go back to the latest result as the original result", async () => {
    const { resolveConversationMediaContext } = await import("../services/conversationMediaContext.js");
    const image = (label: string) => ({
      type: "image" as const,
      url: `data:image/png;base64,${Buffer.from(label).toString("base64")}`,
      alt: label
    });
    const latestUrl = image("latest").url;

    const result = await resolveConversationMediaContext({
      id: "conv-latest-selector",
      turns: [
        { userMessage: "Create the original.", outputs: [image("original")] },
        { userMessage: "Create another.", outputs: [{ ...image("latest"), url: latestUrl }] }
      ]
    }, {
      message: "Go back to the latest generated result and make it brighter."
    });

    expect(result).toMatchObject({
      source: "generated_outputs",
      selectedTurnIndexes: [1],
      selectedPositions: [1]
    });
    expect(result.attachments[0]?.url).toBe(latestUrl);
  });

  it("treats original image as the earliest visual result when there are no uploads", async () => {
    const { resolveConversationMediaContext } = await import("../services/conversationMediaContext.js");
    const image = (label: string) => ({
      type: "image" as const,
      url: `data:image/png;base64,${Buffer.from(label).toString("base64")}`,
      alt: label
    });
    const originalUrl = image("original generated").url;

    const result = await resolveConversationMediaContext({
      id: "conv-original-generated",
      turns: [
        { outputs: [{ ...image("original generated"), url: originalUrl }] },
        { outputs: [image("latest generated")] }
      ]
    }, {
      message: "Make the original image darker."
    });

    expect(result).toMatchObject({
      source: "generated_outputs",
      selectedTurnIndexes: [0],
      selectedPositions: [1]
    });
    expect(result.attachments[0]?.url).toBe(originalUrl);
  });

  it("supports image positions written after a plural image noun", async () => {
    const { resolveConversationMediaContext } = await import("../services/conversationMediaContext.js");
    const image = (label: string) => ({
      type: "image" as const,
      url: `data:image/png;base64,${Buffer.from(label).toString("base64")}`,
      alt: label
    });

    const result = await resolveConversationMediaContext({
      id: "conv-position-list",
      turns: [{
        outputs: [image("one"), image("two"), image("three"), image("four")]
      }]
    }, {
      message: "Use images 1 and 3 from the latest result."
    });

    expect(result).toMatchObject({
      source: "generated_outputs",
      selectedPositions: [1, 3]
    });
    expect(result.attachments.map((attachment) => attachment.url)).toEqual([
      image("one").url,
      image("three").url
    ]);
  });

  it("honors exclusions instead of treating excluded ordinals as selections", async () => {
    const { resolveConversationMediaContext } = await import("../services/conversationMediaContext.js");
    const image = (label: string) => ({
      type: "image" as const,
      url: `data:image/png;base64,${Buffer.from(label).toString("base64")}`,
      alt: label
    });

    const result = await resolveConversationMediaContext({
      id: "conv-exclusions",
      turns: [{
        outputs: [image("one"), image("two"), image("three"), image("four")]
      }]
    }, {
      message: "Use all except the second image and make a collage."
    });

    expect(result).toMatchObject({
      intent: "transform",
      source: "generated_outputs",
      selectedPositions: [1, 3, 4]
    });
    expect(result.attachments.map((attachment) => attachment.url)).toEqual([
      image("one").url,
      image("three").url,
      image("four").url
    ]);
  });

  it("maps spatial selectors to the visual ordering and clarifies an even middle", async () => {
    const { resolveConversationMediaContext } = await import("../services/conversationMediaContext.js");
    const image = (label: string) => ({
      type: "image" as const,
      url: `data:image/png;base64,${Buffer.from(label).toString("base64")}`,
      alt: label
    });
    const conversation = {
      id: "conv-spatial",
      turns: [{
        outputs: [image("left"), image("middle-left"), image("middle-right"), image("right")]
      }]
    };

    const left = await resolveConversationMediaContext(conversation, {
      message: "Use the image on the left and make it brighter."
    });
    const bottom = await resolveConversationMediaContext(conversation, {
      message: "Use the bottom image and make it brighter."
    });
    const middle = await resolveConversationMediaContext(conversation, {
      message: "Use the middle image and make it brighter."
    });

    expect(left.selectedPositions).toEqual([1]);
    expect(left.attachments[0]?.url).toBe(image("left").url);
    expect(bottom.selectedPositions).toEqual([4]);
    expect(bottom.attachments[0]?.url).toBe(image("right").url);
    expect(middle.attachments).toHaveLength(0);
    expect(middle.ambiguityMessage).toContain("two middle images");
  });

  it("resolves result ordinals separately from image ordinals", async () => {
    const { resolveConversationMediaContext } = await import("../services/conversationMediaContext.js");
    const image = (label: string) => ({
      type: "image" as const,
      url: `data:image/png;base64,${Buffer.from(label).toString("base64")}`,
      alt: label
    });
    const selectedUrl = image("newer third").url;

    const result = await resolveConversationMediaContext({
      id: "conv-nested-selector",
      turns: [
        { outputs: [image("older first"), image("older second"), image("older third")] },
        { outputs: [image("newer first"), image("newer second"), { ...image("newer third"), url: selectedUrl }] }
      ]
    }, {
      message: "Use the third image from the second result and make it cinematic."
    });

    expect(result).toMatchObject({
      source: "generated_outputs",
      selectedTurnIndexes: [1],
      selectedPositions: [3],
      intent: "transform"
    });
    expect(result.attachments[0]?.url).toBe(selectedUrl);
  });

  it("passes the complete latest set for semantic image selection", async () => {
    const { resolveConversationMediaContext } = await import("../services/conversationMediaContext.js");
    const image = (label: string) => ({
      type: "image" as const,
      url: `data:image/png;base64,${Buffer.from(label).toString("base64")}`,
      alt: label
    });
    const conversation = {
      id: "conv-semantic-selector",
      turns: [{
        outputs: [image("serious"), image("smiling"), image("profile")]
      }]
    };

    const matching = await resolveConversationMediaContext(conversation, {
      message: "Use the one where she is smiling and make the background blue."
    });
    const best = await resolveConversationMediaContext(conversation, {
      message: "Choose the best one."
    });

    expect(matching).toMatchObject({
      intent: "transform",
      selectedPositions: [1, 2, 3]
    });
    expect(matching.attachments).toHaveLength(3);
    expect(best).toMatchObject({
      intent: "inspect",
      selectedPositions: [1, 2, 3]
    });
    expect(best.attachments).toHaveLength(3);
  });

  it("treats concise continuation commands as visual transformations", async () => {
    const { resolveConversationMediaContext } = await import("../services/conversationMediaContext.js");
    const conversation = {
      id: "conv-short-transform",
      turns: [{
        outputs: [{
          type: "image" as const,
          url: `data:image/png;base64,${Buffer.from("source").toString("base64")}`,
          alt: "source"
        }]
      }]
    };

    for (const message of [
      "Do it again.",
      "Run it back.",
      "Now with a blue background.",
      "Without the hat.",
      "Zoom in.",
      "Crop tighter.",
      "Remove background.",
      "Add a hat.",
      "Put a hat on her."
    ]) {
      const result = await resolveConversationMediaContext(conversation, { message });
      expect(result.referenced, message).toBe(true);
      expect(result.intent, message).toBe("transform");
      expect(result.attachments, message).toHaveLength(1);
    }
  });

  it("gives historical reset language precedence over positive reference matches", async () => {
    const { resolveConversationMediaContext } = await import("../services/conversationMediaContext.js");
    const conversation = {
      id: "conv-history-reset",
      turns: [{
        outputs: [{
          type: "image" as const,
          url: `data:image/png;base64,${Buffer.from("old").toString("base64")}`,
          alt: "old"
        }]
      }]
    };

    for (const message of [
      "Do not use the previous image; create a new one.",
      "Ignore the last result and start from scratch."
    ]) {
      const result = await resolveConversationMediaContext(conversation, { message });
      expect(result, message).toMatchObject({
        referenced: false,
        source: "none",
        attachments: []
      });
    }

    const currentOnly = await resolveConversationMediaContext(conversation, {
      message: "Use this image, not the previous one.",
      currentImageCount: 1
    });
    expect(currentOnly).toMatchObject({
      referenced: false,
      source: "none",
      attachments: []
    });
  });

  it("returns a precise clarification when an image position does not exist", async () => {
    const { resolveConversationMediaContext } = await import("../services/conversationMediaContext.js");
    const result = await resolveConversationMediaContext({
      id: "conv-missing-position",
      turns: [{
        outputs: [{
          type: "image",
          url: `data:image/png;base64,${Buffer.from("only image").toString("base64")}`,
          alt: "only image"
        }]
      }]
    }, {
      message: "Make image 3 from the latest result brighter."
    });

    expect(result.attachments).toHaveLength(0);
    expect(result.ambiguityMessage).toContain("image #3");
  });

  it("carries the original transformation through a short ambiguity answer", async () => {
    const { resolveConversationMediaContext } = await import("../services/conversationMediaContext.js");
    const image = (label: string) => ({
      type: "image" as const,
      url: `data:image/png;base64,${Buffer.from(label).toString("base64")}`,
      alt: label
    });
    const latestSecondUrl = image("latest second").url;

    const result = await resolveConversationMediaContext({
      id: "conv-clarification-continuity",
      turns: [
        {
          outputs: [image("older first"), image("older second")]
        },
        {
          outputs: [image("latest first"), { ...image("latest second"), url: latestSecondUrl }]
        },
        {
          userMessage: "Make the second image more realistic.",
          assistantText: "Which earlier visual set do you mean?",
          outputs: [{ type: "text", text: "Which earlier visual set do you mean?" }],
          visualClarification: {
            status: "ambiguous",
            originalRequest: "Make the second image more realistic.",
            selectedPositions: [2]
          }
        }
      ]
    }, {
      message: "The latest result."
    });

    expect(result).toMatchObject({
      intent: "transform",
      source: "generated_outputs",
      selectedTurnIndexes: [1],
      selectedPositions: [2]
    });
    expect(result.attachments[0]?.url).toBe(latestSecondUrl);
  });

  it("combines a current upload with an explicitly requested historical source", async () => {
    const { uploadService } = await import("../services/uploadService.js");
    const { resolveConversationMediaContext } = await import("../services/conversationMediaContext.js");
    const gif = Buffer.from("47494638396101000100800000ffffff00000021f90401000000002c00000000010001000002024401003b", "hex");
    const original = await uploadService.save("owner-a", {
      originalname: "original.gif",
      mimetype: "image/gif",
      size: gif.byteLength,
      buffer: gif
    } as Express.Multer.File);

    const result = await resolveConversationMediaContext({
      id: "conv-mixed",
      turns: [{
        userMessage: "Use this as the original character.",
        userAssets: [original],
        outputs: []
      }]
    }, {
      message: "Combine this new image with the original upload.",
      ownerId: "owner-a",
      currentImageCount: 1,
      minimumImages: 1,
      maxImages: 9
    });

    expect(result).toMatchObject({
      referenced: true,
      intent: "transform",
      source: "user_uploads",
      minimumImages: 2,
      selectedTurnIndexes: [0],
      selectedPositions: [1]
    });
    expect(result.attachments[0]?.id).toBe(`conversation-upload:${original.id}`);
  });

  it("keeps inspection follow-ups out of visual transformation mode", async () => {
    const { resolveConversationMediaContext } = await import("../services/conversationMediaContext.js");
    const result = await resolveConversationMediaContext({
      id: "conv-inspect",
      turns: [{
        userMessage: "Show a street sign.",
        outputs: [{
          type: "image",
          url: `data:image/png;base64,${Buffer.from("sign").toString("base64")}`,
          alt: "street sign"
        }]
      }]
    }, {
      message: "Can you read the sign?"
    });

    expect(result).toMatchObject({
      referenced: true,
      intent: "inspect",
      source: "generated_outputs",
      selectedPositions: [1]
    });
  });

  it("restores the latest prior upload set when a plural follow-up needs more images than the generated result", async () => {
    const { uploadService } = await import("../services/uploadService.js");
    const { resolveConversationMediaContext } = await import("../services/conversationMediaContext.js");
    const gif = Buffer.from("47494638396101000100800000ffffff00000021f90401000000002c00000000010001000002024401003b", "hex");
    const first = await uploadService.save("owner-a", {
      originalname: "first.gif",
      mimetype: "image/gif",
      size: gif.byteLength,
      buffer: gif
    } as Express.Multer.File);
    const second = await uploadService.save("owner-a", {
      originalname: "second.gif",
      mimetype: "image/gif",
      size: gif.byteLength,
      buffer: gif
    } as Express.Multer.File);

    const result = await resolveConversationMediaContext({
      id: "conv-test",
      turns: [{
        userAssets: [first, second],
        outputs: [{
          type: "image",
          url: `data:image/png;base64,${Buffer.from("single-generated-result").toString("base64")}`,
          alt: "combined character"
        }]
      }]
    }, {
      message: "Now merge their faces to make something new.",
      ownerId: "owner-a",
      maxImages: 10
    });

    expect(result).toMatchObject({
      referenced: true,
      source: "user_uploads",
      minimumImages: 2,
      candidateCount: 2,
      unavailableCount: 0
    });
    expect(result.attachments).toHaveLength(2);
    expect(result.attachments.map((asset) => asset.id)).toEqual([
      `conversation-upload:${first.id}`,
      `conversation-upload:${second.id}`
    ]);
    expect(result.attachments.every((asset) => Boolean(asset.storageKey || asset.localPath))).toBe(true);
  });

  it("preserves the complete prior source group for follow-ups involving more than two visuals", async () => {
    const { uploadService } = await import("../services/uploadService.js");
    const { resolveConversationMediaContext } = await import("../services/conversationMediaContext.js");
    const gif = Buffer.from("47494638396101000100800000ffffff00000021f90401000000002c00000000010001000002024401003b", "hex");
    const sources = await Promise.all(
      Array.from({ length: 4 }, (_, index) => uploadService.save("owner-a", {
        originalname: `source-${index + 1}.gif`,
        mimetype: "image/gif",
        size: gif.byteLength,
        buffer: gif
      } as Express.Multer.File))
    );

    const result = await resolveConversationMediaContext({
      id: "conv-four-sources",
      turns: [{
        userAssets: sources,
        outputs: [{
          type: "image",
          url: `data:image/png;base64,${Buffer.from("generated-result").toString("base64")}`,
          alt: "generated result"
        }]
      }]
    }, {
      message: "Now combine all of them into a new design.",
      ownerId: "owner-a",
      maxImages: 10
    });

    expect(result.source).toBe("user_uploads");
    expect(result.attachments).toHaveLength(4);
    expect(result.attachments.map((asset) => asset.id)).toEqual(
      sources.map((asset) => `conversation-upload:${asset.id}`)
    );
  });

  it("uses the latest generated result for a singular visual follow-up", async () => {
    const { resolveConversationMediaContext } = await import("../services/conversationMediaContext.js");
    const resultUrl = `data:image/png;base64,${Buffer.from("latest-result").toString("base64")}`;

    const result = await resolveConversationMediaContext({
      id: "conv-test",
      turns: [{
        userAssets: [{
          id: "old-upload",
          kind: "image",
          fileName: "source.png",
          mimeType: "image/png"
        }],
        outputs: [{ type: "image", url: resultUrl, alt: "latest result" }]
      }]
    }, {
      message: "Now make it brighter.",
      ownerId: "owner-a"
    });

    expect(result).toMatchObject({
      referenced: true,
      source: "generated_outputs",
      minimumImages: 1,
      candidateCount: 1,
      unavailableCount: 0
    });
    expect(result.attachments[0]?.url).toBe(resultUrl);
  });

  it("does not mix historical media into a fresh current upload set", async () => {
    const { resolveConversationMediaContext } = await import("../services/conversationMediaContext.js");
    const result = await resolveConversationMediaContext({
      id: "conv-test",
      turns: [{
        outputs: [{
          type: "image",
          url: `data:image/png;base64,${Buffer.from("old-result").toString("base64")}`,
          alt: "old result"
        }]
      }]
    }, {
      message: "Combine these two images I am uploading.",
      currentImageCount: 2,
      minimumImages: 2,
      expectsNewUploads: true
    });

    expect(result).toEqual({
      referenced: false,
      candidateCount: 0,
      attachments: [],
      unavailableCount: 0,
      minimumImages: 0,
      source: "none",
      intent: "transform",
      selectedTurnIndexes: [],
      selectedPositions: []
    });
  });

  it("does not manufacture a missing-image requirement when no visual history exists", async () => {
    const { resolveConversationMediaContext } = await import("../services/conversationMediaContext.js");
    const result = await resolveConversationMediaContext({
      id: "conv-text-only",
      turns: [{
        outputs: [{ type: "text", text: "Here is a dramatic introduction." }]
      }]
    }, {
      message: "Now turn that into a chart and a csv file."
    });

    expect(result).toEqual({
      referenced: true,
      candidateCount: 0,
      attachments: [],
      unavailableCount: 0,
      minimumImages: 1,
      source: "none",
      intent: "transform",
      selectedTurnIndexes: [],
      selectedPositions: []
    });
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

  // Regression corpus of realistic visual follow-up phrasings. Positive entries must be
  // detected as conversation-media references (and, for edits, plan a historical visual
  // transformation); negative entries must stay untriggered so ordinary chat never pulls
  // in prior images.
  describe("visual follow-up phrasing corpus", () => {
    const conversationWithImageTurn = {
      id: "conv_corpus",
      turns: [{
        userMessage: "Create a portrait.",
        assistantText: "Here it is.",
        outputs: [{
          type: "image" as const,
          url: "data:image/png;base64,dGVzdA==",
          alt: "Portrait"
        }]
      }]
    };

    const transformFollowUps = [
      // Style / aesthetic transfers
      "Now in anime style.",
      "Make it a cartoon.",
      "As a watercolor.",
      "Ghibli version please.",
      "More realistic.",
      "Cyberpunk it.",
      "Turn it into a painting.",
      "Comic book style please.",
      "Make it look like a comic book.",
      "Can you make it anime?",
      "Redo it in pixel art.",
      "Make it photorealistic.",
      "Same but in oil painting style.",
      "Render it as a sketch.",
      "In pop art style.",
      "Make it more cinematic.",
      // Attribute edits
      "Change her hair to red.",
      "Different background.",
      "Make the lighting moody.",
      "Smiling instead.",
      "Give her green eyes.",
      "Change the outfit to a red dress.",
      "Make him frown.",
      "Can you change the background to a beach?",
      "Make her hair longer.",
      "Put her in a business suit.",
      "Make the sky more dramatic.",
      // Add / remove / replace
      "Add a hat.",
      "Remove the background.",
      "Put sunglasses on him.",
      "Take out the text.",
      "Swap the car for a motorcycle.",
      "Replace the sunglasses with goggles.",
      "replace the sunglasses with googles.",
      "Swap the heels for sneakers.",
      "Replace her purse with a tote bag.",
      "Add a cat next to her.",
      "Get rid of the watermark.",
      "Remove the person in the background.",
      // Composition / crop / zoom / reframe
      "Zoom in.",
      "Zoom out a bit.",
      "Crop tighter.",
      "Make it square.",
      "Wider shot.",
      "Close up on her face.",
      "Portrait orientation.",
      "Crop it to a square.",
      "Reframe it as a close-up.",
      "Make it wider.",
      // Quality / enhancement
      "Sharper.",
      "Higher quality.",
      "Upscale it.",
      "Less blurry.",
      "Enhance the details.",
      "Make it sharper.",
      "More detail in the face.",
      // Variations / redo
      "Again.",
      "Another one.",
      "Same but different.",
      "One more version.",
      "Remix it.",
      "Do it again but cooler.",
      "Try again with a different pose.",
      "Give me another version.",
      // Combinations
      "Merge them.",
      "Combine both.",
      "Put them side by side.",
      "Blend the two images.",
      "Collage of all three.",
      "Mash them up.",
      // Text in image
      "Change the text to say hello.",
      "Remove the caption.",
      "Fix the typo in it.",
      // Format / medium
      "Make it a sticker.",
      "As an album cover.",
      "Poster version.",
      "Turn it into a logo.",
      "Phone wallpaper.",
      "Make it a meme.",
      // Subject preservation
      "Keep her face but change everything else.",
      "Same character, new scene.",
      "Don't change the pose.",
      "Keep the pose but change the background.",
      // Continuations relying on prior context
      "Now the same for Bam Bam.",
      "Do the same with the other one.",
      "And now at night.",
      "Now make it nighttime.",
      // Voice/STT phrasing: leading fillers, no punctuation
      "Um now in anime style",
      "Uh make it brighter",
      "So can you change the background",
      "Okay so like make it a cartoon",
      // Persona self-reference: addressing the persona as "you"
      "Change your hair.",
      "Put yourself in a suit.",
      "Make your outfit red.",
      "Now you in anime style.",
      "Give yourself blue eyes.",
      "Smile in this one.",
      "Change yo outfit.",
      // Polite prefixes on terse requests
      "Could you turn it into a sticker?",
      "Please make it sharper.",
      "Can you put her on a beach?",
      // Combined clauses
      "Now in anime style and brighter.",
      "Make it a cartoon and remove the background.",
      "Sharper and brighter.",
      // Seasons / times / weather / orientation
      "Make it winter.",
      "Now at sunset.",
      "In the rain.",
      "Snow.",
      "Night version.",
      "Vertical.",
      "16:9",
      // Persona-tone comparatives
      "Make it sexier.",
      "Cuter.",
      "Cooler.",
      "Moodier.",
      "Fancier.",
      "More badass.",
      // "Another / one more" with politeness
      "Can I get another one?",
      "One more please.",
      "Send me another version.",
      // GIF / motion asks
      "Make it move.",
      "Animate it.",
      "GIF version.",
      "As a GIF."
    ];

    const multiImageFollowUps = [
      "Merge them.",
      "Combine both.",
      "Put them side by side.",
      "Blend the two images.",
      "Collage of all three.",
      "Mash them up."
    ];

    const inspectionFollowUps = [
      "What color is the background?",
      "Tell me about the image.",
      "What's in the picture?",
      "Describe the photo.",
      "What is she wearing?",
      "Is there a dog in the image?",
      "How many people are in the picture?"
    ];

    const selectionReferences = [
      "The first one.",
      "Image 2.",
      "Use the third.",
      "The one on the left.",
      "Second version.",
      "Use image 2."
    ];

    const nonReferences = [
      "Now in French.",
      "What's your style?",
      "Nice, I like your style.",
      "Love your style.",
      "Now draw a cat.",
      "Now let's talk about something else.",
      "In my opinion, that would be wrong.",
      "Style guide for my blog?",
      "Give me a pound cake recipe.",
      "Let's change the subject.",
      "Turn left at the next intersection.",
      "Make me a sandwich.",
      "How do I change the oil in my car?",
      // Compliments and ordinary chat about the persona, not visual follow-ups.
      "You look good today.",
      "Can you tell me about yourself?",
      "Your style is amazing.",
      "In your opinion.",
      "What's your favorite season?",
      // Non-visual attribute: "attitude" is not in the visual attribute noun list.
      "Change your attitude.",
      "You're cute.",
      "Can you sing?",
      // Statement about winter, not a recast request.
      "Winter is coming."
    ];

    it("detects edit follow-ups as transform-intent media references that plan a historical transformation", async () => {
      const {
        inferVisualIntent,
        shouldPlanHistoricalVisualTransformation,
        shouldUseConversationMediaContext
      } = await import("../services/conversationMediaContext.js");

      for (const message of transformFollowUps) {
        expect(shouldUseConversationMediaContext(message), `referenced: ${message}`).toBe(true);
        expect(inferVisualIntent(message), `transform: ${message}`).toBe("transform");
        expect(shouldPlanHistoricalVisualTransformation(conversationWithImageTurn, message), `plan: ${message}`).toBe(true);
      }
    });

    it("asks for at least two images for merge-style follow-ups", async () => {
      const { inferConversationMediaMinimum } = await import("../services/conversationMediaContext.js");

      for (const message of multiImageFollowUps) {
        expect(inferConversationMediaMinimum(message), `minimum 2: ${message}`).toBe(2);
      }
    });

    it("keeps questions about the image as inspect-only references", async () => {
      const {
        inferVisualIntent,
        shouldPlanHistoricalVisualTransformation,
        shouldUseConversationMediaContext
      } = await import("../services/conversationMediaContext.js");

      for (const message of inspectionFollowUps) {
        expect(shouldUseConversationMediaContext(message), `referenced: ${message}`).toBe(true);
        expect(inferVisualIntent(message), `inspect: ${message}`).toBe("inspect");
        expect(shouldPlanHistoricalVisualTransformation(conversationWithImageTurn, message), `no plan: ${message}`).toBe(false);
      }
    });

    it("detects ordinal and spatial selection references", async () => {
      const { shouldUseConversationMediaContext } = await import("../services/conversationMediaContext.js");

      for (const message of selectionReferences) {
        expect(shouldUseConversationMediaContext(message), `referenced: ${message}`).toBe(true);
      }
    });

    it("does not treat ordinary chat as a media reference", async () => {
      const {
        shouldPlanHistoricalVisualTransformation,
        shouldUseConversationMediaContext
      } = await import("../services/conversationMediaContext.js");

      for (const message of nonReferences) {
        expect(shouldUseConversationMediaContext(message), `not referenced: ${message}`).toBe(false);
        expect(shouldPlanHistoricalVisualTransformation(conversationWithImageTurn, message), `no plan: ${message}`).toBe(false);
      }
    });
  });
});
