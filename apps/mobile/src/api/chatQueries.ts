import { queryOptions } from "@tanstack/react-query";
import { api } from "./client";

export const personasQueryOptions = () => queryOptions({
  queryKey: ["personas"],
  queryFn: () => api.getPersonas(),
  staleTime: 5 * 60_000
});

export const personaQueryOptions = (id: string) => queryOptions({
  queryKey: ["personas", id],
  queryFn: () => api.getPersona(id),
  staleTime: 5 * 60_000
});

export const conversationsPageQueryOptions = (cursor?: string, query?: string) => queryOptions({
  queryKey: ["conversations", { cursor: cursor ?? null, query: query ?? null }],
  queryFn: () => api.listConversationsPage(cursor, 50, query)
});

export const conversationTurnsQueryOptions = (conversationId: string, cursor?: string) => queryOptions({
  queryKey: ["conversation-turns", conversationId, cursor ?? null],
  queryFn: () => api.getConversationTurnsPage(conversationId, cursor)
});
