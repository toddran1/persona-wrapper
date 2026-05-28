import type { ChatResponse, ClientContext, PersonaDefinition, PersonaSummary, ProviderId } from "@persona/shared";

const API_BASE_URL = import.meta.env.VITE_API_URL ?? "http://localhost:4000";

export type ChatPayload = {
  personaId: string;
  message: string;
  provider: ProviderId;
  audio: boolean;
  testMode?: boolean;
  conversationId?: string;
  clientContext?: ClientContext;
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
  const response = await fetch(`${API_BASE_URL}${path}`, {
    headers: {
      "Content-Type": "application/json"
    },
    ...init
  });

  if (!response.ok) {
    throw new Error(`Request failed with status ${response.status}`);
  }

  return response.json() as Promise<T>;
}

export const api = {
  getPersonas: async (): Promise<PersonaSummary[]> => {
    const payload = await requestJson<{ personas: PersonaSummary[] }>("/api/personas");
    return payload.personas;
  },
  getPersona: async (id: string): Promise<PersonaDefinition> => {
    const payload = await requestJson<{ persona: PersonaDefinition }>(`/api/personas/${id}`);
    return payload.persona;
  },
  sendChat: async (payload: ChatPayload): Promise<ChatResponse> =>
    requestJson<ChatResponse>("/api/chat", {
      method: "POST",
      body: JSON.stringify(payload)
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
