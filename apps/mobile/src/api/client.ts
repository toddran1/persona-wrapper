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

type MobileRegisterRequest = Omit<RegisterRequest, "clientType" | "deviceId">;
type MobileLoginRequest = Omit<LoginRequest, "clientType" | "deviceId">;

type ApiErrorPayload = {
  error?: string;
  message?: string;
};

async function parseApiError(response: Response): Promise<string> {
  try {
    const payload = await response.json() as ApiErrorPayload;
    return payload.error || payload.message || `Request failed with status ${response.status}.`;
  } catch {
    return `Request failed with status ${response.status}.`;
  }
}

function clientType(): "ios" | "android" | "unknown" {
  if (Platform.OS === "ios") return "ios";
  if (Platform.OS === "android") return "android";
  return "unknown";
}

async function requestHeaders(includeJson: boolean, headers?: HeadersInit): Promise<HeadersInit> {
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
  return { ...next, ...(headers ?? {}) };
}

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
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
  if (!response.ok) throw new Error(await parseApiError(response));
  return response.json() as Promise<T>;
}

async function requestNoContent(path: string, init?: RequestInit): Promise<void> {
  const { headers, ...rest } = init ?? {};
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...rest,
    headers: await requestHeaders(false, headers)
  });
  if (!response.ok) throw new Error(await parseApiError(response));
}

export const api = {
  resolveUrl: (pathOrUrl: string): string => pathOrUrl.startsWith("/") ? `${API_BASE_URL}${pathOrUrl}` : pathOrUrl,
  getDeviceId,
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
  refreshAuth: async (payload?: Partial<RefreshAuthRequest>): Promise<AuthResponse> => {
    const refreshToken = payload?.refreshToken ?? (await getAuthTokens())?.refreshToken;
    if (!refreshToken) throw new Error("No refresh token available.");
    const response = await requestJson<AuthResponse>("/api/auth/refresh", {
      method: "POST",
      body: JSON.stringify({ clientType: clientType(), deviceId: await getDeviceId(), ...payload, refreshToken })
    });
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
  deleteConversation: (conversationId: string): Promise<void> =>
    requestNoContent(`/api/chat/conversations/${conversationId}`, { method: "DELETE" })
};
