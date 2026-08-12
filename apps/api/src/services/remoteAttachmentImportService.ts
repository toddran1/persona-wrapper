import { createHash } from "node:crypto";
import { basename, extname } from "node:path";
import { MAX_CHAT_ATTACHMENTS, type UploadedAsset } from "@persona/shared";
import { fileTypeFromBuffer } from "file-type";
import { env } from "../config/env.js";
import { HttpError } from "../utils/httpError.js";
import { logger } from "../utils/logger.js";
import { authenticatedLinkConnectorService, type ConnectorDownload } from "./authenticatedLinkConnectorService.js";
import { LinkResolutionService } from "./linkResolutionService.js";
import { isSupportedUploadMimeType, uploadService } from "./uploadService.js";
import { classifyHttpUrl, extractHttpUrls } from "./urlInputService.js";

const IMPORTABLE_KINDS = new Set(["image", "document", "audio", "video"]);

function fingerprint(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function metadataSafeUrl(value: string): string {
  try {
    const url = new URL(value);
    // Signed download URLs commonly carry credentials in their query string.
    // Keep enough provenance for support without persisting bearer material.
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return "redacted-invalid-url";
  }
}

function contentDispositionFileName(value?: string): string | undefined {
  if (!value) return undefined;
  const encoded = value.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
  if (encoded) {
    try {
      return basename(decodeURIComponent(encoded));
    } catch {
      return undefined;
    }
  }
  const regular = value.match(/filename\s*=\s*"?([^";]+)"?/i)?.[1]?.trim();
  return regular ? basename(regular) : undefined;
}

function urlFileName(value: string): string | undefined {
  try {
    const name = basename(decodeURIComponent(new URL(value).pathname));
    return name && name !== "/" ? name : undefined;
  } catch {
    return undefined;
  }
}

function fallbackExtension(mimeType: string): string {
  const extensions: Record<string, string> = {
    "application/pdf": ".pdf",
    "audio/mpeg": ".mp3",
    "audio/mp4": ".m4a",
    "audio/wav": ".wav",
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
    "video/mp4": ".mp4",
    "video/quicktime": ".mov",
    "video/webm": ".webm"
  };
  return extensions[mimeType] ?? "";
}

function ensureExtension(fileName: string, mimeType: string): string {
  if (extname(fileName)) return fileName;
  return `${fileName}${fallbackExtension(mimeType)}`;
}

export class RemoteAttachmentImportService {
  constructor(private readonly linkResolver = new LinkResolutionService()) {}

  async importFromMessage(
    ownerId: string,
    message: string,
    existingAssets: UploadedAsset[],
    signal?: AbortSignal
  ): Promise<UploadedAsset[]> {
    const remaining = Math.max(0, MAX_CHAT_ATTACHMENTS - existingAssets.length);
    if (remaining === 0) return [];
    const imported: UploadedAsset[] = [];
    const existingIds = new Set(existingAssets.map((asset) => asset.id));

    // Inspect at most one request's supported attachment count, but do not
    // pre-slice to `remaining`: a cached asset that is already attached must
    // not consume a candidate slot and prevent a later new URL from importing.
    for (const originalUrl of extractHttpUrls(message).slice(0, MAX_CHAT_ATTACHMENTS)) {
      if (imported.length >= remaining) break;
      signal?.throwIfAborted();
      const sourceFingerprint = fingerprint(new URL(originalUrl).toString());
      const cached = await uploadService.findRemoteImport(ownerId, sourceFingerprint);
      if (cached) {
        if (!existingIds.has(cached.id)) {
          imported.push(cached);
          existingIds.add(cached.id);
        }
        continue;
      }

      const connector = await authenticatedLinkConnectorService.resolve(ownerId, originalUrl, signal);
      if (connector?.status === "authorization_required") {
        logger.info("Remote link import requires an official connector", {
          ownerId,
          provider: connector.provider,
          sourceHost: new URL(originalUrl).hostname
        });
        continue;
      }

      const resolution = connector?.status === "download"
        ? connector
        : await this.publicDownload(originalUrl, signal);
      if (!resolution) continue;

      try {
        const downloaded = await this.linkResolver.download(resolution.url, {
          maximumBytes: env.UPLOAD_MAX_BYTES,
          ...(resolution.headers ? { headers: resolution.headers } : {}),
          ...(signal ? { signal } : {})
        });
        const detected = await fileTypeFromBuffer(downloaded.buffer);
        const reportedMimeType = resolution.mimeType && resolution.mimeType !== "application/octet-stream"
          ? resolution.mimeType
          : downloaded.mimeType && downloaded.mimeType !== "application/octet-stream"
            ? downloaded.mimeType
            : undefined;
        // CDNs frequently label downloads as application/octet-stream or
        // application/download. Prefer a supported signature when one is
        // available; UploadService validates it again before persistence.
        const mimeType = detected?.mime && isSupportedUploadMimeType(detected.mime)
          ? detected.mime
          : reportedMimeType;
        if (!mimeType || mimeType.startsWith("text/html")) {
          throw new HttpError("The linked resource did not return a supported file.", 415);
        }
        const fileName = ensureExtension(
          resolution.fileName
            ?? contentDispositionFileName(downloaded.contentDisposition)
            ?? urlFileName(downloaded.finalUrl)
            ?? `linked-file-${sourceFingerprint.slice(0, 8)}`,
          mimeType
        );
        const asset = await uploadService.saveBuffer(ownerId, {
          fileName,
          mimeType,
          buffer: downloaded.buffer,
          metadata: {
            uploadStatus: "ready",
            remoteSourceFingerprint: sourceFingerprint,
            remoteSourceUrl: metadataSafeUrl(originalUrl),
            remoteFinalUrl: metadataSafeUrl(downloaded.finalUrl),
            ...(downloaded.etag ? { remoteEtag: downloaded.etag } : {}),
            importedAt: new Date().toISOString()
          }
        });
        imported.push(asset);
        existingIds.add(asset.id);
      } catch (error) {
        if (error instanceof HttpError && (error.statusCode === 413 || error.statusCode === 415)) throw error;
        logger.info("Remote file could not be imported", {
          ownerId,
          sourceHost: new URL(originalUrl).hostname,
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }
    return imported;
  }

  private async publicDownload(value: string, signal?: AbortSignal): Promise<ConnectorDownload | undefined> {
    const classified = classifyHttpUrl(value);
    if (classified === "youtube_video" || classified === "web_page") {
      const resolved = await this.linkResolver.resolve(value, signal);
      if (resolved.status !== "accessible" || !IMPORTABLE_KINDS.has(resolved.kind)) return undefined;
      return {
        status: "download",
        provider: "public_url",
        url: resolved.providerInputUrl ?? resolved.canonicalUrl,
        ...(resolved.mimeType ? { mimeType: resolved.mimeType } : {})
      };
    }
    return { status: "download", provider: "public_url", url: value };
  }
}

export const remoteAttachmentImportService = new RemoteAttachmentImportService();
