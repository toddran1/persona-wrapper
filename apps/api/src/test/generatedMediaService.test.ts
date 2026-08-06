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
  delete process.env.AUTH_REQUIRE_OWNED_MEDIA_ACCESS;
});

describe("generatedMediaService", () => {
  it("persists data URL content blocks as local generated media URLs", async () => {
    const { generatedMediaService } = await import("../services/generatedMediaService.js");
    const pngDataUrl = `data:image/png;base64,${Buffer.from("png-smoke").toString("base64")}`;

    const [block] = await generatedMediaService.normalizeContentBlocks(
      [
        {
          type: "image",
          url: pngDataUrl,
          alt: "smoke image"
        }
      ],
      {
        ownerId: "owner-a",
        conversationId: "conv-a",
        messageId: "msg-a",
        metadata: { provider: "openai" }
      }
    );

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
      provider: "openai",
      sizeBytes: Buffer.byteLength("png-smoke")
    });

    const id = block.url.split("/").pop();
    expect(id).toBeTruthy();
    await expect(generatedMediaService.download(id ?? "", "owner-b")).rejects.toThrow("Generated media not found.");
    const media = await generatedMediaService.download(id ?? "", "owner-a");
    expect(media.mimeType).toBe("image/png");
    expect(media.buffer.toString()).toBe("png-smoke");
  });

  it("downgrades non-renderable MIME types to a plain binary download", async () => {
    const { generatedMediaService } = await import("../services/generatedMediaService.js");
    const htmlDataUrl = `data:text/html;base64,${Buffer.from("<script>alert(1)</script>").toString("base64")}`;

    const persisted = await generatedMediaService.persistDataUrl(htmlDataUrl, { ownerId: "owner-a" });

    expect(persisted.mimeType).toBe("application/octet-stream");
    const media = await generatedMediaService.download(persisted.id, "owner-a");
    expect(media.mimeType).toBe("application/octet-stream");
    expect(media.buffer.toString()).toBe("<script>alert(1)</script>");
  });

  it("rejects generated media downloads for the wrong owner", async () => {
    const { generatedMediaService } = await import("../services/generatedMediaService.js");
    const persisted = await generatedMediaService.persistDataUrl(
      `data:image/png;base64,${Buffer.from("owned-png").toString("base64")}`,
      { ownerId: "owner-a" }
    );

    await expect(generatedMediaService.download(persisted.id, "owner-b")).rejects.toThrow("Generated media not found.");
    await expect(generatedMediaService.download(persisted.id, "owner-a")).resolves.toMatchObject({
      mimeType: "image/png"
    });
  });

  it("fails closed for legacy unowned media when owned access is required", async () => {
    process.env.AUTH_REQUIRE_OWNED_MEDIA_ACCESS = "true";
    vi.resetModules();
    const { generatedMediaService } = await import("../services/generatedMediaService.js");
    const persisted = await generatedMediaService.persistDataUrl(
      `data:image/png;base64,${Buffer.from("legacy-unowned-png").toString("base64")}`
    );

    await expect(generatedMediaService.download(persisted.id, "owner-a"))
      .rejects.toThrow("Generated media not found.");
  });
});
