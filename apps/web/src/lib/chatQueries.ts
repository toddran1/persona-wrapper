import { queryOptions } from "@tanstack/react-query";
import { api } from "./api.js";

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

export const conversationsPageQueryOptions = (cursor?: string, query?: string, accountId = "anonymous") => queryOptions({
  queryKey: ["conversations", accountId, { cursor: cursor ?? null, query: query ?? null }],
  queryFn: () => api.listConversationsPage(cursor, 50, query)
});

export const conversationTurnsQueryOptions = (conversationId: string, cursor?: string, accountId = "anonymous") => queryOptions({
  queryKey: ["conversation-turns", accountId, conversationId, cursor ?? null],
  queryFn: () => api.getConversationTurnsPage(conversationId, cursor)
});
