import { queryOptions } from "@tanstack/react-query";
import { api } from "./client";

export const personasQueryOptions = (accountId = "anonymous") => queryOptions({
  queryKey: ["personas", "catalog-v2", accountId],
  queryFn: () => api.getPersonas(),
  staleTime: 5 * 60_000,
  refetchOnMount: "always"
});

export const personaQueryOptions = (id: string, accountId = "anonymous") => queryOptions({
  queryKey: ["personas", "detail", accountId, id],
  queryFn: () => api.getPersona(id),
  staleTime: 5 * 60_000
});

export const conversationsPageQueryOptions = (cursor?: string, query?: string, accountId = "anonymous") => queryOptions({
  queryKey: ["conversations", accountId, "keyset-v1", { cursor: cursor ?? null, query: query ?? null }],
  queryFn: () => api.listConversationsPage(cursor, 50, query)
});

export const conversationTurnsQueryOptions = (conversationId: string, cursor?: string, accountId = "anonymous") => queryOptions({
  queryKey: ["conversation-turns", accountId, conversationId, cursor ?? null],
  queryFn: () => api.getConversationTurnsPage(conversationId, cursor)
});
