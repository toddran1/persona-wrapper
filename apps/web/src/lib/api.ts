import type {
  ChatResponse,
  ChatJobResponse,
  ClientContext,
  ConversationDetail,
  ConversationSummary,
  PersonaDefinition,
  PersonaSummary,
  ProviderId,
  ToolOptions,
  UploadedAsset
} from "@persona/shared";

const DEFAULT_API_BASE_URL = "http://localhost:4000";
const configuredApiBaseUrl = typeof import.meta.env.VITE_API_URL === "string" ? import.meta.env.VITE_API_URL.trim() : "";
export const API_BASE_URL = configuredApiBaseUrl || DEFAULT_API_BASE_URL;
const OWNER_ID_KEY = "persona-wrapper-owner-id";

export function resolveApiUrl(pathOrUrl: string): string {
  return pathOrUrl.startsWith("/") ? `${API_BASE_URL}${pathOrUrl}` : pathOrUrl;
}

export function ownerId(): string {
  const existing = localStorage.getItem(OWNER_ID_KEY);
  if (existing) return existing;
  const created = crypto.randomUUID();
  localStorage.setItem(OWNER_ID_KEY, created);
  return created;
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

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      headers: {
        "Content-Type": "application/json",
        "x-owner-id": ownerId()
      },
      ...init
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Could not reach API at ${API_BASE_URL}${path}: ${message}`);
  }

  if (!response.ok) {
    let detail = "";
    try {
      const payload = await response.json() as { error?: string; message?: string };
      detail = payload.error ?? payload.message ?? "";
    } catch {
      detail = "";
    }
    throw new Error(detail ? `Request failed with status ${response.status}: ${detail}` : `Request failed with status ${response.status}`);
  }

  return response.json() as Promise<T>;
}

async function requestNoContent(path: string, init?: RequestInit): Promise<void> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      headers: { "x-owner-id": ownerId() },
      ...init
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Could not reach API at ${API_BASE_URL}${path}: ${message}`);
  }
  if (!response.ok) throw new Error(`Request failed with status ${response.status}`);
}

export const api = {
  fetchUploadBlob: async (url: string, signal?: AbortSignal): Promise<Blob> => {
    const resolvedUrl = resolveApiUrl(url);
    const response = await fetch(resolvedUrl, {
      headers: { "x-owner-id": ownerId() },
      ...(signal ? { signal } : {})
    });
    if (!response.ok) throw new Error(`Upload fetch failed with status ${response.status}`);
    return response.blob();
  },
  uploadFiles: async (files: File[]): Promise<UploadedAsset[]> => {
    const body = new FormData();
    files.forEach((file) => body.append("files", file));
    let response: Response;
    try {
      response = await fetch(`${API_BASE_URL}/api/uploads`, {
        method: "POST",
        headers: { "x-owner-id": ownerId() },
        body
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Could not reach API at ${API_BASE_URL}/api/uploads: ${message}`);
    }
    if (!response.ok) throw new Error(`Upload failed with status ${response.status}`);
    const payload = await response.json() as { assets: UploadedAsset[] };
    return payload.assets;
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
  listConversations: async (): Promise<ConversationSummary[]> => {
    const payload = await requestJson<{ conversations: ConversationSummary[] }>("/api/chat/conversations");
    return payload.conversations;
  },
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
  deleteConversation: async (conversationId: string): Promise<void> => {
    await requestNoContent(`/api/chat/conversations/${conversationId}`, { method: "DELETE" });
  },
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
