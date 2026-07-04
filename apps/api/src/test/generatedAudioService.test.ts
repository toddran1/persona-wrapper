import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let storageRoot: string;

beforeEach(async () => {
  storageRoot = await mkdtemp(join(tmpdir(), "persona-generated-audio-"));
  process.env.STORAGE_LOCAL_ROOT = storageRoot;
  process.env.DATABASE_URL = "";
  vi.resetModules();
});

afterEach(async () => {
  await rm(storageRoot, { recursive: true, force: true });
  delete process.env.STORAGE_LOCAL_ROOT;
});

describe("generatedAudioService", () => {
  it("persists generated audio and rejects path traversal downloads", async () => {
    const { generatedAudioService } = await import("../services/generatedAudioService.js");
    const url = await generatedAudioService.register(Buffer.from("audio-smoke"), {
      fileName: "voice.mp3",
      mimeType: "audio/mpeg"
    });

    expect(url).toMatch(/^\/api\/generated-audio\/.+/);
    const token = url.split("/").pop();
    expect(token).toBeTruthy();

    const audio = await generatedAudioService.download(token ?? "");
    expect(audio.fileName).toBe("voice.mp3");
    expect(audio.mimeType).toBe("audio/mpeg");
    expect(audio.buffer.toString()).toBe("audio-smoke");

    await expect(generatedAudioService.download("../secret")).rejects.toThrow("Generated audio not found.");
  });
});
