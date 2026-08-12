import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const openAIMocks = vi.hoisted(() => ({
  create: vi.fn(),
  delete: vi.fn().mockResolvedValue({ deleted: true })
}));

vi.mock("openai", () => ({
  default: class MockOpenAI {
    files = openAIMocks;
  },
  toFile: vi.fn(async () => ({ name: "upload" }))
}));

let storageRoot: string;
const originalOpenAIKey = process.env.OPENAI_API_KEY;
const originalDatabaseUrl = process.env.DATABASE_URL;
const originalAuthRequired = process.env.AUTH_REQUIRED;

beforeEach(async () => {
  storageRoot = await mkdtemp(join(tmpdir(), "persona-provider-upload-"));
  process.env.STORAGE_LOCAL_ROOT = storageRoot;
  process.env.DATABASE_URL = "";
  process.env.AUTH_REQUIRED = "false";
  process.env.OPENAI_API_KEY = "test-openai-key";
  openAIMocks.create.mockReset();
  openAIMocks.delete.mockClear();
  vi.resetModules();
});

afterEach(async () => {
  await rm(storageRoot, { recursive: true, force: true });
  delete process.env.STORAGE_LOCAL_ROOT;
  if (originalOpenAIKey === undefined) delete process.env.OPENAI_API_KEY;
  else process.env.OPENAI_API_KEY = originalOpenAIKey;
  if (originalDatabaseUrl === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = originalDatabaseUrl;
  if (originalAuthRequired === undefined) delete process.env.AUTH_REQUIRED;
  else process.env.AUTH_REQUIRED = originalAuthRequired;
});

describe("provider-specific upload preparation", () => {
  it("keeps a durable upload available to Gemini and retries OpenAI registration lazily", async () => {
    openAIMocks.create.mockResolvedValueOnce({ id: "file_lazy_retry" });
    const { uploadService } = await import("../services/uploadService.js");
    const gif = Buffer.from(
      "47494638396101000100800000ffffff00000021f90401000000002c00000000010001000002024401003b",
      "hex"
    );

    const saved = await uploadService.saveBuffer("owner-a", {
      fileName: "reference.gif",
      mimeType: "image/gif",
      buffer: gif
    });

    expect(saved.openaiFileId).toBeUndefined();
    const geminiAssets = await uploadService.resolveAssets("owner-a", [saved.id], "gemini");
    expect(geminiAssets).toHaveLength(1);
    expect(geminiAssets[0]?.id).toBe(saved.id);
    expect(geminiAssets[0]?.openaiFileId).toBeUndefined();
    expect(openAIMocks.create).not.toHaveBeenCalled();

    await expect(uploadService.resolveAssets("owner-a", [saved.id], "openai")).resolves.toMatchObject([
      { id: saved.id, openaiFileId: "file_lazy_retry" }
    ]);
    expect(openAIMocks.create).toHaveBeenCalledTimes(1);
  });

  it("contains a lazy OpenAI preparation outage to OpenAI requests", async () => {
    openAIMocks.create.mockRejectedValueOnce(new Error("OpenAI Files is temporarily unavailable"));
    const { uploadService } = await import("../services/uploadService.js");
    const gif = Buffer.from(
      "47494638396101000100800000ffffff00000021f90401000000002c00000000010001000002024401003b",
      "hex"
    );
    const saved = await uploadService.saveBuffer("owner-b", {
      fileName: "reference.gif",
      mimeType: "image/gif",
      buffer: gif
    });

    await expect(uploadService.resolveAssets("owner-b", [saved.id], "openai"))
      .rejects.toThrow("OpenAI Files is temporarily unavailable");
    await expect(uploadService.resolveAssets("owner-b", [saved.id], "gemini"))
      .resolves.toMatchObject([{ id: saved.id }]);
  });
});
