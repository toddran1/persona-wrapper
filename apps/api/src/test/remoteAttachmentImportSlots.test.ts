import { beforeEach, describe, expect, it, vi } from "vitest";

const { findRemoteImport, resolveConnector, saveBuffer } = vi.hoisted(() => ({
  findRemoteImport: vi.fn(),
  resolveConnector: vi.fn(),
  saveBuffer: vi.fn()
}));

vi.mock("../services/uploadService.js", () => ({
  isSupportedUploadMimeType: (mimeType: string) => mimeType === "image/png",
  uploadService: {
    findRemoteImport,
    saveBuffer
  }
}));

vi.mock("../services/authenticatedLinkConnectorService.js", () => ({
  authenticatedLinkConnectorService: { resolve: resolveConnector }
}));

import { RemoteAttachmentImportService } from "../services/remoteAttachmentImportService.js";

const existingAsset = {
  id: "asset_existing",
  kind: "image" as const,
  fileName: "existing.png",
  mimeType: "image/png",
  sizeBytes: 8,
  url: "/api/uploads/asset_existing",
  expiresAt: new Date(Date.now() + 60_000).toISOString()
};

describe("RemoteAttachmentImportService attachment slots", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resolveConnector.mockResolvedValue(undefined);
    saveBuffer.mockResolvedValue({
      ...existingAsset,
      id: "asset_new",
      fileName: "new.png",
      url: "/api/uploads/asset_new"
    });
  });

  it("continues to a new URL when an earlier cached URL is already attached", async () => {
    findRemoteImport
      .mockResolvedValueOnce(existingAsset)
      .mockResolvedValueOnce(undefined);
    const linkResolver = {
      resolve: vi.fn(async () => ({
        originalUrl: "https://cdn.example.com/new.png",
        canonicalUrl: "https://cdn.example.com/new.png",
        kind: "image",
        status: "accessible",
        providerInputUrl: "https://cdn.example.com/new.png",
        resolutionMethod: "classification_only",
        detail: "Accessible image."
      })),
      download: vi.fn(async () => ({
        buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        finalUrl: "https://cdn.example.com/new.png",
        mimeType: "image/png"
      }))
    };

    const imported = await new RemoteAttachmentImportService(linkResolver as never).importFromMessage(
      "owner-1",
      "Compare https://cdn.example.com/existing.png with https://cdn.example.com/new.png",
      [existingAsset]
    );

    expect(findRemoteImport).toHaveBeenCalledTimes(2);
    expect(linkResolver.download).toHaveBeenCalledTimes(1);
    expect(imported.map((asset) => asset.id)).toEqual(["asset_new"]);
  });
});
