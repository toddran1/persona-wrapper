import { describe, expect, it } from "vitest";
import { validateFileContents } from "../services/uploadService.js";

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
});
