import Constants from "expo-constants";
import { Platform } from "react-native";
import type {
  ActiveSession,
  ActiveSessionsResponse,
  AuthResponse,
  AccountDeletionResponse,
  ChatJobResponse,
  ChatResponse,
  ClientContext,
  ConversationDetail,
  ConversationListPage,
  ConversationSummary,
  ConversationTurnsPage,
  DataImportResult,
  ForTheBaddiezArchive,
  LoginRequest,
  MeResponse,
  OAuthExchangeRequest,
  OAuthProvider,
  OAuthProviderStatus,
  PersonaDefinition,
  PersonaSummary,
  ProviderId,
  RefreshAuthRequest,
  RegisterRequest,
  RevokeOtherSessionsResponse,
  RestoreAccountRequest,
  ToolOptions,
  UploadedAsset
} from "@persona/shared";
import { clearAuthTokens, getAuthTokens, getDeviceId, getOwnerId, setAuthTokens } from "../storage/secureTokens";

const configuredApiUrl = process.env.EXPO_PUBLIC_API_URL || Constants.expoConfig?.extra?.apiUrl;
export const API_BASE_URL = String(configuredApiUrl || "http://localhost:4000").replace(/\/$/, "");

export type MobileChatPayload = {
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

export type MobileUploadFile = {
  uri: string;
  name: string;
  mimeType: string;
};

type MobileRegisterRequest = Omit<RegisterRequest, "clientType" | "deviceId">;
type MobileLoginRequest = Omit<LoginRequest, "clientType" | "deviceId">;
type MobileRestoreAccountRequest = Omit<RestoreAccountRequest, "clientType" | "deviceId">;
type MobileOAuthExchangeRequest = Omit<OAuthExchangeRequest, "clientType" | "deviceId">;
type MobileOAuthStartResponse = {
  authorizationUrl: string;
  exchangeCode: string;
};
type MobileOAuthPollResponse =
  | { status: "pending" }
  | { status: "complete"; auth: AuthResponse };

type ApiErrorPayload = {
  error?: string;
  message?: string;
};

class ApiResponseError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
    this.name = "ApiResponseError";
  }
}

function isServerResponseError(error: unknown): boolean {
  return error instanceof ApiResponseError || (
    error instanceof Error && error.message.startsWith("The app server returned an invalid")
  );
}

let authRefreshInFlight: Promise<boolean> | undefined;
const DEFAULT_REQUEST_TIMEOUT_MS = 20_000;
const UPLOAD_REQUEST_TIMEOUT_MS = 90_000;

type RequestTimeout = {
  signal: AbortSignal;
  didTimeout: () => boolean;
  dispose: () => void;
};

function createRequestTimeout(externalSignal: AbortSignal | null | undefined, timeoutMs: number): RequestTimeout {
  const controller = new AbortController();
  let timedOut = false;
  const abortFromCaller = () => controller.abort();
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  if (externalSignal) {
    if (externalSignal.aborted) controller.abort();
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

async function parseApiError(response: Response): Promise<ApiResponseError> {
  try {
    const payload = await response.json() as ApiErrorPayload;
    return new ApiResponseError(response.status, payload.error || payload.message || `Request failed with status ${response.status}.`);
  } catch {
    return new ApiResponseError(response.status, `Request failed with status ${response.status}.`);
  }
}

function clientType(): "ios" | "android" | "unknown" {
  if (Platform.OS === "ios") return "ios";
  if (Platform.OS === "android") return "android";
  return "unknown";
}

async function requestHeaders(includeJson: boolean, headers?: HeadersInit): Promise<Record<string, string>> {
  const next: Record<string, string> = {
    "x-client-type": clientType()
  };
  if (includeJson) next["Content-Type"] = "application/json";
  const tokens = await getAuthTokens();
  if (tokens?.accessToken) {
    next.Authorization = `Bearer ${tokens.accessToken}`;
  } else {
    next["x-owner-id"] = await getOwnerId();
  }
  return { ...next, ...(headers as Record<string, string> | undefined ?? {}) };
}

async function performStoredAuthRefresh(): Promise<boolean> {
  const refreshToken = (await getAuthTokens())?.refreshToken;
  if (!refreshToken) return false;
  try {
    const response = await requestJson<AuthResponse>("/api/auth/refresh", {
      method: "POST",
      body: JSON.stringify({ refreshToken, clientType: clientType(), deviceId: await getDeviceId() })
    }, { skipAuthRefresh: true });
    await setAuthTokens(response.tokens);
    return true;
  } catch (error) {
    if (error instanceof ApiResponseError && (error.status === 401 || error.status === 403)) {
      await clearAuthTokens();
      return false;
    }
    throw error;
  }
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

async function requestJson<T>(
  path: string,
  init?: RequestInit,
  options?: { skipAuthRefresh?: boolean }
): Promise<T> {
  const { headers, ...rest } = init ?? {};
  const timeout = createRequestTimeout(init?.signal, DEFAULT_REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(`${API_BASE_URL}${path}`, {
      ...rest,
      headers: await requestHeaders(true, headers),
      signal: timeout.signal
    });
    if (response.status === 401 && !options?.skipAuthRefresh && await refreshStoredAuth()) {
      return requestJson<T>(path, init, { skipAuthRefresh: true });
    }
    if (!response.ok) throw await parseApiError(response);
    try {
      return await response.json() as T;
    } catch {
      throw new Error("The app server returned an invalid response. Please try again.");
    }
  } catch (error) {
    if (timeout.didTimeout()) {
      throw new Error("The app server took too long to respond. Check your connection and try again.");
    }
    rethrowAbort(error);
    if (isServerResponseError(error)) throw error;
    throw new Error(`Could not connect to the app server at ${API_BASE_URL}.`);
  } finally {
    timeout.dispose();
  }
}

async function requestNoContent(
  path: string,
  init?: RequestInit,
  options?: { skipAuthRefresh?: boolean }
): Promise<void> {
  const { headers, ...rest } = init ?? {};
  const timeout = createRequestTimeout(init?.signal, DEFAULT_REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(`${API_BASE_URL}${path}`, {
      ...rest,
      headers: await requestHeaders(false, headers),
      signal: timeout.signal
    });
    if (response.status === 401 && !options?.skipAuthRefresh && await refreshStoredAuth()) {
      return requestNoContent(path, init, { skipAuthRefresh: true });
    }
    if (!response.ok) throw await parseApiError(response);
  } catch (error) {
    if (timeout.didTimeout()) {
      throw new Error("The app server took too long to respond. Check your connection and try again.");
    }
    rethrowAbort(error);
    if (isServerResponseError(error)) throw error;
    throw new Error(`Could not connect to the app server at ${API_BASE_URL}.`);
  } finally {
    timeout.dispose();
  }
}

export const api = {
  resolveUrl: (pathOrUrl: string): string => pathOrUrl.startsWith("/") ? `${API_BASE_URL}${pathOrUrl}` : pathOrUrl,
  mediaHeaders: (): Promise<Record<string, string>> => requestHeaders(false),
  getDeviceId,
  uploadFiles: async (
    files: MobileUploadFile[],
    options?: { skipAuthRefresh?: boolean; signal?: AbortSignal }
  ): Promise<UploadedAsset[]> => {
    const body = new FormData();
    for (const file of files) {
      body.append("files", {
        uri: file.uri,
        name: file.name,
        type: file.mimeType
      } as unknown as Blob);
    }
    const timeout = createRequestTimeout(options?.signal, UPLOAD_REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch(`${API_BASE_URL}/api/uploads`, {
        method: "POST",
        headers: await requestHeaders(false),
        body,
        signal: timeout.signal
      });
      if (response.status === 401 && !options?.skipAuthRefresh && await refreshStoredAuth()) {
        return api.uploadFiles(files, { skipAuthRefresh: true, ...(options?.signal ? { signal: options.signal } : {}) });
      }
      if (!response.ok) throw await parseApiError(response);
      let payload: { assets?: UploadedAsset[] };
      try {
        payload = await response.json() as { assets?: UploadedAsset[] };
      } catch {
        throw new Error("The app server returned an invalid upload response. Please try again.");
      }
      if (!Array.isArray(payload.assets)) {
        throw new Error("The app server returned an invalid upload response. Please try again.");
      }
      return payload.assets;
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
  },
  oauthStartUrl: async (provider: OAuthProvider, returnUrl?: string): Promise<string> => {
    const url = new URL(`/api/auth/oauth/${provider}/start`, API_BASE_URL);
    url.searchParams.set("clientType", clientType());
    url.searchParams.set("deviceId", await getDeviceId());
    if (returnUrl) url.searchParams.set("returnUrl", returnUrl);
    return url.toString();
  },
  startMobileOAuth: async (provider: OAuthProvider, returnUrl: string): Promise<MobileOAuthStartResponse> => {
    const url = new URL(`/api/auth/oauth/${provider}/mobile-start`, API_BASE_URL);
    url.searchParams.set("clientType", clientType());
    url.searchParams.set("deviceId", await getDeviceId());
    url.searchParams.set("returnUrl", returnUrl);
    return requestJson<MobileOAuthStartResponse>(`${url.pathname}${url.search}`, { method: "GET" }, { skipAuthRefresh: true });
  },
  register: async (payload: MobileRegisterRequest): Promise<AuthResponse> => {
    const response = await requestJson<AuthResponse>("/api/auth/register", {
      method: "POST",
      body: JSON.stringify({ ...payload, clientType: clientType(), deviceId: await getDeviceId() })
    });
    await setAuthTokens(response.tokens);
    return response;
  },
  login: async (payload: MobileLoginRequest): Promise<AuthResponse> => {
    const response = await requestJson<AuthResponse>("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ ...payload, clientType: clientType(), deviceId: await getDeviceId() })
    });
    await setAuthTokens(response.tokens);
    return response;
  },
  restoreAccount: async (payload: MobileRestoreAccountRequest): Promise<AuthResponse> => {
    const response = await requestJson<AuthResponse>("/api/auth/restore", {
      method: "POST",
      body: JSON.stringify({ ...payload, clientType: clientType(), deviceId: await getDeviceId() })
    }, { skipAuthRefresh: true });
    await setAuthTokens(response.tokens);
    return response;
  },
  deleteAccount: async (payload: { confirmation: "DELETE"; password?: string }): Promise<AccountDeletionResponse> => {
    const response = await requestJson<AccountDeletionResponse>("/api/auth/account", {
      method: "DELETE",
      body: JSON.stringify(payload)
    });
    await clearAuthTokens();
    return response;
  },
  exchangeOAuthCode: async (payload: MobileOAuthExchangeRequest): Promise<AuthResponse> => {
    const response = await requestJson<AuthResponse>("/api/auth/oauth/exchange", {
      method: "POST",
      body: JSON.stringify({ ...payload, clientType: clientType(), deviceId: await getDeviceId() })
    }, { skipAuthRefresh: true });
    await setAuthTokens(response.tokens);
    return response;
  },
  pollMobileOAuthCode: async (payload: MobileOAuthExchangeRequest): Promise<AuthResponse | undefined> => {
    const response = await requestJson<MobileOAuthPollResponse>("/api/auth/oauth/mobile-exchange", {
      method: "POST",
      body: JSON.stringify({ ...payload, clientType: clientType(), deviceId: await getDeviceId() })
    }, { skipAuthRefresh: true });
    if (response.status === "pending") return undefined;
    await setAuthTokens(response.auth.tokens);
    return response.auth;
  },
  refreshAuth: async (payload?: Partial<RefreshAuthRequest>): Promise<AuthResponse> => {
    const refreshToken = payload?.refreshToken ?? (await getAuthTokens())?.refreshToken;
    if (!refreshToken) throw new Error("No refresh token available.");
    const response = await requestJson<AuthResponse>("/api/auth/refresh", {
      method: "POST",
      body: JSON.stringify({ clientType: clientType(), deviceId: await getDeviceId(), ...payload, refreshToken })
    }, { skipAuthRefresh: true });
    await setAuthTokens(response.tokens);
    return response;
  },
  logout: async (): Promise<void> => {
    const refreshToken = (await getAuthTokens())?.refreshToken;
    try {
      await requestNoContent("/api/auth/logout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(refreshToken ? { refreshToken } : {})
      });
    } finally {
      await clearAuthTokens();
    }
  },
  getCurrentUser: (): Promise<MeResponse> => requestJson<MeResponse>("/api/auth/me"),
  listActiveSessions: async (): Promise<ActiveSession[]> => {
    const payload = await requestJson<ActiveSessionsResponse>("/api/auth/sessions");
    return payload.sessions;
  },
  revokeActiveSession: (sessionId: string): Promise<void> =>
    requestNoContent(`/api/auth/sessions/${encodeURIComponent(sessionId)}`, { method: "DELETE" }),
  revokeOtherSessions: (): Promise<RevokeOtherSessionsResponse> =>
    requestJson<RevokeOtherSessionsResponse>("/api/auth/sessions/others", { method: "DELETE" }),
  getOAuthProviders: async (): Promise<OAuthProviderStatus[]> => {
    const payload = await requestJson<{ providers: OAuthProviderStatus[] }>("/api/auth/oauth/providers");
    return payload.providers;
  },
  getPersonas: async (): Promise<PersonaSummary[]> => {
    const payload = await requestJson<{ personas: PersonaSummary[] }>("/api/personas");
    return payload.personas;
  },
  getPersona: async (id: string): Promise<PersonaDefinition> => {
    const payload = await requestJson<{ persona: PersonaDefinition }>(`/api/personas/${id}`);
    return payload.persona;
  },
  sendChat: (payload: MobileChatPayload, signal?: AbortSignal): Promise<ChatResponse> =>
    requestJson<ChatResponse>("/api/chat", {
      method: "POST",
      body: JSON.stringify(payload),
      ...(signal ? { signal } : {})
    }),
  getChatJob: (jobId: string, signal?: AbortSignal): Promise<ChatJobResponse> =>
    requestJson<ChatJobResponse>(`/api/chat/jobs/${jobId}`, {
      method: "GET",
      ...(signal ? { signal } : {})
    }),
  listConversationsPage: (cursor?: string, limit = 50, query?: string): Promise<ConversationListPage> =>
    requestJson<ConversationListPage>(`/api/chat/conversations?limit=${limit}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}${query?.trim() ? `&query=${encodeURIComponent(query.trim())}` : ""}`),
  listConversations: async (): Promise<ConversationSummary[]> =>
    (await api.listConversationsPage()).conversations,
  getConversationTurnsPage: (conversationId: string, cursor?: string, limit = 40): Promise<ConversationTurnsPage> =>
    requestJson<ConversationTurnsPage>(`/api/chat/conversations/${conversationId}/turns?limit=${limit}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`),
  getConversation: async (conversationId: string): Promise<ConversationDetail> => {
    const payload = await requestJson<{ conversation: ConversationDetail }>(`/api/chat/conversations/${conversationId}`);
    return payload.conversation;
  },
  createVectorStore: async (assetIds: string[], name?: string, signal?: AbortSignal): Promise<{ id: string; expiresAt: string }> => {
    const payload = await requestJson<{ vectorStore: { id: string; expiresAt: string } }>("/api/uploads/vector-stores", {
      method: "POST",
      body: JSON.stringify({ assetIds, name }),
      ...(signal ? { signal } : {})
    });
    return payload.vectorStore;
  },
  deleteVectorStore: (vectorStoreId: string): Promise<void> =>
    requestNoContent(`/api/uploads/vector-stores/${vectorStoreId}`, { method: "DELETE" }),
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
  deleteConversation: (conversationId: string): Promise<void> =>
    requestNoContent(`/api/chat/conversations/${conversationId}`, { method: "DELETE" }),
  exportAccountData: (): Promise<ForTheBaddiezArchive> => requestJson<ForTheBaddiezArchive>("/api/data/export/account"),
  exportConversations: (conversationIds: string[]): Promise<ForTheBaddiezArchive> => requestJson<ForTheBaddiezArchive>("/api/data/export/conversations", {
    method: "POST",
    body: JSON.stringify({ conversationIds })
  }),
  importConversationData: (archive: unknown): Promise<DataImportResult> => requestJson<DataImportResult>("/api/data/import", {
    method: "POST",
    body: JSON.stringify({ archive })
  })
};
