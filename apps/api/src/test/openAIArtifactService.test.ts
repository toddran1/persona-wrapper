import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { llmOutputSchema } from "@persona/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let storageRoot: string;
const originalDatabaseUrl = process.env.DATABASE_URL;

async function closeLoadedDatabase(): Promise<void> {
  try {
    const { closeDatabase } = await import("../db/client.js");
    await closeDatabase();
  } catch {
    // The DB module is not loaded in DB-free tests.
  }
}

async function waitFor<T>(producer: () => Promise<T | undefined>, description: string): Promise<T> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const value = await producer();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`Timed out waiting for ${description}.`);
}

beforeEach(async () => {
  storageRoot = await mkdtemp(join(tmpdir(), "persona-openai-artifacts-"));
  process.env.STORAGE_LOCAL_ROOT = storageRoot;
  process.env.OPENAI_API_KEY = "";
  vi.resetModules();
});

afterEach(async () => {
  await closeLoadedDatabase();
  await rm(storageRoot, { recursive: true, force: true });
  delete process.env.STORAGE_LOCAL_ROOT;
  if (originalDatabaseUrl) {
    process.env.DATABASE_URL = originalDatabaseUrl;
  } else {
    delete process.env.DATABASE_URL;
  }
  delete process.env.OPENAI_API_KEY;
});

describe("openAIArtifactService", () => {
  it("adds ownership metadata to artifact blocks without breaking audio blocks", async () => {
    process.env.DATABASE_URL = "";
    vi.resetModules();
    const { openAIArtifactService } = await import("../services/openAIArtifactService.js");
    const imageUrl = openAIArtifactService.register("container-1", "file-1", "plot.png");
    const audioUrl = openAIArtifactService.register("container-1", "file-2", "voice.mp3");

    const blocks = await openAIArtifactService.assignOwnershipToContentBlocks(
      [
        { type: "image", url: imageUrl, alt: "plot" },
        { type: "audio", url: audioUrl, mimeType: "audio/mpeg" },
        { type: "text", text: "Done" }
      ],
      {
        ownerId: "owner-a",
        conversationId: "conv-a",
        messageId: "msg-a",
        metadata: { provider: "openai" }
      }
    );

    const imageBlock = blocks[0];
    expect(imageBlock?.type).toBe("image");
    if (!imageBlock || imageBlock.type !== "image") {
      throw new Error("Expected artifact block to remain an image block.");
    }
    expect(imageBlock.metadata).toMatchObject({
      storage: "openai_artifact",
      openAIArtifactId: expect.stringMatching(/^artifact_.+/),
      provider: "openai"
    });

    const audioBlock = blocks[1];
    expect(audioBlock?.type).toBe("audio");
    if (!audioBlock || audioBlock.type !== "audio") {
      throw new Error("Expected artifact block to remain an audio block.");
    }
    expect("metadata" in audioBlock).toBe(false);

    expect(() =>
      llmOutputSchema.parse({
        provider: "openai",
        rawText: "Done",
        content: blocks
      })
    ).not.toThrow();
  });

  it("persists artifact ownership metadata to Postgres when the database is enabled", async () => {
    if (!originalDatabaseUrl) {
      return;
    }

    process.env.DATABASE_URL = originalDatabaseUrl;
    vi.resetModules();
    const { eq } = await import("drizzle-orm");
    const { getDatabase } = await import("../db/client.js");
    const { openAIArtifacts } = await import("../db/schema.js");
    const { openAIArtifactService } = await import("../services/openAIArtifactService.js");

    const db = getDatabase();
    if (!db) {
      throw new Error("Expected DATABASE_URL to create a database client.");
    }

    const url = openAIArtifactService.register("container-db", "file-db", "chart.png", {
      ownerId: "artifact-owner-a",
      metadata: { testRun: "openai-artifact-service" }
    });
    const artifactId = url.split("/").pop();
    if (!artifactId) {
      throw new Error("Expected artifact URL to include an artifact id.");
    }

    try {
      const inserted = await waitFor(
        async () => db.query.openAIArtifacts.findFirst({ where: eq(openAIArtifacts.id, artifactId) }),
        "artifact DB row"
      );

      expect(inserted).toMatchObject({
        id: artifactId,
        ownerId: "artifact-owner-a",
        fileName: "chart.png",
        mimeType: "image/png",
        publicUrl: url
      });
      expect(inserted.metadata).toMatchObject({ testRun: "openai-artifact-service" });

      await openAIArtifactService.assignOwnershipToContentBlocks(
        [{ type: "image", url, alt: "chart" }],
        {
          ownerId: "artifact-owner-b",
          metadata: { provider: "openai-test" }
        }
      );

      const updated = await db.query.openAIArtifacts.findFirst({ where: eq(openAIArtifacts.id, artifactId) });
      expect(updated).toMatchObject({
        id: artifactId,
        ownerId: "artifact-owner-b"
      });
      expect(updated?.metadata).toMatchObject({
        testRun: "openai-artifact-service",
        storage: "openai_artifact",
        openAIArtifactId: artifactId,
        provider: "openai-test"
      });
    } finally {
      await db.delete(openAIArtifacts).where(eq(openAIArtifacts.id, artifactId));
    }
  });
});
