import Constants from "expo-constants";
import * as AppleAuthentication from "expo-apple-authentication";
import * as Crypto from "expo-crypto";
import * as FileSystem from "expo-file-system/legacy";
import { Platform } from "react-native";
import { APPLE_NATIVE_AUTHORIZATION_CODE_PREFIX, apiContract, MAX_CHAT_ATTACHMENTS, MAX_OPENAI_IMAGE_EDIT_BYTES } from "@persona/shared";
import { initClient } from "@ts-rest/core";
import type {
  ActiveSession,
  AuthUser,
  AuthSession,
  AccountDeletionResponse,
  ChatJobResponse,
  ChatResponse,
  ClientContext,
  ConnectedAccount,
  ConversationDetail,
  ConversationListPage,
  ConversationSummary,
  ConversationTurnsPage,
  DataImportResult,
  DataTransferJob,
  ForTheBaddiezArchive,
  LoginRequest,
  MeResponse,
  OAuthProvider,
  OAuthProviderStatus,
  CurrentPoliciesResponse,
  PolicyVersions,
  BillingCatalogResponse,
  PlanUsageSummary,
  PersonaDefinition,
  PersonaSummary,
  ProviderId,
  RegisterRequest,
  RevokeOtherSessionsResponse,
  RestoreAccountRequest,
  ToolOptions,
  UpdateUserProfileRequest,
  UploadedAsset
} from "@persona/shared";
import { getOwnerId } from "../storage/secureTokens";
import { authClient, MOBILE_AUTH_CALLBACK_URL } from "./authClient";

const configuredApiUrl = process.env.EXPO_PUBLIC_API_URL || Constants.expoConfig?.extra?.apiUrl;
export const API_BASE_URL = String(configuredApiUrl || "http://localhost:4000").replace(/\/$/, "");

export type MobileChatPayload = {
  personaId: string;
  message: string;
  provider: ProviderId;
  audio: boolean;
  testMode?: boolean;
  conversationId?: string;
  retryAssistantMessageId?: string;
  clientContext?: ClientContext;
  attachments?: UploadedAsset[];
  toolOptions?: ToolOptions;
};

export type MobileUploadFile = {
  uri: string;
  name: string;
  mimeType: string;
  sizeBytes?: number;
};

type PreparedMobileUploadFile = MobileUploadFile & { blob: Blob };

type MobileRegisterRequest = Omit<RegisterRequest, "clientType" | "deviceId">;
type MobileLoginRequest = Omit<LoginRequest, "clientType" | "deviceId">;
type MobileRestoreAccountRequest = Omit<RestoreAccountRequest, "clientType" | "deviceId">;
type ApiErrorPayload = {
  error?: string;
  message?: string;
  code?: string;
};

function isInternalErrorDetail(message: string): boolean {
  return /failed query|params:|drizzle|postgres|syntax error|violates|duplicate key|relation .* does not exist|insert into|select .* from/i.test(message);
}

function safeApiErrorMessage(message: string | undefined, fallback: string): string {
  return message && !isInternalErrorDetail(message) ? message : fallback;
}

function contractError(body: unknown, fallback: string): Error {
  const message = typeof body === "object" && body !== null && "error" in body && typeof body.error === "string"
    ? body.error
    : undefined;
  return new Error(safeApiErrorMessage(message, fallback));
}

class ApiResponseError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
    this.name = "ApiResponseError";
  }
}

export class SessionCheckError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
    this.name = "SessionCheckError";
  }
}

// better-fetch reports network failures (airplane mode, DNS, captive portal)
// with status 0; only an explicit 401 means the session is truly gone.
export function isUnauthenticatedSessionError(error: unknown): boolean {
  return error instanceof SessionCheckError && error.status === 401;
}

function isServerResponseError(error: unknown): boolean {
  return error instanceof ApiResponseError || (
    error instanceof Error && error.message.startsWith("The app server returned an invalid")
  );
}

let authRefreshInFlight: Promise<boolean> | undefined;
const DEFAULT_REQUEST_TIMEOUT_MS = 20_000;
const UPLOAD_REQUEST_TIMEOUT_MS = 10 * 60_000;
const CHAT_REQUEST_TIMEOUT_MS = 130_000;
const DATA_TRANSFER_POLL_TIMEOUT_MS = 2 * 60 * 60 * 1000 + 5 * 60 * 1000;
const DATA_TRANSFER_UPLOAD_TIMEOUT_MS = 4 * 60 * 60 * 1000;

const IMAGE_MIME_TYPES_BY_EXTENSION: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif"
};

type RequestTimeout = {
  signal: AbortSignal;
  didTimeout: () => boolean;
  dispose: () => void;
};

function createRequestTimeout(externalSignal: AbortSignal | null | undefined, timeoutMs: number): RequestTimeout {
  const controller = new AbortController();
  let timedOut = false;
  const abortFromCaller = () => controller.abort(externalSignal?.reason);
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  if (externalSignal) {
    if (externalSignal.aborted) abortFromCaller();
    else externalSignal.addEventListener("abort", abortFromCaller, { once: true });
  }

  return {
    signal: controller.signal,
    didTimeout: () => timedOut,
    dispose: () => {
      clearTimeout(timer);
      externalSignal?.removeEventListener("abort", abortFromCaller);
    }
  };
}

function contractTimeoutMs(path: string, method: string): number {
  try {
    const pathname = new URL(path, API_BASE_URL).pathname;
    if (method.toUpperCase() === "POST" && pathname === "/api/chat") return CHAT_REQUEST_TIMEOUT_MS;
    if (pathname.startsWith("/api/data/") || pathname.includes("/complete")) return UPLOAD_REQUEST_TIMEOUT_MS;
  } catch {
    // Use the conservative default for malformed paths; fetch will report the
    // actionable URL error.
  }
  return DEFAULT_REQUEST_TIMEOUT_MS;
}

async function parseApiError(response: Response): Promise<ApiResponseError> {
  try {
    const payload = await response.json() as ApiErrorPayload;
    if (response.status >= 500 || payload.code === "INTERNAL_SERVER_ERROR") {
      return new ApiResponseError(response.status, "Something went wrong on the server. Please try again.");
    }
    const fallback = `Request failed with status ${response.status}.`;
    return new ApiResponseError(response.status, safeApiErrorMessage(payload.error || payload.message, fallback));
  } catch {
    return new ApiResponseError(response.status, `Request failed with status ${response.status}.`);
  }
}

function validateUploadFiles(files: MobileUploadFile[]): void {
  if (files.length === 0) throw new Error("Select at least one file to upload.");
  if (files.length > MAX_CHAT_ATTACHMENTS) {
    throw new Error(`You can attach up to ${MAX_CHAT_ATTACHMENTS} files to one message.`);
  }
  const oversized = files.find((file) => file.sizeBytes !== undefined && file.sizeBytes > MAX_OPENAI_IMAGE_EDIT_BYTES);
  if (oversized) {
    throw new Error(`${oversized.name} is too large. Each attachment must be smaller than 50 MB.`);
  }
}

async function parseContractResponseBody(response: Response): Promise<unknown> {
  if (response.status === 204) return undefined;
  const contentType = response.headers.get("content-type") ?? "";
  const body = await response.text();
  if (!contentType.includes("application/json")) return body;
  if (!body.trim()) {
    if (response.ok) throw new Error("The app server returned an invalid response. Please try again.");
    return undefined;
  }
  try {
    return JSON.parse(body) as unknown;
  } catch {
    if (response.ok) throw new Error("The app server returned an invalid response. Please try again.");
    return undefined;
  }
}

function imageMimeTypeFromHeader(header: Uint8Array): string | undefined {
  if (header.length >= 3 && header[0] === 0xff && header[1] === 0xd8 && header[2] === 0xff) {
    return "image/jpeg";
  }
  if (header.length >= 8 && header[0] === 0x89 && header[1] === 0x50 && header[2] === 0x4e && header[3] === 0x47 &&
    header[4] === 0x0d && header[5] === 0x0a && header[6] === 0x1a && header[7] === 0x0a) {
    return "image/png";
  }
  if (header.length >= 6 && header[0] === 0x47 && header[1] === 0x49 && header[2] === 0x46 && header[3] === 0x38 &&
    (header[4] === 0x37 || header[4] === 0x39) && header[5] === 0x61) {
    return "image/gif";
  }
  if (header.length >= 12 && header[0] === 0x52 && header[1] === 0x49 && header[2] === 0x46 && header[3] === 0x46 &&
    header[8] === 0x57 && header[9] === 0x45 && header[10] === 0x42 && header[11] === 0x50) {
    return "image/webp";
  }
  return undefined;
}

function base64HeaderToBytes(value: string): Uint8Array {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  const bytes: number[] = [];
  let accumulator = 0;
  let bitCount = 0;
  for (const character of value) {
    if (character === "=") break;
    const index = alphabet.indexOf(character);
    if (index < 0) continue;
    accumulator = (accumulator << 6) | index;
    bitCount += 6;
    if (bitCount >= 8) {
      bitCount -= 8;
      bytes.push((accumulator >> bitCount) & 0xff);
    }
  }
  return new Uint8Array(bytes);
}

async function imageMimeTypeFromFileUri(uri: string): Promise<string | undefined> {
  try {
    const base64Header = await FileSystem.readAsStringAsync(uri, {
      encoding: FileSystem.EncodingType.Base64,
      position: 0,
      length: 12
    });
    return imageMimeTypeFromHeader(base64HeaderToBytes(base64Header));
  } catch {
    // The API verifies the full file independently. A URI that cannot expose
    // its header here can still be uploaded through the normal path.
    return undefined;
  }
}

function normalizedImageFileName(fileName: string, mimeType: string): string {
  const extension = IMAGE_MIME_TYPES_BY_EXTENSION[mimeType];
  if (!extension) return fileName;
  const extensionIndex = fileName.lastIndexOf(".");
  const stem = extensionIndex > 0 ? fileName.slice(0, extensionIndex) : fileName;
  return `${stem || "image"}.${extension}`;
}

async function prepareMobileUploadFile(
  file: MobileUploadFile,
  signal?: AbortSignal
): Promise<PreparedMobileUploadFile> {
  const sourceTimeout = createRequestTimeout(signal, UPLOAD_REQUEST_TIMEOUT_MS);
  try {
    const source = await fetch(file.uri, { signal: sourceTimeout.signal });
    if (!source.ok) throw new Error("Could not read the selected file.");
    const blob = await source.blob();
    if (blob.size > MAX_OPENAI_IMAGE_EDIT_BYTES) {
      throw new Error(`${file.name} is too large. Each attachment must be smaller than 50 MB.`);
    }

    const detectedImageMimeType = await imageMimeTypeFromFileUri(file.uri);
    if (!detectedImageMimeType || detectedImageMimeType === file.mimeType) {
      return { ...file, sizeBytes: blob.size, blob };
    }

    return {
      ...file,
      name: normalizedImageFileName(file.name, detectedImageMimeType),
      mimeType: detectedImageMimeType,
      sizeBytes: blob.size,
      blob
    };
  } catch (error) {
    if (sourceTimeout.didTimeout()) {
      throw new Error(`Reading ${file.name} took too long. Choose the file again and retry.`);
    }
    rethrowAbort(error);
    throw error;
  } finally {
    sourceTimeout.dispose();
  }
}

function clientType(): "ios" | "android" | "unknown" {
  if (Platform.OS === "ios") return "ios";
  if (Platform.OS === "android") return "android";
  return "unknown";
}

async function requestHeaders(includeJson: boolean, headers?: HeadersInit): Promise<Record<string, string>> {
  const installationId = await getOwnerId();
  const next: Record<string, string> = {
    "x-client-type": clientType(),
    "x-device-id": installationId
  };
  if (includeJson) next["Content-Type"] = "application/json";
  const cookie = authClient.getCookie();
  if (cookie) next.Cookie = cookie;
  next["x-owner-id"] = installationId;
  return { ...next, ...(headers as Record<string, string> | undefined ?? {}) };
}

const contractClient = initClient(apiContract, {
  baseUrl: API_BASE_URL,
  baseHeaders: {},
  api: async ({ path, method, headers, body, fetchOptions }) => {
    const timeout = createRequestTimeout(fetchOptions?.signal, contractTimeoutMs(path, method));
    try {
      const requestInit = {
        ...fetchOptions,
        method,
        headers: await requestHeaders(false, headers),
        signal: timeout.signal,
        ...(body !== undefined ? { body } : {})
      };
      let response = await fetch(path, requestInit);
      if (response.status === 401 && await refreshStoredAuth()) {
        response = await fetch(path, { ...requestInit, headers: await requestHeaders(false, headers) });
      }
      const responseBody = await parseContractResponseBody(response);
      return { status: response.status, body: responseBody, headers: response.headers };
    } catch (error) {
      if (timeout.didTimeout()) throw new Error("The app server took too long to respond. Please try again.");
      throw error;
    } finally {
      timeout.dispose();
    }
  }
});

async function performStoredAuthRefresh(): Promise<boolean> {
  try {
    return Boolean((await authClient.getSession()).data);
  } catch {
    return false;
  }
}

function authError(error: { message?: string | undefined } | null): Error {
  return new Error(error?.message || "Authentication failed. Please try again.");
}

function oauthProviderLabel(provider: OAuthProvider): string {
  if (provider === "google") return "Google";
  if (provider === "facebook") return "Facebook";
  return "Apple";
}

function mobileOAuthErrorCallbackURL(provider: OAuthProvider, action: "link" | "sign-in"): string {
  const params = new URLSearchParams({ oauthProvider: provider, oauthAction: action });
  return `${MOBILE_AUTH_CALLBACK_URL}?${params.toString()}`;
}

type NativeAppleIdToken = {
  token: string;
  nonce: string;
  authorizationCode: string;
  user?: {
    name?: { firstName?: string; lastName?: string };
    email?: string;
  };
};

function appleAuthenticationWasCancelled(error: unknown): boolean {
  return typeof error === "object"
    && error !== null
    && "code" in error
    && error.code === "ERR_REQUEST_CANCELED";
}

async function requestNativeAppleIdToken(action: "link" | "sign-in"): Promise<NativeAppleIdToken | undefined> {
  if (Platform.OS !== "ios") return undefined;
  try {
    if (!(await AppleAuthentication.isAvailableAsync())) return undefined;
  } catch {
    // A non-native runtime such as an unsupported development client can still
    // complete Apple authentication through the existing Services ID flow.
    return undefined;
  }

  try {
    const nonce = Crypto.randomUUID();
    const credential = await AppleAuthentication.signInAsync({
      nonce,
      requestedScopes: [
        AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
        AppleAuthentication.AppleAuthenticationScope.EMAIL
      ]
    });
    if (!credential.identityToken || !credential.authorizationCode) {
      throw new Error("Apple did not return complete authorization credentials. Please try again.");
    }

    const firstName = credential.fullName?.givenName?.trim() || undefined;
    const lastName = credential.fullName?.familyName?.trim() || undefined;
    const email = credential.email?.trim() || undefined;
    const name = firstName || lastName
      ? { ...(firstName ? { firstName } : {}), ...(lastName ? { lastName } : {}) }
      : undefined;
    const user = name || email
      ? { ...(name ? { name } : {}), ...(email ? { email } : {}) }
      : undefined;

    return {
      token: credential.identityToken,
      nonce,
      authorizationCode: credential.authorizationCode,
      ...(user ? { user } : {})
    };
  } catch (error) {
    if (appleAuthenticationWasCancelled(error)) {
      throw new Error(`Apple ${action === "link" ? "connection" : "sign-in"} was cancelled.`);
    }
    if (error instanceof Error && error.message.startsWith("Apple did not return")) throw error;
    throw new Error(`Apple ${action === "link" ? "could not be connected" : "sign-in could not be completed"}. Please try again.`);
  }
}

function toAuthUser(user: Record<string, unknown>): AuthUser {
  const email = typeof user.email === "string" && !user.email.endsWith("@users.invalid") ? user.email : null;
  return {
    id: String(user.id),
    email,
    emailVerified: typeof user.emailVerified === "boolean" ? user.emailVerified : false,
    role: user.role === "admin" ? "admin" : "user",
    username: typeof user.displayUsername === "string"
      ? user.displayUsername
      : typeof user.username === "string"
        ? user.username
        : null,
    displayName: typeof user.name === "string" ? user.name : null,
    avatarUrl: typeof user.image === "string" ? user.image : null,
    preferredName: typeof user.preferredName === "string" ? user.preferredName : null,
    gender: user.gender === "male" || user.gender === "female" || user.gender === "nonbinary" || user.gender === "other"
      ? user.gender
      : null,
    birthday: typeof user.birthMonth === "number" && typeof user.birthDay === "number"
      ? { month: user.birthMonth, day: user.birthDay }
      : null,
    memoryEnabled: typeof user.memoryEnabled === "boolean" ? user.memoryEnabled : true,
    conciseAudioResponses: typeof user.conciseAudioResponses === "boolean" ? user.conciseAudioResponses : true,
    modelProvider: user.modelProvider === "gemini" ? "gemini" : "openai",
    imageProvider: user.imageProvider === "flux" ? "flux" : "openai",
    personaInfluenceLevel: user.personaInfluenceLevel === undefined || user.personaInfluenceLevel === null
      ? "uncensored"
      : user.personaInfluenceLevel === "uncensored"
        ? "uncensored"
        : "professional",
    termsVersionAccepted: typeof user.termsVersionAccepted === "string" ? user.termsVersionAccepted : null,
    termsAcceptedAt: user.termsAcceptedAt ? new Date(user.termsAcceptedAt as string | Date).toISOString() : null,
    privacyVersionAccepted: typeof user.privacyVersionAccepted === "string" ? user.privacyVersionAccepted : null,
    privacyAcceptedAt: user.privacyAcceptedAt ? new Date(user.privacyAcceptedAt as string | Date).toISOString() : null,
    status: typeof user.status === "string" ? user.status : "active",
    deletionRequestedAt: user.deletionRequestedAt ? new Date(user.deletionRequestedAt as string | Date).toISOString() : null,
    deletionScheduledFor: user.deletionScheduledFor ? new Date(user.deletionScheduledFor as string | Date).toISOString() : null,
    createdAt: new Date(user.createdAt as string | Date).toISOString(),
    updatedAt: new Date(user.updatedAt as string | Date).toISOString()
  };
}

async function requirePersistedAuthUser(): Promise<AuthUser> {
  const session = await authClient.getSession();
  if (session.error || !session.data?.user) {
    throw new Error(
      "Sign-in succeeded, but this device did not retain the session. Please try again."
    );
  }
  return toAuthUser(session.data.user as unknown as Record<string, unknown>);
}

function toAuthSession(session: Record<string, unknown>): AuthSession {
  const value = session.clientType;
  const sessionClientType = value === "web" || value === "desktop" || value === "ios" || value === "android" ? value : "unknown";
  return {
    id: String(session.id),
    userId: String(session.userId),
    clientType: sessionClientType,
    expiresAt: new Date(session.expiresAt as string | Date).toISOString(),
    createdAt: new Date(session.createdAt as string | Date).toISOString(),
    updatedAt: new Date(session.updatedAt as string | Date).toISOString(),
    userAgent: typeof session.userAgent === "string" ? session.userAgent : null,
    ipAddress: typeof session.ipAddress === "string" ? session.ipAddress : null
  };
}

async function refreshStoredAuth(): Promise<boolean> {
  authRefreshInFlight ??= performStoredAuthRefresh().finally(() => {
    authRefreshInFlight = undefined;
  });
  return authRefreshInFlight;
}

function rethrowAbort(error: unknown): void {
  if (error instanceof Error && error.name === "AbortError") throw error;
}

class DirectStorageUploadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DirectStorageUploadError";
  }
}

async function directUploadError(response: Pick<Response, "headers" | "text">, fallback: string): Promise<Error> {
  const requestId = response.headers.get("x-amz-request-id") ?? response.headers.get("x-amz-id-2");
  let code: string | undefined;
  try {
    const body = await response.text();
    code = body.match(/<Code>([^<]+)<\/Code>/)?.[1];
  } catch {
    // The HTTP status below is still enough to identify the failing storage request.
  }
  const suffix = [code, requestId ? `request ${requestId}` : undefined].filter(Boolean).join(", ");
  if (code === "AccessDenied") {
    return new DirectStorageUploadError(`Uploads are temporarily unavailable because the storage bucket does not allow uploads.${requestId ? ` (request ${requestId})` : ""}`);
  }
  return new DirectStorageUploadError(`${fallback}${suffix ? ` (${suffix})` : ""}`);
}

export const api = {
  resolveUrl: (pathOrUrl: string): string => pathOrUrl.startsWith("/") ? `${API_BASE_URL}${pathOrUrl}` : pathOrUrl,
  isProtectedMediaUrl: (pathOrUrl: string): boolean => {
    if (pathOrUrl.startsWith("/api/")) return true;
    try {
      const candidate = new URL(pathOrUrl);
      const apiBase = new URL(API_BASE_URL);
      return candidate.origin === apiBase.origin && candidate.pathname.startsWith("/api/");
    } catch {
      return false;
    }
  },
  mediaHeaders: (): Promise<Record<string, string>> => requestHeaders(false),
  uploadFiles: async (
    files: MobileUploadFile[],
    options?: { skipAuthRefresh?: boolean; signal?: AbortSignal }
  ): Promise<UploadedAsset[]> => {
    validateUploadFiles(files);
    const preparedFiles = await Promise.all(files.map((file) => prepareMobileUploadFile(file, options?.signal)));
    const issuedAssetIds: string[] = [];
    try {
      const assets: UploadedAsset[] = [];
      for (const file of preparedFiles) {
        const presigned = await contractClient.uploads.presign({
          body: { fileName: file.name, mimeType: file.mimeType, sizeBytes: file.blob.size },
          ...(options?.signal ? { fetchOptions: { signal: options.signal } } : {})
        });
        if (presigned.status === 409) throw new Error("DIRECT_UPLOAD_UNAVAILABLE");
        if (presigned.status !== 201) throw contractError(presigned.body, "Could not prepare this upload.");
        issuedAssetIds.push(presigned.body.assetId);
        const uploadTimeout = createRequestTimeout(options?.signal, UPLOAD_REQUEST_TIMEOUT_MS);
        try {
          const uploaded = await fetch(presigned.body.uploadUrl, {
            method: "PUT",
            headers: presigned.body.headers,
            body: file.blob,
            signal: uploadTimeout.signal
          });
          if (!uploaded.ok) throw await directUploadError(uploaded, "The storage service rejected this upload.");
        } catch (error) {
          if (uploadTimeout.didTimeout()) {
            throw new Error(`Uploading ${file.name} took too long. Check your connection and try again.`);
          }
          rethrowAbort(error);
          throw error;
        } finally {
          uploadTimeout.dispose();
        }
        const completed = await contractClient.uploads.complete({
          params: { id: presigned.body.assetId },
          ...(options?.signal ? { fetchOptions: { signal: options.signal } } : {})
        });
        if (completed.status !== 200) throw contractError(completed.body, "The app server could not finish this upload.");
        assets.push(completed.body.asset);
      }
      return assets;
    } catch (error) {
      await Promise.allSettled(issuedAssetIds.map((id) => contractClient.uploads.remove({ params: { id } })));
      rethrowAbort(error);
      const canUseApiFallback = error instanceof DirectStorageUploadError
        || (error instanceof Error && error.message === "DIRECT_UPLOAD_UNAVAILABLE" && issuedAssetIds.length === 0);
      if (!canUseApiFallback) throw error;
    }

    const fallbackAssets: UploadedAsset[] = [];
    try {
      let authRefreshUsed = options?.skipAuthRefresh === true;
      for (const file of preparedFiles) {
        let uploaded = false;
        for (let attempt = 0; attempt < 2 && !uploaded; attempt += 1) {
          const body = new FormData();
          body.append("files", {
            uri: file.uri,
            name: file.name,
            type: file.mimeType
          } as unknown as Blob);
          const timeout = createRequestTimeout(options?.signal, UPLOAD_REQUEST_TIMEOUT_MS);
          try {
            const response = await fetch(`${API_BASE_URL}/api/uploads`, {
              method: "POST",
              headers: await requestHeaders(false),
              body,
              signal: timeout.signal
            });
            if (response.status === 401 && !authRefreshUsed && await refreshStoredAuth()) {
              authRefreshUsed = true;
              continue;
            }
            if (!response.ok) throw await parseApiError(response);
            let payload: { assets?: UploadedAsset[] };
            try {
              payload = await response.json() as { assets?: UploadedAsset[] };
            } catch {
              throw new Error("The app server returned an invalid upload response. Please try again.");
            }
            if (!Array.isArray(payload.assets) || payload.assets.length !== 1) {
              throw new Error("The app server returned an invalid upload response. Please try again.");
            }
            fallbackAssets.push(payload.assets[0]!);
            uploaded = true;
          } catch (error) {
            if (timeout.didTimeout()) {
              throw new Error("The upload took too long to finish. Check your connection and try again.");
            }
            rethrowAbort(error);
            if (isServerResponseError(error)) throw error;
            throw new Error(`Could not connect to the app server at ${API_BASE_URL}.`);
          } finally {
            timeout.dispose();
          }
        }
        if (!uploaded) throw new Error("Could not upload files to the app server.");
      }
      return fallbackAssets;
    } catch (error) {
      await Promise.allSettled(fallbackAssets.map((asset) => contractClient.uploads.remove({ params: { id: asset.id } })));
      throw error;
    }
  },
  register: async (payload: MobileRegisterRequest): Promise<{ user: AuthUser }> => {
    const installationId = await getOwnerId();
    const email = payload.email.trim().toLowerCase();
    const username = payload.username?.trim();
    const signUpPayload = {
      email,
      password: payload.password,
      name: username || email,
      ...(username ? { username: username.toLowerCase(), displayUsername: username } : {}),
      termsVersionAccepted: payload.policyConsent.termsVersion,
      privacyVersionAccepted: payload.policyConsent.privacyVersion,
      fetchOptions: {
        headers: {
          "x-device-id": installationId,
          "x-owner-id": installationId
        }
      }
    } as Parameters<typeof authClient.signUp.email>[0] & {
      termsVersionAccepted: string;
      privacyVersionAccepted: string;
    };
    const result = await authClient.signUp.email(signUpPayload);
    if (result.error || !result.data?.user) throw authError(result.error);
    return { user: await requirePersistedAuthUser() };
  },
  login: async (payload: MobileLoginRequest): Promise<{ user: AuthUser }> => {
    const installationId = await getOwnerId();
    const identifier = payload.identifier.trim().toLowerCase();
    const result = identifier.includes("@")
      ? await authClient.signIn.email({
          email: identifier,
          password: payload.password,
          fetchOptions: { headers: { "x-device-id": installationId, "x-owner-id": installationId } }
        })
      : await authClient.signIn.username({
          username: identifier,
          password: payload.password,
          fetchOptions: { headers: { "x-device-id": installationId, "x-owner-id": installationId } }
        });
    if (result.error || !result.data?.user) throw authError(result.error);
    return { user: await requirePersistedAuthUser() };
  },
  restoreAccount: async (payload: MobileRestoreAccountRequest): Promise<{ user: AuthUser }> => {
    const response = await contractClient.account.restore({ body: { ...payload, clientType: clientType() } });
    if (response.status !== 200) throw contractError(response.body, "Could not restore this account.");
    return api.login(payload);
  },
  deleteAccount: async (payload: { confirmation: "DELETE"; password?: string }): Promise<AccountDeletionResponse> => {
    const response = await contractClient.account.remove({ body: payload });
    if (response.status !== 202) throw contractError(response.body, "Could not delete this account.");
    await authClient.signOut();
    return response.body;
  },
  logout: async (): Promise<void> => {
    const result = await authClient.signOut();
    if (result.error) throw authError(result.error);
  },
  getCurrentUser: async (): Promise<MeResponse> => {
    const result = await authClient.getSession();
    if (result.error || !result.data?.user) {
      const errorStatus = (result.error as { status?: unknown } | null)?.status;
      const status = typeof errorStatus === "number" ? errorStatus : result.error ? 0 : 401;
      throw new SessionCheckError(status, result.error?.message || "Not authenticated.");
    }
    return {
      user: toAuthUser(result.data.user as unknown as Record<string, unknown>),
      session: toAuthSession(result.data.session as unknown as Record<string, unknown>)
    };
  },
  getCurrentPolicies: async (): Promise<CurrentPoliciesResponse> => {
    const response = await contractClient.account.currentPolicies({});
    if (response.status !== 200) throw contractError(response.body, "Could not load the current policies.");
    return response.body;
  },
  acceptPolicies: async (versions: PolicyVersions): Promise<AuthUser> => {
    const response = await contractClient.account.acceptPolicies({ body: versions });
    if (response.status !== 200) throw contractError(response.body, "Could not save your policy acceptance.");
    return response.body.user;
  },
  getPlanUsage: async (): Promise<PlanUsageSummary> => {
    const response = await contractClient.account.usage({});
    if (response.status !== 200) throw contractError(response.body, "Could not load plan usage.");
    return response.body;
  },
  getBillingCatalog: async (): Promise<BillingCatalogResponse> => {
    const response = await contractClient.account.billingCatalog({});
    if (response.status !== 200) throw contractError(response.body, "Could not load subscription options.");
    return response.body;
  },
  updateProfile: async (payload: UpdateUserProfileRequest): Promise<AuthUser> => {
    const response = await contractClient.account.updateProfile({ body: payload });
    if (response.status !== 200) throw contractError(response.body, "Could not update your profile.");
    return response.body.user;
  },
  getMemorySettings: async (): Promise<boolean> => {
    const response = await contractClient.account.getMemorySettings({});
    if (response.status !== 200) throw contractError(response.body, "Could not load memory settings.");
    return response.body.enabled;
  },
  updateMemorySettings: async (enabled: boolean): Promise<boolean> => {
    const response = await contractClient.account.updateMemorySettings({ body: { enabled } });
    if (response.status !== 200) throw contractError(response.body, "Could not update memory settings.");
    return response.body.enabled;
  },
  clearAllMemory: async (): Promise<void> => {
    const response = await contractClient.account.clearMemory({});
    if (response.status !== 204) throw contractError(response.body, "Could not clear memory.");
  },
  clearConversationMemory: async (conversationId: string): Promise<void> => {
    const response = await contractClient.conversations.clearMemory({ params: { conversationId } });
    if (response.status !== 204) throw contractError(response.body, "Could not forget this chat.");
  },
  listActiveSessions: async (): Promise<ActiveSession[]> => {
    const [sessionsResult, currentResult] = await Promise.all([authClient.listSessions(), authClient.getSession()]);
    if (sessionsResult.error) throw authError(sessionsResult.error);
    if (currentResult.error) throw authError(currentResult.error);
    return (sessionsResult.data ?? []).map((value) => {
      const session = value as unknown as Record<string, unknown>;
      return {
        id: String(session.token),
        clientType: "unknown",
        deviceId: null,
        userAgent: typeof session.userAgent === "string" ? session.userAgent : null,
        createdAt: new Date(session.createdAt as string | Date).toISOString(),
        lastActiveAt: new Date(session.updatedAt as string | Date).toISOString(),
        refreshExpiresAt: new Date(session.expiresAt as string | Date).toISOString(),
        current: session.id === currentResult.data?.session.id
      };
    });
  },
  revokeActiveSession: async (sessionToken: string): Promise<void> => {
    const result = await authClient.revokeSession({ token: sessionToken });
    if (result.error) throw authError(result.error);
  },
  revokeOtherSessions: async (): Promise<RevokeOtherSessionsResponse> => {
    const result = await authClient.revokeOtherSessions();
    if (result.error) throw authError(result.error);
    return { revoked: 0 };
  },
  getOAuthProviders: async (): Promise<OAuthProviderStatus[]> => {
    const response = await contractClient.account.oauthProviders();
    if (response.status !== 200) throw contractError(response.body, "Could not load sign-in providers.");
    return response.body.providers;
  },
  oauthLogin: async (provider: OAuthProvider): Promise<{ user: AuthUser }> => {
    const installationId = await getOwnerId();
    const fetchOptions = { headers: { "x-device-id": installationId, "x-owner-id": installationId } };
    const nativeAppleToken = provider === "apple" ? await requestNativeAppleIdToken("sign-in") : undefined;
    const result = nativeAppleToken
      ? await authClient.signIn.social({
        provider: "apple",
        idToken: {
          token: nativeAppleToken.token,
          nonce: nativeAppleToken.nonce,
          accessToken: `${APPLE_NATIVE_AUTHORIZATION_CODE_PREFIX}${nativeAppleToken.authorizationCode}`,
          ...(nativeAppleToken.user ? { user: nativeAppleToken.user } : {})
        },
        fetchOptions
      })
      : await authClient.signIn.social({
        provider,
        callbackURL: MOBILE_AUTH_CALLBACK_URL,
        errorCallbackURL: mobileOAuthErrorCallbackURL(provider, "sign-in"),
        fetchOptions
      });
    if (result.error) throw authError(result.error);
    const session = await authClient.getSession();
    if (session.error) throw authError(session.error);
    if (!session.data?.user) throw new Error(`${oauthProviderLabel(provider)} sign-in was cancelled or did not complete.`);
    return { user: toAuthUser(session.data.user as unknown as Record<string, unknown>) };
  },
  requestPasswordReset: async (email: string): Promise<void> => {
    const result = await authClient.requestPasswordReset({
      email: email.trim().toLowerCase(),
      // Deep link back into the app's native reset screen.
      redirectTo: "personawrapper://reset-password"
    });
    if (result.error) throw authError(result.error);
  },
  resetPassword: async (token: string, newPassword: string): Promise<void> => {
    const result = await authClient.resetPassword({ token, newPassword });
    if (result.error) throw authError(result.error);
  },
  resendVerificationEmail: async (email: string): Promise<void> => {
    const result = await authClient.sendVerificationEmail({ email: email.trim().toLowerCase() });
    if (result.error) throw authError(result.error);
  },
  changePassword: async (currentPassword: string, newPassword: string): Promise<void> => {
    const result = await authClient.changePassword({
      currentPassword,
      newPassword,
      revokeOtherSessions: true
    });
    if (result.error) throw authError(result.error);
  },
  listConnectedAccounts: async (): Promise<ConnectedAccount[]> => {
    const result = await authClient.listAccounts();
    if (result.error) throw authError(result.error);
    return (result.data ?? []).map((account) => ({
      id: account.id,
      providerId: account.providerId,
      accountId: account.accountId,
      createdAt: new Date(account.createdAt).toISOString(),
      updatedAt: new Date(account.updatedAt).toISOString()
    }));
  },
  linkConnectedAccount: async (provider: OAuthProvider): Promise<void> => {
    const installationId = await getOwnerId();
    const fetchOptions = { headers: { "x-device-id": installationId, "x-owner-id": installationId } };
    const nativeAppleToken = provider === "apple" ? await requestNativeAppleIdToken("link") : undefined;
    const result = nativeAppleToken
      ? await authClient.linkSocial({
        provider: "apple",
        idToken: {
          token: nativeAppleToken.token,
          nonce: nativeAppleToken.nonce,
          accessToken: `${APPLE_NATIVE_AUTHORIZATION_CODE_PREFIX}${nativeAppleToken.authorizationCode}`
        },
        fetchOptions
      })
      : await authClient.linkSocial({
        provider,
        callbackURL: MOBILE_AUTH_CALLBACK_URL,
        errorCallbackURL: mobileOAuthErrorCallbackURL(provider, "link"),
        fetchOptions
      });
    if (result.error) throw authError(result.error);
    const accounts = await authClient.listAccounts();
    if (accounts.error) throw authError(accounts.error);
    if (!(accounts.data ?? []).some((account) => account.providerId === provider)) {
      throw new Error(`${oauthProviderLabel(provider)} connection was cancelled or did not complete.`);
    }
  },
  unlinkConnectedAccount: async (providerId: string, accountId?: string): Promise<void> => {
    const result = await authClient.unlinkAccount({ providerId, ...(accountId ? { accountId } : {}) });
    if (result.error) throw authError(result.error);
  },
  getPersonas: async (): Promise<PersonaSummary[]> => {
    const response = await contractClient.personas.list();
    if (response.status !== 200) throw contractError(response.body, "Could not load personas.");
    return response.body.personas;
  },
  getPersona: async (id: string): Promise<PersonaDefinition> => {
    const response = await contractClient.personas.get({ params: { id } });
    if (response.status !== 200) {
      throw contractError(response.body, "Could not load persona.");
    }
    return response.body.persona;
  },
  sendChat: async (payload: MobileChatPayload, signal?: AbortSignal): Promise<ChatResponse> => {
    const response = await contractClient.chat.create({ body: payload, ...(signal ? { fetchOptions: { signal } } : {}) });
    if (response.status !== 200 && response.status !== 202) throw contractError(response.body, "Chat request failed.");
    return response.body;
  },
  reportUnsafeOutput: async (payload: {
    conversationId: string;
    category: import("@persona/shared").UnsafeOutputReportCategory;
    outputExcerpt: string;
    details?: string;
  }): Promise<import("@persona/shared").UnsafeOutputReportReceipt> => {
    const response = await contractClient.safety.reportOutput({ body: payload });
    if (response.status !== 201) throw contractError(response.body, "Could not submit this report.");
    return response.body.report;
  },
  getChatJob: async (jobId: string, signal?: AbortSignal): Promise<ChatJobResponse> => {
    const response = await contractClient.chat.getJob({ params: { jobId }, ...(signal ? { fetchOptions: { signal } } : {}) });
    if (response.status !== 200) throw contractError(response.body, "Chat job not found.");
    return response.body;
  },
  cancelChatJob: async (jobId: string): Promise<ChatJobResponse> => {
    const response = await contractClient.chat.cancelJob({ params: { jobId } });
    if (response.status !== 200) throw contractError(response.body, "Could not stop the chat request.");
    return response.body;
  },
  listConversationsPage: async (cursor?: string, limit = 50, query?: string): Promise<ConversationListPage> => {
    const response = await contractClient.conversations.list({ query: { limit, ...(cursor ? { cursor } : {}), ...(query?.trim() ? { query: query.trim() } : {}) } });
    if (response.status !== 200) throw contractError(response.body, "Could not load conversations.");
    return response.body;
  },
  listConversations: async (): Promise<ConversationSummary[]> =>
    (await api.listConversationsPage()).conversations,
  getConversationTurnsPage: async (conversationId: string, cursor?: string, limit = 40): Promise<ConversationTurnsPage> => {
    const response = await contractClient.conversations.turns({ params: { conversationId }, query: { limit, ...(cursor ? { cursor } : {}) } });
    if (response.status !== 200) throw contractError(response.body, "Conversation not found.");
    return response.body;
  },
  getConversation: async (conversationId: string): Promise<ConversationDetail> => {
    const response = await contractClient.conversations.get({ params: { conversationId } });
    if (response.status !== 200) throw contractError(response.body, "Conversation not found.");
    return response.body.conversation;
  },
  createVectorStore: async (assetIds: string[], name?: string, signal?: AbortSignal): Promise<{ id: string; expiresAt: string }> => {
    const response = await contractClient.uploads.createVectorStore({
      body: { assetIds, ...(name ? { name } : {}) },
      ...(signal ? { fetchOptions: { signal } } : {})
    });
    if (response.status !== 201) throw contractError(response.body, "Could not create a vector store.");
    return response.body.vectorStore;
  },
  deleteUpload: (assetId: string): Promise<void> =>
    contractClient.uploads.remove({ params: { id: assetId } }).then((response) => {
      if (response.status !== 204) throw contractError(response.body, "Could not delete this upload.");
    }),
  deleteVectorStore: (vectorStoreId: string): Promise<void> =>
    contractClient.uploads.removeVectorStore({ params: { id: vectorStoreId } }).then((response) => {
      if (response.status !== 204) throw contractError(response.body, "Could not delete this vector store.");
    }),
  renameConversation: async (conversationId: string, title: string): Promise<ConversationSummary> => {
    const response = await contractClient.conversations.update({ params: { conversationId }, body: { title } });
    if (response.status !== 200) throw contractError(response.body, "Could not rename this conversation.");
    return response.body.conversation;
  },
  pinConversation: async (conversationId: string, pinned: boolean): Promise<ConversationSummary> => {
    const response = await contractClient.conversations.update({ params: { conversationId }, body: { pinned } });
    if (response.status !== 200) throw contractError(response.body, "Could not update this conversation.");
    return response.body.conversation;
  },
  deleteConversation: async (conversationId: string): Promise<void> => {
    const response = await contractClient.conversations.remove({ params: { conversationId } });
    if (response.status !== 204) throw contractError(response.body, "Could not delete this conversation.");
  },
  exportAccountData: async (): Promise<ForTheBaddiezArchive> => {
    const response = await contractClient.data.exportAccount();
    if (response.status !== 200) throw contractError(response.body, "Could not export account data.");
    return response.body;
  },
  exportConversations: async (conversationIds: string[]): Promise<ForTheBaddiezArchive> => {
    const response = await contractClient.data.exportConversations({ body: { conversationIds } });
    if (response.status !== 200) throw contractError(response.body, "Could not export conversations.");
    return response.body;
  },
  importConversationData: async (archive: unknown): Promise<DataImportResult> => {
    const response = await contractClient.data.import({ body: { archive } });
    if (response.status !== 201) throw contractError(response.body, "Could not import conversation data.");
    return response.body;
  },
  startDataExportJob: async (scope: "account" | "conversations", conversationIds?: string[], signal?: AbortSignal): Promise<DataTransferJob> => {
    const response = await contractClient.data.startExportJob({ body: { scope, ...(conversationIds ? { conversationIds } : {}) }, ...(signal ? { fetchOptions: { signal } } : {}) });
    if (response.status !== 202) throw contractError(response.body, "Could not start data export.");
    return response.body;
  },
  startDataImportJob: async (file: MobileUploadFile, sizeBytes: number, signal?: AbortSignal): Promise<DataTransferJob> => {
    const presigned = await contractClient.data.presignImportJob({
      body: { fileName: file.name, mimeType: file.mimeType, sizeBytes },
      ...(signal ? { fetchOptions: { signal } } : {})
    });
    if (presigned.status === 409) {
      const body = new FormData();
      body.append("archive", { uri: file.uri, name: file.name, type: file.mimeType } as unknown as Blob);
      const timeout = createRequestTimeout(signal, DATA_TRANSFER_UPLOAD_TIMEOUT_MS);
      try {
        const response = await fetch(`${API_BASE_URL}/api/data/jobs/import`, {
          method: "POST",
          headers: await requestHeaders(false),
          body,
          signal: timeout.signal
        });
        if (!response.ok) throw await parseApiError(response);
        return await response.json() as DataTransferJob;
      } finally {
        timeout.dispose();
      }
    }
    if (presigned.status !== 201) throw contractError(presigned.body, "Could not prepare data import.");
    try {
      const timeout = createRequestTimeout(signal, DATA_TRANSFER_UPLOAD_TIMEOUT_MS);
      try {
        const upload = FileSystem.createUploadTask(presigned.body.uploadUrl, file.uri, {
          httpMethod: "PUT",
          headers: presigned.body.headers,
          uploadType: FileSystem.FileSystemUploadType.BINARY_CONTENT
        });
        const cancelUpload = () => { void upload.cancelAsync().catch(() => undefined); };
        timeout.signal.addEventListener("abort", cancelUpload, { once: true });
        try {
          const uploaded = await upload.uploadAsync();
          if (!uploaded || uploaded.status < 200 || uploaded.status >= 300) {
            throw await directUploadError({
              headers: new Headers(uploaded?.headers),
              text: async () => uploaded?.body ?? ""
            }, "The storage service rejected the import archive.");
          }
        } finally {
          timeout.signal.removeEventListener("abort", cancelUpload);
        }
      } finally {
        timeout.dispose();
      }
      const completed = await contractClient.data.completeImportJob({ params: { jobId: presigned.body.jobId }, ...(signal ? { fetchOptions: { signal } } : {}) });
      if (completed.status !== 202) throw contractError(completed.body, "Could not start data import.");
      return completed.body;
    } catch (error) {
      await contractClient.data.cancelJob({ params: { jobId: presigned.body.jobId } }).catch(() => undefined);
      throw error;
    }
  },
  getDataTransferJob: async (jobId: string): Promise<DataTransferJob> => {
    const response = await contractClient.data.getJob({ params: { jobId } });
    if (response.status !== 200) throw contractError(response.body, "Data transfer job not found.");
    return response.body;
  },
  cancelDataTransferJob: async (jobId: string): Promise<DataTransferJob> => {
    const response = await contractClient.data.cancelJob({ params: { jobId } });
    if (response.status !== 200) throw contractError(response.body, "Data transfer job not found.");
    return response.body;
  },
  waitForDataTransferJob: async (jobId: string, onProgress?: (job: DataTransferJob) => void, signal?: AbortSignal): Promise<DataTransferJob> => {
    const deadline = Date.now() + DATA_TRANSFER_POLL_TIMEOUT_MS;
    const abortError = () => {
      const error = new Error("Data transfer cancelled.");
      error.name = "AbortError";
      return error;
    };
    for (;;) {
      if (signal?.aborted) throw abortError();
      if (Date.now() >= deadline) throw new Error("The data transfer is taking longer than expected. Check its status again later.");
      const job = await api.getDataTransferJob(jobId);
      if (signal?.aborted) throw abortError();
      onProgress?.(job);
      if (job.status === "completed") return job;
      if (job.status === "failed" || job.status === "cancelled") throw new Error(job.error || `Data transfer ${job.status}.`);
      await new Promise<void>((resolve, reject) => {
        const onAbort = () => {
          clearTimeout(timer);
          reject(abortError());
        };
        const timer = setTimeout(() => {
          signal?.removeEventListener("abort", onAbort);
          resolve();
        }, 1000);
        signal?.addEventListener("abort", onAbort, { once: true });
      });
    }
  }
};
