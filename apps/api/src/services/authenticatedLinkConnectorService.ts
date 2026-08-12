import { and, eq } from "drizzle-orm";
import { env } from "../config/env.js";
import { getDatabase } from "../db/client.js";
import { betterAuthAccounts } from "../db/schema.js";
import { logger } from "../utils/logger.js";
import { LinkResolutionService } from "./linkResolutionService.js";

export type ConnectorDownload = {
  status: "download";
  provider: "google_drive" | "dropbox" | "public_url";
  url: string;
  headers?: Record<string, string>;
  fileName?: string;
  mimeType?: string;
};

export type ConnectorAuthorizationRequired = {
  status: "authorization_required";
  provider: "google_drive" | "dropbox" | "social_media";
  detail: string;
};

export type ConnectorResolution = ConnectorDownload | ConnectorAuthorizationRequired;

const GOOGLE_DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.readonly";
const GOOGLE_NATIVE_EXPORTS: Record<string, { mimeType: string; extension: string }> = {
  "application/vnd.google-apps.document": {
    mimeType: "application/pdf",
    extension: "pdf"
  },
  "application/vnd.google-apps.spreadsheet": {
    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    extension: "xlsx"
  },
  "application/vnd.google-apps.presentation": {
    mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    extension: "pptx"
  },
  "application/vnd.google-apps.drawing": {
    mimeType: "application/pdf",
    extension: "pdf"
  }
};

const SOCIAL_HOSTS = new Set([
  "facebook.com", "instagram.com", "linkedin.com", "tiktok.com", "threads.net",
  "twitter.com", "x.com"
]);

function normalizedHost(hostname: string): string {
  return hostname.toLowerCase().replace(/^www\./, "");
}

export function googleDriveFileId(value: string): string | undefined {
  try {
    const url = new URL(value);
    const host = normalizedHost(url.hostname);
    if (host !== "drive.google.com" && host !== "docs.google.com") return undefined;
    const pathMatch = url.pathname.match(/\/(?:file|document|spreadsheets|presentation|drawings)\/d\/([^/?#]+)/);
    const candidate = pathMatch?.[1] ?? url.searchParams.get("id") ?? undefined;
    return candidate && /^[A-Za-z0-9_-]{10,}$/.test(candidate) ? candidate : undefined;
  } catch {
    return undefined;
  }
}

function connectorProvider(value: string): ConnectorAuthorizationRequired["provider"] | undefined {
  try {
    const host = normalizedHost(new URL(value).hostname);
    if (host === "drive.google.com" || host === "docs.google.com") return "google_drive";
    if (host === "dropbox.com" || host.endsWith(".dropbox.com")) return "dropbox";
    if ([...SOCIAL_HOSTS].some((candidate) => host === candidate || host.endsWith(`.${candidate}`))) {
      return "social_media";
    }
  } catch {
    return undefined;
  }
  return undefined;
}

function withExtension(name: string, extension: string): string {
  const clean = name.trim() || "google-drive-file";
  return clean.toLowerCase().endsWith(`.${extension}`) ? clean : `${clean}.${extension}`;
}

export class AuthenticatedLinkConnectorService {
  constructor(
    private readonly linkResolver = new LinkResolutionService(),
    private readonly fetch: typeof globalThis.fetch = globalThis.fetch.bind(globalThis)
  ) {}

  async resolve(ownerId: string, value: string, signal?: AbortSignal): Promise<ConnectorResolution | undefined> {
    const driveId = googleDriveFileId(value);
    if (driveId) return this.resolveGoogleDrive(ownerId, driveId, signal);

    const provider = connectorProvider(value);
    if (provider === "dropbox") {
      const url = new URL(value);
      // Public shared links support a direct-download flag. A private link will
      // still return 401/403 and is reported as requiring a Dropbox connector.
      url.searchParams.set("dl", "1");
      return { status: "download", provider: "dropbox", url: url.toString() };
    }
    if (provider === "social_media") {
      return {
        status: "authorization_required",
        provider,
        detail: "This social-media post is not publicly downloadable. An official account connector or a user-uploaded export is required; browser cookies are never forwarded."
      };
    }
    return undefined;
  }

  private async resolveGoogleDrive(ownerId: string, fileId: string, signal?: AbortSignal): Promise<ConnectorResolution | undefined> {
    if (!env.GOOGLE_DRIVE_LINK_IMPORT_ENABLED) return this.googleAuthorizationRequired();
    const db = getDatabase();
    if (!db) return this.googleAuthorizationRequired();
    const account = await db.query.betterAuthAccounts.findFirst({
      where: and(eq(betterAuthAccounts.userId, ownerId), eq(betterAuthAccounts.providerId, "google"))
    });
    if (!account?.accessToken) return this.googleAuthorizationRequired();

    let accessToken = account.accessToken;
    if (account.accessTokenExpiresAt && account.accessTokenExpiresAt.getTime() <= Date.now() + 30_000) {
      accessToken = await this.refreshGoogleToken(account.id, account.refreshToken, signal) ?? "";
    }
    if (!accessToken) return this.googleAuthorizationRequired();

    try {
      const metadataUrl = new URL(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}`);
      metadataUrl.searchParams.set("fields", "id,name,mimeType,size,modifiedTime");
      metadataUrl.searchParams.set("supportsAllDrives", "true");
      const metadataDownload = await this.linkResolver.download(metadataUrl.toString(), {
        maximumBytes: 1024 * 1024,
        headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
        ...(signal ? { signal } : {})
      });
      const metadata = JSON.parse(metadataDownload.buffer.toString("utf8")) as {
        name?: unknown;
        mimeType?: unknown;
      };
      const name = typeof metadata.name === "string" ? metadata.name : "google-drive-file";
      const mimeType = typeof metadata.mimeType === "string" ? metadata.mimeType : "application/octet-stream";
      const nativeExport = GOOGLE_NATIVE_EXPORTS[mimeType];
      if (nativeExport) {
        const exportUrl = new URL(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}/export`);
        exportUrl.searchParams.set("mimeType", nativeExport.mimeType);
        return {
          status: "download",
          provider: "google_drive",
          url: exportUrl.toString(),
          headers: { Authorization: `Bearer ${accessToken}` },
          fileName: withExtension(name, nativeExport.extension),
          mimeType: nativeExport.mimeType
        };
      }
      const mediaUrl = new URL(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}`);
      mediaUrl.searchParams.set("alt", "media");
      mediaUrl.searchParams.set("supportsAllDrives", "true");
      return {
        status: "download",
        provider: "google_drive",
        url: mediaUrl.toString(),
        headers: { Authorization: `Bearer ${accessToken}` },
        fileName: name,
        mimeType
      };
    } catch (error) {
      signal?.throwIfAborted();
      const statusCode = typeof error === "object" && error !== null && "statusCode" in error
        ? Number(error.statusCode)
        : undefined;
      if (statusCode !== 401 && statusCode !== 403) {
        logger.info("Google Drive link import was temporarily unavailable", {
          ownerId,
          error: error instanceof Error ? error.message : String(error)
        });
        return undefined;
      }
      logger.info("Google Drive link import requires renewed authorization", {
        ownerId,
        error: error instanceof Error ? error.message : String(error)
      });
      return this.googleAuthorizationRequired();
    }
  }

  private async refreshGoogleToken(accountId: string, refreshToken: string | null, signal?: AbortSignal): Promise<string | undefined> {
    if (!refreshToken || !env.GOOGLE_OAUTH_CLIENT_ID || !env.GOOGLE_OAUTH_CLIENT_SECRET) return undefined;
    const timeoutSignal = AbortSignal.timeout(env.API_REQUEST_TIMEOUT_MS);
    const requestSignal = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;
    const response = await this.fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: env.GOOGLE_OAUTH_CLIENT_ID,
        client_secret: env.GOOGLE_OAUTH_CLIENT_SECRET,
        refresh_token: refreshToken,
        grant_type: "refresh_token"
      }),
      signal: requestSignal
    });
    if (!response.ok) return undefined;
    const payload = await response.json() as { access_token?: unknown; expires_in?: unknown };
    if (typeof payload.access_token !== "string") return undefined;
    const expiresIn = typeof payload.expires_in === "number" ? payload.expires_in : 3600;
    const db = getDatabase();
    await db?.update(betterAuthAccounts).set({
      accessToken: payload.access_token,
      accessTokenExpiresAt: new Date(Date.now() + expiresIn * 1000),
      updatedAt: new Date()
    }).where(eq(betterAuthAccounts.id, accountId));
    return payload.access_token;
  }

  private googleAuthorizationRequired(): ConnectorAuthorizationRequired {
    return {
      status: "authorization_required",
      provider: "google_drive",
      detail: `Google Drive access requires reconnecting Google with the ${GOOGLE_DRIVE_SCOPE} permission. The app does not forward browser cookies.`
    };
  }
}

export const authenticatedLinkConnectorService = new AuthenticatedLinkConnectorService();
