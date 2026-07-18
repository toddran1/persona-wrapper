import Constants from "expo-constants";
import { Platform } from "react-native";
import { apiContract } from "@persona/shared";
import { initClient } from "@ts-rest/core";
import type {
  ActiveSession,
  AuthUser,
  AuthSession,
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
  OAuthProvider,
  OAuthProviderStatus,
  PersonaDefinition,
  PersonaSummary,
  ProviderId,
  RegisterRequest,
  RevokeOtherSessionsResponse,
  RestoreAccountRequest,
  ToolOptions,
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
type ApiErrorPayload = {
  error?: string;
  message?: string;
};

function contractError(body: unknown, fallback: string): Error {
  return new Error(
    typeof body === "object" && body !== null && "error" in body && typeof body.error === "string"
      ? body.error
      : fallback
  );
}

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
  const cookie = authClient.getCookie();
  if (cookie) next.Cookie = cookie;
  next["x-owner-id"] = await getOwnerId();
  return { ...next, ...(headers as Record<string, string> | undefined ?? {}) };
}

const contractClient = initClient(apiContract, {
  baseUrl: API_BASE_URL,
  baseHeaders: {},
  api: async ({ path, method, headers, body, fetchOptions }) => {
    const timeout = createRequestTimeout(fetchOptions?.signal, DEFAULT_REQUEST_TIMEOUT_MS);
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
      const contentType = response.headers.get("content-type") ?? "";
      const responseBody = response.status === 204
        ? undefined
        : contentType.includes("application/json")
          ? await response.json()
          : await response.text();
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

export const api = {
  resolveUrl: (pathOrUrl: string): string => pathOrUrl.startsWith("/") ? `${API_BASE_URL}${pathOrUrl}` : pathOrUrl,
  mediaHeaders: (): Promise<Record<string, string>> => requestHeaders(false),
  uploadFiles: async (
    files: MobileUploadFile[],
    options?: { skipAuthRefresh?: boolean; signal?: AbortSignal }
  ): Promise<UploadedAsset[]> => {
    try {
      return await Promise.all(files.map(async (file) => {
        const source = await fetch(file.uri, options?.signal ? { signal: options.signal } : undefined);
        if (!source.ok) throw new Error("Could not read the selected file.");
        const blob = await source.blob();
        const presigned = await contractClient.uploads.presign({
          body: { fileName: file.name, mimeType: file.mimeType, sizeBytes: blob.size },
          ...(options?.signal ? { fetchOptions: { signal: options.signal } } : {})
        });
        if (presigned.status === 409) throw new Error("DIRECT_UPLOAD_UNAVAILABLE");
        if (presigned.status !== 201) throw new Error("Could not prepare this upload.");
        const uploaded = await fetch(presigned.body.uploadUrl, {
          method: "PUT",
          headers: presigned.body.headers,
          body: blob,
          ...(options?.signal ? { signal: options.signal } : {})
        });
        if (!uploaded.ok) throw new Error("The storage service rejected this upload.");
        const completed = await contractClient.uploads.complete({
          params: { id: presigned.body.assetId },
          ...(options?.signal ? { fetchOptions: { signal: options.signal } } : {})
        });
        if (completed.status !== 200) throw new Error("The app server could not finish this upload.");
        return completed.body.asset;
      }));
    } catch (error) {
      if (!(error instanceof Error) || error.message !== "DIRECT_UPLOAD_UNAVAILABLE") throw error;
    }

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
  register: async (payload: MobileRegisterRequest): Promise<{ user: AuthUser }> => {
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
  login: async (payload: MobileLoginRequest): Promise<{ user: AuthUser }> => {
    const identifier = payload.identifier.trim().toLowerCase();
    const result = identifier.includes("@")
      ? await authClient.signIn.email({ email: identifier, password: payload.password })
      : await authClient.signIn.username({ username: identifier, password: payload.password });
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
    if (result.error || !result.data?.user) throw authError(result.error ?? { message: "Not authenticated." });
    return {
      user: toAuthUser(result.data.user as unknown as Record<string, unknown>),
      session: toAuthSession(result.data.session as unknown as Record<string, unknown>)
    };
  },
  listActiveSessions: async (): Promise<ActiveSession[]> => {
    const [sessionsResult, currentResult] = await Promise.all([authClient.listSessions(), authClient.getSession()]);
    if (sessionsResult.error) throw authError(sessionsResult.error);
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
    if (response.status !== 200) throw new Error("Could not load sign-in providers.");
    return response.body.providers;
  },
  oauthLogin: async (provider: OAuthProvider): Promise<{ user: AuthUser }> => {
    const result = await authClient.signIn.social({ provider, callbackURL: MOBILE_AUTH_CALLBACK_URL });
    if (result.error) throw authError(result.error);
    const session = await authClient.getSession();
    if (session.error || !session.data?.user) throw authError(session.error ?? { message: "OAuth sign in did not complete." });
    return { user: toAuthUser(session.data.user as unknown as Record<string, unknown>) };
  },
  getPersonas: async (): Promise<PersonaSummary[]> => {
    const response = await contractClient.personas.list();
    if (response.status !== 200) throw new Error("Could not load personas.");
    return response.body.personas;
  },
  getPersona: async (id: string): Promise<PersonaDefinition> => {
    const response = await contractClient.personas.get({ params: { id } });
    if (response.status !== 200) {
      throw new Error(response.status === 404 ? response.body.error : "Could not load persona.");
    }
    return response.body.persona;
  },
  sendChat: async (payload: MobileChatPayload, signal?: AbortSignal): Promise<ChatResponse> => {
    const response = await contractClient.chat.create({ body: payload, ...(signal ? { fetchOptions: { signal } } : {}) });
    if (response.status !== 200 && response.status !== 202) throw new Error("Chat request failed.");
    return response.body;
  },
  getChatJob: async (jobId: string, signal?: AbortSignal): Promise<ChatJobResponse> => {
    const response = await contractClient.chat.getJob({ params: { jobId }, ...(signal ? { fetchOptions: { signal } } : {}) });
    if (response.status !== 200) throw new Error("Chat job not found.");
    return response.body;
  },
  listConversationsPage: async (cursor?: string, limit = 50, query?: string): Promise<ConversationListPage> => {
    const response = await contractClient.conversations.list({ query: { limit, ...(cursor ? { cursor } : {}), ...(query?.trim() ? { query: query.trim() } : {}) } });
    if (response.status !== 200) throw new Error("Could not load conversations.");
    return response.body;
  },
  listConversations: async (): Promise<ConversationSummary[]> =>
    (await api.listConversationsPage()).conversations,
  getConversationTurnsPage: async (conversationId: string, cursor?: string, limit = 40): Promise<ConversationTurnsPage> => {
    const response = await contractClient.conversations.turns({ params: { conversationId }, query: { limit, ...(cursor ? { cursor } : {}) } });
    if (response.status !== 200) throw new Error("Conversation not found.");
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
    if (response.status !== 201) throw new Error("Could not create a vector store.");
    return response.body.vectorStore;
  },
  deleteVectorStore: (vectorStoreId: string): Promise<void> =>
    contractClient.uploads.removeVectorStore({ params: { id: vectorStoreId } }).then((response) => {
      if (response.status !== 204) throw new Error("Could not delete this vector store.");
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
  }
};
