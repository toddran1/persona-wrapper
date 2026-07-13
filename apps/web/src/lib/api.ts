import type {
  AuthResponse,
  AccountDeletionResponse,
  AuthTokens,
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
  RefreshAuthRequest,
  RegisterRequest,
  RestoreAccountRequest,
  ToolOptions,
  UploadedAsset
} from "@persona/shared";

const DEFAULT_API_BASE_URL = "http://localhost:4000";
const configuredApiBaseUrl = typeof import.meta.env.VITE_API_URL === "string" ? import.meta.env.VITE_API_URL.trim() : "";
export const API_BASE_URL = configuredApiBaseUrl || DEFAULT_API_BASE_URL;
const OWNER_ID_KEY = "persona-wrapper-owner-id";
const AUTH_TOKENS_KEY = "persona-wrapper-auth-tokens";
let fallbackOwnerId: string | undefined;
let authRefreshInFlight: Promise<boolean> | undefined;

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

export function authTokens(): AuthTokens | undefined {
  try {
    const value = localStorage.getItem(AUTH_TOKENS_KEY);
    if (!value) return undefined;
    return JSON.parse(value) as AuthTokens;
  } catch {
    try { localStorage.removeItem(AUTH_TOKENS_KEY); } catch { /* Storage is unavailable. */ }
    return undefined;
  }
}

export function setAuthTokens(tokens: AuthTokens): void {
  try {
    localStorage.setItem(AUTH_TOKENS_KEY, JSON.stringify(tokens));
  } catch {
    throw new Error("Your browser could not securely save the sign-in session. Check storage permissions and try again.");
  }
}

export function clearAuthTokens(): void {
  try { localStorage.removeItem(AUTH_TOKENS_KEY); } catch { /* Storage is unavailable. */ }
}

export type OAuthCallbackResult = {
  tokens?: AuthTokens;
  error?: string;
};

export function oauthStartUrl(provider: OAuthProvider, clientType = "web", deviceId?: string): string {
  const url = new URL(`/api/auth/oauth/${provider}/start`, API_BASE_URL);
  url.searchParams.set("clientType", clientType);
  if (deviceId) url.searchParams.set("deviceId", deviceId);
  return url.toString();
}

export function consumeOAuthCallbackResult(): OAuthCallbackResult | undefined {
  if (typeof window === "undefined" || window.location.pathname !== "/auth/callback") return undefined;
  const params = new URLSearchParams(window.location.hash.replace(/^#/, ""));
  const error = params.get("error") ?? undefined;
  const accessToken = params.get("accessToken");
  const refreshToken = params.get("refreshToken");
  const expiresAt = params.get("expiresAt");
  const refreshExpiresAt = params.get("refreshExpiresAt");
  const tokenType = "Bearer";
  window.history.replaceState(null, document.title, "/");
  if (error) return { error };
  if (!accessToken || !refreshToken || !expiresAt || !refreshExpiresAt) return undefined;
  const tokens: AuthTokens = {
    accessToken,
    refreshToken,
    expiresAt,
    refreshExpiresAt,
    tokenType
  };
  setAuthTokens(tokens);
  return { tokens };
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
  const token = authTokens()?.accessToken;
  if (token) {
    next.Authorization = `Bearer ${token}`;
  } else {
    next["x-owner-id"] = ownerId();
  }

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

async function performStoredAuthRefresh(): Promise<boolean> {
  const refreshToken = authTokens()?.refreshToken;
  if (!refreshToken) return false;
  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}/api/auth/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-client-type": "web" },
      body: JSON.stringify({ refreshToken, clientType: "web" })
    });
  } catch {
    return false;
  }
  if (!response.ok) {
    if (response.status === 401 || response.status === 403) clearAuthTokens();
    return false;
  }
  try {
    const auth = await response.json() as AuthResponse;
    setAuthTokens(auth.tokens);
    return true;
  } catch {
    return false;
  }
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
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      ...rest,
      headers: requestHeaders(true, headers)
    });
  } catch (error) {
    throw new Error("Could not connect to the app server. Make sure the API is running.");
  }

  if (response.status === 401 && !options?.skipAuthRefresh && await refreshStoredAuth()) {
    return requestJson<T>(path, init, { skipAuthRefresh: true });
  }
  if (!response.ok) {
    throw new Error(await parseApiError(response));
  }

  try {
    return await response.json() as T;
  } catch {
    throw new Error("The app server returned an invalid response. Please try again.");
  }
}

async function requestNoContent(path: string, init?: RequestInit, options?: { skipAuthRefresh?: boolean }): Promise<void> {
  const { headers, ...rest } = init ?? {};
  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      ...rest,
      headers: requestHeaders(false, headers)
    });
  } catch (error) {
    throw new Error("Could not connect to the app server. Make sure the API is running.");
  }
  if (response.status === 401 && !options?.skipAuthRefresh && await refreshStoredAuth()) {
    return requestNoContent(path, init, { skipAuthRefresh: true });
  }
  if (!response.ok) throw new Error(await parseApiError(response));
}

export const api = {
  fetchUploadBlob: async (url: string, signal?: AbortSignal): Promise<Blob> => {
    const resolvedUrl = resolveApiUrl(url);
    for (let attempt = 0; attempt < 2; attempt += 1) {
      let response: Response;
      try {
        response = await fetch(resolvedUrl, {
          headers: requestHeaders(false),
          ...(signal ? { signal } : {})
        });
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") throw error;
        throw new Error("Could not download this file from the app server.");
      }
      if (response.status === 401 && attempt === 0 && await refreshStoredAuth()) continue;
      if (!response.ok) throw new Error(await parseApiError(response));
      return response.blob();
    }
    throw new Error("Could not download this file from the app server.");
  },
  uploadFiles: async (files: File[]): Promise<UploadedAsset[]> => {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const body = new FormData();
      files.forEach((file) => body.append("files", file));
      let response: Response;
      try {
        response = await fetch(`${API_BASE_URL}/api/uploads`, {
          method: "POST",
          headers: requestHeaders(false),
          body
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`Could not reach API at ${API_BASE_URL}/api/uploads: ${message}`);
      }
      if (response.status === 401 && attempt === 0 && await refreshStoredAuth()) continue;
      if (!response.ok) throw new Error(await parseApiError(response));
      try {
        const payload = await response.json() as { assets: UploadedAsset[] };
        return payload.assets;
      } catch {
        throw new Error("The app server returned an invalid upload response.");
      }
    }
    throw new Error("Could not upload files to the app server.");
  },
  createVectorStore: async (assetIds: string[], name?: string): Promise<{ id: string; expiresAt: string }> => {
    const payload = await requestJson<{ vectorStore: { id: string; expiresAt: string } }>("/api/uploads/vector-stores", {
      method: "POST",
      body: JSON.stringify({ assetIds, name })
    });
    return payload.vectorStore;
  },
  deleteUpload: async (assetId: string): Promise<void> => {
    await requestNoContent(`/api/uploads/${assetId}`, { method: "DELETE" });
  },
  deleteVectorStore: async (vectorStoreId: string): Promise<void> => {
    await requestNoContent(`/api/uploads/vector-stores/${vectorStoreId}`, { method: "DELETE" });
  },
  register: async (payload: RegisterRequest): Promise<AuthResponse> => {
    const response = await requestJson<AuthResponse>("/api/auth/register", {
      method: "POST",
      body: JSON.stringify(payload)
    });
    setAuthTokens(response.tokens);
    return response;
  },
  login: async (payload: LoginRequest): Promise<AuthResponse> => {
    const response = await requestJson<AuthResponse>("/api/auth/login", {
      method: "POST",
      body: JSON.stringify(payload)
    });
    setAuthTokens(response.tokens);
    return response;
  },
  restoreAccount: async (payload: RestoreAccountRequest): Promise<AuthResponse> => {
    const response = await requestJson<AuthResponse>("/api/auth/restore", {
      method: "POST",
      body: JSON.stringify(payload)
    });
    setAuthTokens(response.tokens);
    return response;
  },
  deleteAccount: async (payload: { confirmation: "DELETE"; password?: string }): Promise<AccountDeletionResponse> => {
    const response = await requestJson<AccountDeletionResponse>("/api/auth/account", {
      method: "DELETE",
      body: JSON.stringify(payload)
    });
    clearAuthTokens();
    return response;
  },
  refreshAuth: async (payload?: Partial<RefreshAuthRequest>): Promise<AuthResponse> => {
    const refreshToken = payload?.refreshToken ?? authTokens()?.refreshToken;
    if (!refreshToken) throw new Error("No refresh token available.");
    const response = await requestJson<AuthResponse>("/api/auth/refresh", {
      method: "POST",
      body: JSON.stringify({ ...payload, refreshToken })
    }, { skipAuthRefresh: true });
    setAuthTokens(response.tokens);
    return response;
  },
  logout: async (): Promise<void> => {
    const refreshToken = authTokens()?.refreshToken;
    try {
      await requestNoContent("/api/auth/logout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(refreshToken ? { refreshToken } : {})
      });
    } finally {
      clearAuthTokens();
    }
  },
  getCurrentUser: async (): Promise<MeResponse> =>
    requestJson<MeResponse>("/api/auth/me"),
  getOAuthProviders: async (): Promise<OAuthProviderStatus[]> => {
    const payload = await requestJson<{ providers: OAuthProviderStatus[] }>("/api/auth/oauth/providers");
    return payload.providers;
  },
  oauthStartUrl,
  getPersonas: async (): Promise<PersonaSummary[]> => {
    const payload = await requestJson<{ personas: PersonaSummary[] }>("/api/personas");
    return payload.personas;
  },
  getPersona: async (id: string): Promise<PersonaDefinition> => {
    const payload = await requestJson<{ persona: PersonaDefinition }>(`/api/personas/${id}`);
    return payload.persona;
  },
  sendChat: async (payload: ChatPayload, signal?: AbortSignal): Promise<ChatResponse> =>
    requestJson<ChatResponse>("/api/chat", {
      method: "POST",
      body: JSON.stringify(payload),
      ...(signal ? { signal } : {})
    }),
  getChatJob: async (jobId: string, signal?: AbortSignal): Promise<ChatJobResponse> =>
    requestJson<ChatJobResponse>(`/api/chat/jobs/${jobId}`, {
      method: "GET",
      ...(signal ? { signal } : {})
    }),
  listConversationsPage: (cursor?: string, limit = 50): Promise<ConversationListPage> =>
    requestJson<ConversationListPage>(`/api/chat/conversations?limit=${limit}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`),
  listConversations: async (): Promise<ConversationSummary[]> =>
    (await api.listConversationsPage()).conversations,
  getConversationTurnsPage: (conversationId: string, cursor?: string, limit = 40): Promise<ConversationTurnsPage> =>
    requestJson<ConversationTurnsPage>(`/api/chat/conversations/${conversationId}/turns?limit=${limit}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`),
  getConversation: async (conversationId: string): Promise<ConversationDetail> => {
    const payload = await requestJson<{ conversation: ConversationDetail }>(`/api/chat/conversations/${conversationId}`);
    return payload.conversation;
  },
  renameConversation: async (conversationId: string, title: string): Promise<ConversationSummary> => {
    const payload = await requestJson<{ conversation: ConversationSummary }>(`/api/chat/conversations/${conversationId}`, {
      method: "PATCH",
      body: JSON.stringify({ title })
    });
    return payload.conversation;
  },
  pinConversation: async (conversationId: string, pinned: boolean): Promise<ConversationSummary> => {
    const payload = await requestJson<{ conversation: ConversationSummary }>(`/api/chat/conversations/${conversationId}`, {
      method: "PATCH",
      body: JSON.stringify({ pinned })
    });
    return payload.conversation;
  },
  deleteConversation: async (conversationId: string): Promise<void> => {
    await requestNoContent(`/api/chat/conversations/${conversationId}`, { method: "DELETE" });
  },
  exportAccountData: (): Promise<ForTheBaddiezArchive> => requestJson<ForTheBaddiezArchive>("/api/data/export/account"),
  exportConversations: (conversationIds: string[]): Promise<ForTheBaddiezArchive> => requestJson<ForTheBaddiezArchive>("/api/data/export/conversations", {
    method: "POST",
    body: JSON.stringify({ conversationIds })
  }),
  importConversationData: (archive: unknown): Promise<DataImportResult> => requestJson<DataImportResult>("/api/data/import", {
    method: "POST",
    body: JSON.stringify({ archive })
  }),
  cancelChatJob: async (jobId: string): Promise<ChatJobResponse> =>
    requestJson<ChatJobResponse>(`/api/chat/jobs/${jobId}/cancel`, {
      method: "POST"
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
