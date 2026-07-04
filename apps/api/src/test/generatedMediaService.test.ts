import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let storageRoot: string;

beforeEach(async () => {
  storageRoot = await mkdtemp(join(tmpdir(), "persona-generated-media-"));
  process.env.STORAGE_LOCAL_ROOT = storageRoot;
  process.env.DATABASE_URL = "";
  vi.resetModules();
});

afterEach(async () => {
  await rm(storageRoot, { recursive: true, force: true });
  delete process.env.STORAGE_LOCAL_ROOT;
});

describe("generatedMediaService", () => {
  it("persists data URL content blocks as local generated media URLs", async () => {
    const { generatedMediaService } = await import("../services/generatedMediaService.js");
    const pngDataUrl = `data:image/png;base64,${Buffer.from("png-smoke").toString("base64")}`;

    const [block] = await generatedMediaService.normalizeContentBlocks([
      {
        type: "image",
        url: pngDataUrl,
        alt: "smoke image"
      }
    ]);

    expect(block?.type).toBe("image");
    if (!block || block.type !== "image") {
      throw new Error("Expected generated media block to remain an image block.");
    }

    expect(block).toMatchObject({
      type: "image",
      url: expect.stringMatching(/^\/api\/generated-media\/media_.+/),
      mimeType: "image/png"
    });
    expect(block.metadata).toMatchObject({
      storage: "generated_media",
      generatedMediaId: expect.stringMatching(/^media_.+/),
      sizeBytes: Buffer.byteLength("png-smoke")
    });

    const id = block.url.split("/").pop();
    expect(id).toBeTruthy();
    const media = await generatedMediaService.download(id ?? "");
    expect(media.mimeType).toBe("image/png");
    expect(media.buffer.toString()).toBe("png-smoke");
  });
});
