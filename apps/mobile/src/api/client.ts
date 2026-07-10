import Constants from "expo-constants";
import { Platform } from "react-native";
import type {
  AuthResponse,
  ChatJobResponse,
  ChatResponse,
  ClientContext,
  ConversationDetail,
  ConversationSummary,
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
type MobileOAuthExchangeRequest = Omit<OAuthExchangeRequest, "clientType" | "deviceId">;

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

async function refreshStoredAuth(): Promise<boolean> {
  const refreshToken = (await getAuthTokens())?.refreshToken;
  if (!refreshToken) return false;
  try {
    const response = await requestJson<AuthResponse>("/api/auth/refresh", {
      method: "POST",
      body: JSON.stringify({ refreshToken, clientType: clientType(), deviceId: await getDeviceId() })
    }, { skipAuthRefresh: true });
    await setAuthTokens(response.tokens);
    return true;
  } catch {
    await clearAuthTokens();
    return false;
  }
}

async function requestJson<T>(
  path: string,
  init?: RequestInit,
  options?: { skipAuthRefresh?: boolean }
): Promise<T> {
  const { headers, ...rest } = init ?? {};
  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      ...rest,
      headers: await requestHeaders(true, headers)
    });
  } catch {
    throw new Error(`Could not connect to the app server at ${API_BASE_URL}.`);
  }
  if (response.status === 401 && !options?.skipAuthRefresh && await refreshStoredAuth()) {
    return requestJson<T>(path, init, { skipAuthRefresh: true });
  }
  if (!response.ok) throw await parseApiError(response);
  return response.json() as Promise<T>;
}

async function requestNoContent(
  path: string,
  init?: RequestInit,
  options?: { skipAuthRefresh?: boolean }
): Promise<void> {
  const { headers, ...rest } = init ?? {};
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...rest,
    headers: await requestHeaders(false, headers)
  });
  if (response.status === 401 && !options?.skipAuthRefresh && await refreshStoredAuth()) {
    return requestNoContent(path, init, { skipAuthRefresh: true });
  }
  if (!response.ok) throw await parseApiError(response);
}

export const api = {
  resolveUrl: (pathOrUrl: string): string => pathOrUrl.startsWith("/") ? `${API_BASE_URL}${pathOrUrl}` : pathOrUrl,
  mediaHeaders: (): Promise<Record<string, string>> => requestHeaders(false),
  getDeviceId,
  uploadFiles: async (
    files: MobileUploadFile[],
    options?: { skipAuthRefresh?: boolean }
  ): Promise<UploadedAsset[]> => {
    const body = new FormData();
    for (const file of files) {
      body.append("files", {
        uri: file.uri,
        name: file.name,
        type: file.mimeType
      } as unknown as Blob);
    }
    let response: Response;
    try {
      response = await fetch(`${API_BASE_URL}/api/uploads`, {
        method: "POST",
        headers: await requestHeaders(false),
        body
      });
    } catch {
      throw new Error(`Could not connect to the app server at ${API_BASE_URL}.`);
    }
    if (response.status === 401 && !options?.skipAuthRefresh && await refreshStoredAuth()) {
      return api.uploadFiles(files, { skipAuthRefresh: true });
    }
    if (!response.ok) throw await parseApiError(response);
    const payload = await response.json() as { assets: UploadedAsset[] };
    return payload.assets;
  },
  oauthStartUrl: async (provider: OAuthProvider, returnUrl?: string): Promise<string> => {
    const url = new URL(`/api/auth/oauth/${provider}/start`, API_BASE_URL);
    url.searchParams.set("clientType", clientType());
    url.searchParams.set("deviceId", await getDeviceId());
    if (returnUrl) url.searchParams.set("returnUrl", returnUrl);
    return url.toString();
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
  exchangeOAuthCode: async (payload: MobileOAuthExchangeRequest): Promise<AuthResponse> => {
    const response = await requestJson<AuthResponse>("/api/auth/oauth/exchange", {
      method: "POST",
      body: JSON.stringify({ ...payload, clientType: clientType(), deviceId: await getDeviceId() })
    }, { skipAuthRefresh: true });
    await setAuthTokens(response.tokens);
    return response;
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
  listConversations: async (): Promise<ConversationSummary[]> => {
    const payload = await requestJson<{ conversations: ConversationSummary[] }>("/api/chat/conversations");
    return payload.conversations;
  },
  getConversation: async (conversationId: string): Promise<ConversationDetail> => {
    const payload = await requestJson<{ conversation: ConversationDetail }>(`/api/chat/conversations/${conversationId}`);
    return payload.conversation;
  },
  createVectorStore: async (assetIds: string[], name?: string): Promise<{ id: string; expiresAt: string }> => {
    const payload = await requestJson<{ vectorStore: { id: string; expiresAt: string } }>("/api/uploads/vector-stores", {
      method: "POST",
      body: JSON.stringify({ assetIds, name })
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
    requestNoContent(`/api/chat/conversations/${conversationId}`, { method: "DELETE" })
};
