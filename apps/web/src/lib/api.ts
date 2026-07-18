import { apiContract } from "@persona/shared";
import type {
  AuthUser,
  AuthSession,
  AccountDeletionResponse,
  ChatResponse,
  ChatJobResponse,
  ClientContext,
  ConversationDetail,
  ConversationListPage,
  ConversationSummary,
  ConversationTurnsPage,
  DataImportResult,
  ForTheBaddiezArchive,
  LoginRequest,
  OAuthProvider,
  MeResponse,
  OAuthProviderStatus,
  PersonaDefinition,
  PersonaSummary,
  ProviderId,
  RegisterRequest,
  RestoreAccountRequest,
  ToolOptions,
  UploadedAsset
} from "@persona/shared";
import { initClient } from "@ts-rest/core";
import { logClientEvent, newClientTraceId } from "./telemetry.js";
import { authClient } from "./authClient.js";

const DEFAULT_API_BASE_URL = "http://localhost:4000";
const configuredApiBaseUrl = typeof import.meta.env.VITE_API_URL === "string" ? import.meta.env.VITE_API_URL.trim() : "";
export const API_BASE_URL = configuredApiBaseUrl || DEFAULT_API_BASE_URL;
const OWNER_ID_KEY = "persona-wrapper-owner-id";
const LEGACY_AUTH_TOKENS_KEY = "persona-wrapper-auth-tokens";
let fallbackOwnerId: string | undefined;
let authRefreshInFlight: Promise<boolean> | undefined;
const API_REQUEST_TIMEOUT_MS = 130_000;
const AUTH_REFRESH_TIMEOUT_MS = 30_000;
const UPLOAD_REQUEST_TIMEOUT_MS = 90_000;

class RequestTimeoutError extends Error {
  constructor() {
    super("The app server took too long to respond. Please try again.");
    this.name = "RequestTimeoutError";
  }
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

async function fetchWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit = {},
  timeoutMs = API_REQUEST_TIMEOUT_MS
): Promise<Response> {
  const controller = new AbortController();
  let timedOut = false;
  const externalSignal = init.signal;
  const abortFromCaller = () => controller.abort(externalSignal?.reason);
  if (externalSignal?.aborted) abortFromCaller();
  else externalSignal?.addEventListener("abort", abortFromCaller, { once: true });
  const timeout = window.setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  try {
    return await fetch(input, { credentials: "include", ...init, signal: controller.signal });
  } catch (error) {
    if (timedOut && isAbortError(error)) throw new RequestTimeoutError();
    throw error;
  } finally {
    window.clearTimeout(timeout);
    externalSignal?.removeEventListener("abort", abortFromCaller);
  }
}

export function resolveApiUrl(pathOrUrl: string): string {
  return pathOrUrl.startsWith("/") ? `${API_BASE_URL}${pathOrUrl}` : pathOrUrl;
}

export function ownerId(): string {
  try {
    const existing = localStorage.getItem(OWNER_ID_KEY);
    if (existing) return existing;
    const created = crypto.randomUUID();
    localStorage.setItem(OWNER_ID_KEY, created);
    return created;
  } catch {
    fallbackOwnerId ??= crypto.randomUUID();
    return fallbackOwnerId;
  }
}

function clearLegacyAuthTokens(): void {
  try { localStorage.removeItem(LEGACY_AUTH_TOKENS_KEY); } catch { /* Storage is unavailable. */ }
}

export type ChatPayload = {
  personaId: string;
  message: string;
  provider: ProviderId;
  audio: boolean;
  testMode?: boolean;
  conversationId?: string;
  clientContext?: ClientContext;
  attachments?: UploadedAsset[];
  toolOptions?: ToolOptions;
};

export type StyleTransferEvalCapturePayload = {
  conversationId: string;
  idealStyledText: string;
  notes?: string;
  tags?: string[];
};

export type StyleTransferReviewData = {
  evals: Record<string, unknown>[];
  goldenPairs: Record<string, unknown>[];
  syntheticPairs: Record<string, unknown>[];
  heuristicRejections: Record<string, unknown>[];
  paths: {
    evals: string;
    goldenPairs: string;
    syntheticPairs: string;
    heuristicRejections: string;
  };
};

export type ReviewRecordKind = "evals" | "golden" | "pairs" | "rejections";

export type ReviewRecordUpdatePayload = {
  kind: ReviewRecordKind;
  id: string;
  updates: Record<string, unknown>;
};

export type ReviewRecordCreatePayload = {
  kind: ReviewRecordKind;
  record: Record<string, unknown>;
};

export type ReviewRecordDeletePayload = {
  kind: ReviewRecordKind;
  id: string;
};

type ApiErrorPayload = {
  error?: string;
  message?: string;
  code?: string;
  details?: {
    fieldErrors?: Record<string, string[] | undefined>;
    formErrors?: string[];
  };
};

function contractError(body: unknown, fallback: string): Error {
  return new Error(
    typeof body === "object" && body !== null && "error" in body && typeof body.error === "string"
      ? body.error
      : fallback
  );
}

function firstValidationMessage(payload: ApiErrorPayload): string | undefined {
  const fieldErrors = payload.details?.fieldErrors
    ? Object.values(payload.details.fieldErrors).flatMap((messages) => messages ?? [])
    : [];
  return [...(payload.details?.formErrors ?? []), ...fieldErrors].find(Boolean);
}

function isInternalErrorDetail(message: string): boolean {
  return /failed query|params:|drizzle|postgres|syntax error|violates|duplicate key|relation .* does not exist|insert into|select .* from/i.test(message);
}

async function parseApiError(response: Response): Promise<string> {
  let detail = "";
  let code = "";
  try {
    const payload = await response.json() as ApiErrorPayload;
    detail = firstValidationMessage(payload) ?? payload.error ?? payload.message ?? "";
    code = payload.code ?? "";
  } catch {
    detail = "";
  }

  if (response.status === 401) return detail || "Your session is no longer valid. Please sign in again.";
  if (response.status === 409) return "An account with that email or username already exists.";
  if (response.status === 429) return detail || "Too many requests. Please wait and try again.";
  if (response.status === 413) return detail || "That file is too large.";
  if (response.status === 415) return detail || "That file type is not supported.";
  if (response.status >= 500 || code === "INTERNAL_SERVER_ERROR" || (detail && isInternalErrorDetail(detail))) {
    return "Something went wrong on the server. Please try again.";
  }
  if (detail) return detail;
  return `Request failed with status ${response.status}.`;
}

function requestHeaders(includeJson: boolean, headers?: HeadersInit): HeadersInit {
  const next: Record<string, string> = {};
  if (includeJson) next["Content-Type"] = "application/json";
  next["x-client-trace-id"] = newClientTraceId();
  next["x-owner-id"] = ownerId();

  if (headers instanceof Headers) {
    headers.forEach((value, key) => {
      next[key] = value;
    });
    return next;
  }
  if (Array.isArray(headers)) {
    for (const [key, value] of headers) next[key] = value;
    return next;
  }
  return { ...next, ...(headers ?? {}) };
}

const contractClient = initClient(apiContract, {
  baseUrl: API_BASE_URL,
  baseHeaders: {},
  api: async ({ path, method, headers, body, fetchOptions }) => {
    const requestInit = {
      ...fetchOptions,
      method,
      headers: requestHeaders(false, headers),
      ...(body !== undefined ? { body } : {})
    };
    let response = await fetchWithTimeout(path, requestInit);
    if (response.status === 401 && await refreshStoredAuth()) {
      response = await fetchWithTimeout(path, requestInit);
    }
    const contentType = response.headers.get("content-type") ?? "";
    const responseBody = response.status === 204
      ? undefined
      : contentType.includes("application/json")
        ? await response.json()
        : await response.text();
    return { status: response.status, body: responseBody, headers: response.headers };
  }
});

async function performStoredAuthRefresh(): Promise<boolean> {
  try {
    const session = await authClient.getSession({ fetchOptions: { signal: AbortSignal.timeout(AUTH_REFRESH_TIMEOUT_MS) } });
    return Boolean(session.data);
  } catch {
    return false;
  }
}

function authError(error: { message?: string | undefined } | null): Error {
  return new Error(error?.message || "Authentication failed. Please try again.");
}

function toAuthUser(user: Record<string, unknown>): AuthUser {
  const email = typeof user.email === "string" && !user.email.endsWith("@users.invalid") ? user.email : null;
  return {
    id: String(user.id),
    email,
    username: typeof user.username === "string" ? user.username : null,
    displayName: typeof user.name === "string" ? user.name : null,
    avatarUrl: typeof user.image === "string" ? user.image : null,
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
      "Sign-in succeeded, but your browser did not retain the session. Please enable cross-site cookies or try again."
    );
  }
  return toAuthUser(session.data.user as unknown as Record<string, unknown>);
}

function toAuthSession(session: Record<string, unknown>): AuthSession {
  const value = session.clientType;
  const clientType = value === "web" || value === "desktop" || value === "ios" || value === "android" ? value : "unknown";
  return {
    id: String(session.id),
    userId: String(session.userId),
    clientType,
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

async function requestJson<T>(path: string, init?: RequestInit, options?: { skipAuthRefresh?: boolean }): Promise<T> {
  const { headers, ...rest } = init ?? {};
  let response: Response;
  const startedAt = performance.now();
  const traceId = newClientTraceId();
  try {
    response = await fetchWithTimeout(`${API_BASE_URL}${path}`, {
      ...rest,
      headers: requestHeaders(true, { ...(headers ?? {}), "x-client-trace-id": traceId })
    });
  } catch (error) {
    logClientEvent("client_api_request", { level: "error", error, message: `Network request failed: ${path}`, durationMs: performance.now() - startedAt, traceId });
    if (rest.signal?.aborted && isAbortError(error)) throw error;
    if (error instanceof RequestTimeoutError) throw error;
    throw new Error("Could not connect to the app server. Make sure the API is running.");
  }

  if (response.status === 401 && !options?.skipAuthRefresh && await refreshStoredAuth()) {
    return requestJson<T>(path, init, { skipAuthRefresh: true });
  }
  if (!response.ok) {
    logClientEvent("client_api_request", { level: "error", message: `API request failed: ${path}`, durationMs: performance.now() - startedAt, status: response.status, traceId });
    throw new Error(await parseApiError(response));
  }
  logClientEvent("client_api_request", { message: `API request completed: ${path}`, durationMs: performance.now() - startedAt, status: response.status, traceId });

  try {
    return await response.json() as T;
  } catch {
    throw new Error("The app server returned an invalid response. Please try again.");
  }
}

export const api = {
  fetchUploadBlob: async (url: string, signal?: AbortSignal): Promise<Blob> => {
    const resolvedUrl = resolveApiUrl(url);
    for (let attempt = 0; attempt < 2; attempt += 1) {
      let response: Response;
      try {
        response = await fetchWithTimeout(resolvedUrl, {
          headers: requestHeaders(false),
          ...(signal ? { signal } : {})
        });
      } catch (error) {
        if (isAbortError(error) || error instanceof RequestTimeoutError) throw error;
        throw new Error("Could not download this file from the app server.");
      }
      if (response.status === 401 && attempt === 0 && await refreshStoredAuth()) continue;
      if (!response.ok) throw new Error(await parseApiError(response));
      return response.blob();
    }
    throw new Error("Could not download this file from the app server.");
  },
  uploadFiles: async (files: File[], signal?: AbortSignal): Promise<UploadedAsset[]> => {
    const issuedAssetIds: string[] = [];
    try {
      const assets: UploadedAsset[] = [];
      for (const file of files) {
        const presigned = await contractClient.uploads.presign({
          body: { fileName: file.name, mimeType: file.type, sizeBytes: file.size },
          ...(signal ? { fetchOptions: { signal } } : {})
        });
        if (presigned.status === 409) throw new Error("DIRECT_UPLOAD_UNAVAILABLE");
        if (presigned.status !== 201) throw contractError(presigned.body, "Could not prepare this upload.");
        issuedAssetIds.push(presigned.body.assetId);
        const uploaded = await fetchWithTimeout(presigned.body.uploadUrl, {
          method: "PUT",
          headers: presigned.body.headers,
          body: file,
          credentials: "omit",
          ...(signal ? { signal } : {})
        }, UPLOAD_REQUEST_TIMEOUT_MS);
        if (!uploaded.ok) throw new Error("The storage service rejected this upload.");
        const completed = await contractClient.uploads.complete({
          params: { id: presigned.body.assetId },
          ...(signal ? { fetchOptions: { signal } } : {})
        });
        if (completed.status !== 200) throw contractError(completed.body, "The app server could not finish this upload.");
        assets.push(completed.body.asset);
      }
      return assets;
    } catch (error) {
      await Promise.allSettled(issuedAssetIds.map((id) => contractClient.uploads.remove({ params: { id } })));
      if (!(error instanceof Error) || error.message !== "DIRECT_UPLOAD_UNAVAILABLE" || issuedAssetIds.length > 0) throw error;
    }

    // Local storage cannot issue S3 URLs, so local development keeps the
    // multipart path. Production S3 uploads never proxy file bytes through API memory.
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const body = new FormData();
      files.forEach((file) => body.append("files", file));
      let response: Response;
      try {
        response = await fetchWithTimeout(`${API_BASE_URL}/api/uploads`, {
          method: "POST",
          headers: requestHeaders(false),
          body,
          ...(signal ? { signal } : {})
        });
      } catch (error) {
        if (isAbortError(error) || error instanceof RequestTimeoutError) throw error;
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`Could not reach API at ${API_BASE_URL}/api/uploads: ${message}`);
      }
      if (response.status === 401 && attempt === 0 && await refreshStoredAuth()) continue;
      if (!response.ok) throw new Error(await parseApiError(response));
      try {
        const payload = await response.json() as { assets?: UploadedAsset[] };
        if (!Array.isArray(payload.assets)) throw new Error("The app server returned an invalid upload response.");
        return payload.assets;
      } catch {
        throw new Error("The app server returned an invalid upload response.");
      }
    }
    throw new Error("Could not upload files to the app server.");
  },
  createVectorStore: async (assetIds: string[], name?: string, signal?: AbortSignal): Promise<{ id: string; expiresAt: string }> => {
    const response = await contractClient.uploads.createVectorStore({
      body: { assetIds, ...(name ? { name } : {}) },
      ...(signal ? { fetchOptions: { signal } } : {})
    });
    if (response.status !== 201) throw contractError(response.body, "Could not create a vector store.");
    return response.body.vectorStore;
  },
  deleteUpload: async (assetId: string): Promise<void> => {
    const response = await contractClient.uploads.remove({ params: { id: assetId } });
    if (response.status !== 204) throw contractError(response.body, "Could not delete this upload.");
  },
  deleteVectorStore: async (vectorStoreId: string): Promise<void> => {
    const response = await contractClient.uploads.removeVectorStore({ params: { id: vectorStoreId } });
    if (response.status !== 204) throw contractError(response.body, "Could not delete this vector store.");
  },
  register: async (payload: RegisterRequest): Promise<{ user: AuthUser }> => {
    const email = payload.email?.trim().toLowerCase() ?? `${payload.username?.trim().toLowerCase()}@users.invalid`;
    const result = await authClient.signUp.email({
      email,
      password: payload.password,
      name: payload.displayName?.trim() || payload.username?.trim() || email,
      ...(payload.username ? { username: payload.username, displayUsername: payload.username } : {})
    });
    if (result.error || !result.data?.user) throw authError(result.error);
    return { user: await requirePersistedAuthUser() };
  },
  login: async (payload: LoginRequest): Promise<{ user: AuthUser }> => {
    const identifier = payload.identifier.trim().toLowerCase();
    const result = identifier.includes("@")
      ? await authClient.signIn.email({ email: identifier, password: payload.password })
      : await authClient.signIn.username({ username: identifier, password: payload.password });
    if (result.error || !result.data?.user) throw authError(result.error);
    return { user: await requirePersistedAuthUser() };
  },
  restoreAccount: async (payload: RestoreAccountRequest): Promise<{ user: AuthUser }> => {
    const response = await contractClient.account.restore({ body: payload });
    if (response.status !== 200) throw contractError(response.body, "Could not restore this account.");
    return api.login(payload);
  },
  deleteAccount: async (payload: { confirmation: "DELETE"; password?: string }): Promise<AccountDeletionResponse> => {
    const result = await contractClient.account.remove({ body: payload });
    if (result.status !== 202) throw contractError(result.body, "Could not delete this account.");
    clearLegacyAuthTokens();
    return result.body;
  },
  logout: async (): Promise<void> => {
    const result = await authClient.signOut();
    if (result.error) throw authError(result.error);
    clearLegacyAuthTokens();
  },
  getCurrentUser: async (): Promise<MeResponse> => {
    const result = await authClient.getSession();
    if (result.error || !result.data?.user) throw authError(result.error ?? { message: "Not authenticated." });
    return {
      user: toAuthUser(result.data.user as unknown as Record<string, unknown>),
      session: toAuthSession(result.data.session as unknown as Record<string, unknown>)
    };
  },
  getOAuthProviders: async (): Promise<OAuthProviderStatus[]> => {
    const response = await contractClient.account.oauthProviders();
    if (response.status !== 200) throw contractError(response.body, "Could not load sign-in providers.");
    return response.body.providers;
  },
  oauthLogin: async (provider: OAuthProvider): Promise<void> => {
    const result = await authClient.signIn.social({
      provider,
      callbackURL: new URL("/", window.location.origin).toString()
    });
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
  sendChat: async (payload: ChatPayload, signal?: AbortSignal): Promise<ChatResponse> =>
    contractClient.chat.create({ body: payload, ...(signal ? { fetchOptions: { signal } } : {}) }).then((response) => {
      if (response.status !== 200 && response.status !== 202) throw contractError(response.body, "Chat request failed.");
      return response.body;
    }),
  getChatJob: async (jobId: string, signal?: AbortSignal): Promise<ChatJobResponse> => {
    const response = await contractClient.chat.getJob({ params: { jobId }, ...(signal ? { fetchOptions: { signal } } : {}) });
    if (response.status !== 200) throw contractError(response.body, "Chat job not found.");
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
  cancelChatJob: async (jobId: string): Promise<ChatJobResponse> =>
    contractClient.chat.cancelJob({ params: { jobId } }).then((response) => {
      if (response.status !== 200) throw contractError(response.body, "Chat job not found.");
      return response.body;
    }),
  saveStyleTransferEval: async (
    payload: StyleTransferEvalCapturePayload
  ): Promise<{ id: string; path: string }> =>
    requestJson<{ id: string; path: string }>("/api/chat/style-transfer-evals", {
      method: "POST",
      body: JSON.stringify(payload)
    }),
  getStyleTransferReview: async (): Promise<StyleTransferReviewData> =>
    requestJson<StyleTransferReviewData>("/api/chat/style-transfer-review"),
  updateStyleTransferReviewRecord: async (
    payload: ReviewRecordUpdatePayload
  ): Promise<{ id: string; path: string; record: Record<string, unknown> }> =>
    requestJson<{ id: string; path: string; record: Record<string, unknown> }>("/api/chat/style-transfer-review", {
      method: "PATCH",
      body: JSON.stringify(payload)
    }),
  createStyleTransferReviewRecord: async (
    payload: ReviewRecordCreatePayload
  ): Promise<{ id: string; path: string; record: Record<string, unknown> }> =>
    requestJson<{ id: string; path: string; record: Record<string, unknown> }>("/api/chat/style-transfer-review", {
      method: "POST",
      body: JSON.stringify(payload)
    }),
  deleteStyleTransferReviewRecord: async (payload: ReviewRecordDeletePayload): Promise<{ id: string; path: string }> =>
    requestJson<{ id: string; path: string }>("/api/chat/style-transfer-review", {
      method: "DELETE",
      body: JSON.stringify(payload)
    }),
  promoteRejectedStylePair: async (payload: { id: string }): Promise<{ id: string; path: string; record: Record<string, unknown> }> =>
    requestJson<{ id: string; path: string; record: Record<string, unknown> }>("/api/chat/style-transfer-review/promote-rejected", {
      method: "POST",
      body: JSON.stringify(payload)
    })
};
