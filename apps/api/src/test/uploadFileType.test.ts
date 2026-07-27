import { describe, expect, it } from "vitest";
import {
  canonicalUploadMetadata,
  isPersistedUploadReady,
  MAX_UPLOAD_BATCH_BYTES,
  MAX_UPLOAD_FILES,
  validateFileContents,
  validateUploadBatch
} from "../services/uploadService.js";

function upload(mimetype: string, buffer: Buffer): Express.Multer.File {
  return { mimetype, buffer } as Express.Multer.File;
}

describe("upload content type validation", () => {
  it("accepts valid text and JSON without binary signature guesses", async () => {
    await expect(validateFileContents(upload("text/plain", Buffer.from("hello")))).resolves.toBeUndefined();
    await expect(validateFileContents(upload("application/json", Buffer.from('{"ok":true}')))).resolves.toBeUndefined();
  });

  it("rejects a declared image whose detected file type does not match", async () => {
    await expect(validateFileContents(upload("image/png", Buffer.from("not a png")))).rejects.toMatchObject({ statusCode: 415 });
  });

  it("uses file-type detection for binary formats", async () => {
    const gif = Buffer.from("47494638396101000100800000ffffff00000021f90401000000002c00000000010001000002024401003b", "hex");
    await expect(validateFileContents(upload("image/gif", gif))).resolves.toBeUndefined();
  });

  it("corrects a mislabeled supported image before it reaches storage or OpenAI", async () => {
    const gif = Buffer.from("47494638396101000100800000ffffff00000021f90401000000002c00000000010001000002024401003b", "hex");

    await expect(canonicalUploadMetadata("picked-image.webp", "image/webp", gif)).resolves.toEqual({
      fileName: "picked-image.gif",
      mimeType: "image/gif"
    });
  });

  it("enforces the documented aggregate request envelope", () => {
    expect(() => validateUploadBatch(Array.from({ length: MAX_UPLOAD_FILES }, () => ({ sizeBytes: 1 })))).not.toThrow();
    expect(() => validateUploadBatch(Array.from({ length: MAX_UPLOAD_FILES + 1 }, () => ({ sizeBytes: 1 })))).toThrow(/maximum/i);
    expect(() => validateUploadBatch([{ sizeBytes: MAX_UPLOAD_BATCH_BYTES + 1 }])).toThrow(/combined upload size/i);
  });

  it("only exposes completed presigned uploads while preserving legacy atomic uploads", () => {
    expect(isPersistedUploadReady({})).toBe(true);
    expect(isPersistedUploadReady({ uploadStatus: "ready" })).toBe(true);
    expect(isPersistedUploadReady({ uploadStatus: "pending" })).toBe(false);
    expect(isPersistedUploadReady({ uploadStatus: "processing" })).toBe(false);
    expect(isPersistedUploadReady({ uploadStatus: "failed" })).toBe(false);
  });
});
