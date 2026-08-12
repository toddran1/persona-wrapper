import { describe, expect, it } from "vitest";
import { metadataSafeUrl, RemoteAttachmentImportService } from "../services/remoteAttachmentImportService.js";

describe("remote attachment import metadata", () => {
  it("never persists signed URL credentials or fragments", () => {
    expect(metadataSafeUrl(
      "https://cdn.example.com/private/video.mp4?X-Amz-Credential=secret&token=bearer#section"
    )).toBe("https://cdn.example.com/private/video.mp4");
  });

  it("stops before resolving a remote URL when the request is already cancelled", async () => {
    const controller = new AbortController();
    controller.abort(new Error("Client disconnected."));

    await expect(new RemoteAttachmentImportService().importFromMessage(
      "owner-cancelled-import",
      "Review https://cdn.example.com/private/video.mp4",
      [],
      controller.signal
    )).rejects.toThrow("Client disconnected.");
  });
});
