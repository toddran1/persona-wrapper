import { describe, expect, it } from "vitest";
import {
  analyzeImageReferenceRequirement,
  missingImageReferenceMessage
} from "../services/imageReferenceRequirement.js";

describe("image reference requirements", () => {
  it("requires the explicit number of promised uploads", () => {
    for (const count of [2, 3, 4, 7, 10, 12, 25]) {
      expect(
        analyzeImageReferenceRequirement(
          `Can you mix these ${count} images, I am uploading, together to give us a brand new character?`
        ),
        `expected all ${count} requested references to be required`
      ).toEqual({
        required: true,
        minimumImages: count,
        expectsNewUploads: true
      });
    }
  });

  it("supports written reference counts beyond the original two-image example", () => {
    expect(analyzeImageReferenceRequirement(
      "Blend these twelve photos I am sending into a group portrait."
    )).toEqual({
      required: true,
      minimumImages: 12,
      expectsNewUploads: true
    });
  });

  it("recognizes counts placed before attachment and reference modifiers", () => {
    for (const prompt of [
      "Combine these 4 uploaded images into one character.",
      "Mix the 3 attached photos into one portrait.",
      "Blend my 5 reference images into a mood board.",
      "Use all 6 source pictures for the final design."
    ]) {
      expect(analyzeImageReferenceRequirement(prompt), prompt).toMatchObject({
        required: true,
        minimumImages: Number(prompt.match(/\d+/)?.[0])
      });
    }
  });

  it("infers two references for plural combination requests", () => {
    expect(analyzeImageReferenceRequirement("Combine these photos into one polished character.")).toMatchObject({
      required: true,
      minimumImages: 2
    });
  });

  it("requires one reference for a specific attached-image edit", () => {
    expect(analyzeImageReferenceRequirement("Use the attached image and recolor the jacket.")).toEqual({
      required: true,
      minimumImages: 1,
      expectsNewUploads: true
    });
  });

  it("recognizes future upload phrasing", () => {
    for (const prompt of [
      "I will upload three images for you to combine.",
      "I'm going to attach 4 photos for a collage.",
      "We will send two reference pictures to merge.",
      "We'll upload 3 pictures for you to combine.",
      "We're going to send two images to merge.",
      "I just uploaded two images to combine."
    ]) {
      expect(analyzeImageReferenceRequirement(prompt), prompt).toMatchObject({
        required: true,
        expectsNewUploads: true
      });
    }
    expect(analyzeImageReferenceRequirement(
      "I'm going to attach 4 photos for a collage."
    ).minimumImages).toBe(4);
  });

  it("covers comparisons, collages, and side-by-side layouts", () => {
    for (const prompt of [
      "Compare these two images.",
      "Rank these 3 photos from best to worst.",
      "Make a collage from these 4 pictures.",
      "Put these two images side by side."
    ]) {
      expect(analyzeImageReferenceRequirement(prompt), prompt).toMatchObject({
        required: true,
        minimumImages: Number(prompt.match(/\d+/)?.[0] ?? 2)
      });
    }
  });

  it("requires a missing original upload without confusing it with text-to-image generation", () => {
    expect(analyzeImageReferenceRequirement(
      "Use the original upload and make it darker."
    )).toEqual({
      required: true,
      minimumImages: 1,
      expectsNewUploads: false
    });
  });

  it("does not treat ordinary text-to-image counts as missing references", () => {
    for (const prompt of [
      "Create an image of two friends walking through Miami.",
      "Generate 2 images of a red sports car.",
      "Create a brand new fantasy character."
    ]) {
      expect(analyzeImageReferenceRequirement(prompt), prompt).toEqual({
        required: false,
        minimumImages: 0,
        expectsNewUploads: false
      });
    }
  });

  it("does not turn explicitly excluded historical media into a requirement", () => {
    expect(analyzeImageReferenceRequirement(
      "Do not use the previous image; create a new one."
    )).toEqual({
      required: false,
      minimumImages: 0,
      expectsNewUploads: false
    });
    expect(analyzeImageReferenceRequirement(
      "Ignore the last result and start from scratch."
    )).toEqual({
      required: false,
      minimumImages: 0,
      expectsNewUploads: false
    });
    expect(analyzeImageReferenceRequirement(
      "Use this image, not the previous one."
    )).toEqual({
      required: true,
      minimumImages: 1,
      expectsNewUploads: false
    });
  });

  it("builds clear zero-attachment and partial-attachment messages", () => {
    expect(missingImageReferenceMessage(2, 0)).toBe(
      "Please attach the 2 images you want me to use, then send the request again."
    );
    expect(missingImageReferenceMessage(2, 1)).toBe(
      "I have one image, but this request needs 2. Please attach one more image, then send the request again."
    );
    expect(missingImageReferenceMessage(4, 2)).toBe(
      "I have 2 images, but this request needs 4. Please attach 2 more images, then send the request again."
    );
    expect(missingImageReferenceMessage(12, 0)).toBe(
      "This request needs 12 images, but you can attach up to 10 files to one message. Please split the request into smaller groups."
    );
  });
});
