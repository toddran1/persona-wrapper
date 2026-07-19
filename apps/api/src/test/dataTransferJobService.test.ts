import JSZip from "jszip";
import { Readable } from "node:stream";
import { describe, expect, it, vi } from "vitest";
import { DataTransferJobService } from "../services/dataTransferJobService.js";

const objects = vi.hoisted(() => new Map<string, Buffer>());
vi.mock("../services/storageService.js", () => ({
  storageService: {
    supportsPresignedUploads: () => false,
    put: async ({ bucket, fileName, buffer }: { bucket: string; fileName: string; buffer: Buffer }) => {
      const storageKey = `${bucket}/${fileName}`;
      objects.set(storageKey, buffer);
      return { storageKey, sizeBytes: buffer.byteLength };
    },
    get: async (storageKey: string) => ({ buffer: objects.get(storageKey)! }),
    putStream: async ({ bucket, fileName, stream }: { bucket: string; fileName: string; stream: Readable }) => {
      const chunks: Buffer[] = [];
      for await (const chunk of stream) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      const buffer = Buffer.concat(chunks);
      const storageKey = `${bucket}/${fileName}`;
      objects.set(storageKey, buffer);
      return { storageKey, sizeBytes: buffer.byteLength };
    },
    getStream: async (storageKey: string) => {
      const buffer = objects.get(storageKey)!;
      return { stream: Readable.from(buffer), sizeBytes: buffer.byteLength };
    },
    head: async (storageKey: string) => ({ sizeBytes: objects.get(storageKey)!.byteLength }),
    delete: async (storageKey: string) => { objects.delete(storageKey); }
  }
}));

describe("DataTransferJobService", () => {
  async function waitForTerminal(service: DataTransferJobService, jobId: string, ownerId: string) {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const job = await service.get(jobId, ownerId);
      if (job && ["completed", "failed", "cancelled"].includes(job.status)) return job;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error("Data transfer did not reach a terminal state.");
  }

  it("builds a downloadable v2 ZIP without duplicating the conversation payload", async () => {
    const service = new DataTransferJobService();
    const started = await service.startExport("user_export_test", { scope: "account" });
    let job = started;
    for (let attempt = 0; attempt < 100 && job.status !== "completed"; attempt += 1) {
      if (job.status === "failed") throw new Error(job.error);
      await new Promise((resolve) => setTimeout(resolve, 10));
      job = (await service.get(started.id, "user_export_test"))!;
    }

    expect(job.status).toBe("completed");
    const archive = await service.download(job.id, "user_export_test");
    const chunks: Buffer[] = [];
    for await (const chunk of archive.stream) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    const zip = await JSZip.loadAsync(Buffer.concat(chunks));
    const manifest = JSON.parse(await zip.file("manifest.json")!.async("text")) as { format: string; version: number };
    expect(manifest).toMatchObject({ format: "for-the-baddiez-export", version: 2 });
    expect(zip.file("account.json")).toBeTruthy();
    expect(zip.file("export.json")).toBeNull();

    await service.cleanupExpiredNow(new Date(Date.now() + 8 * 24 * 60 * 60 * 1000));
    expect(await service.get(job.id, "user_export_test")).toBeUndefined();
  });

  it("reports corrupt ZIP uploads as actionable import errors", async () => {
    const service = new DataTransferJobService();
    const started = await service.startImportBuffer("user_import_test", {
      fileName: "broken.zip",
      mimeType: "application/zip",
      buffer: Buffer.from("this is not a zip")
    });
    const job = await waitForTerminal(service, started.id, "user_import_test");

    expect(job.status).toBe("failed");
    expect(job.error).toBe("Import ZIP is invalid or corrupted.");
    await service.cleanupExpiredNow(new Date(Date.now() + 8 * 24 * 60 * 60 * 1000));
  });

  it("recognizes JSONL before requiring database-backed atomic persistence", async () => {
    const service = new DataTransferJobService();
    const started = await service.startImportBuffer("user_jsonl_test", {
      fileName: "claude.jsonl",
      mimeType: "application/x-ndjson",
      buffer: Buffer.from(JSON.stringify({ name: "Imported", chat_messages: [{ sender: "human", text: "Hello" }] }))
    });
    const job = await waitForTerminal(service, started.id, "user_jsonl_test");

    expect(job.status).toBe("failed");
    expect(job.error).toBe("Atomic imports require database-backed storage.");
    await service.cleanupExpiredNow(new Date(Date.now() + 8 * 24 * 60 * 60 * 1000));
  });
});
