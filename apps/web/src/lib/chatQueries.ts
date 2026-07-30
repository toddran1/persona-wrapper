import { queryOptions } from "@tanstack/react-query";
import { api } from "./api.js";

export const personasQueryOptions = (accountId = "anonymous") => queryOptions({
  queryKey: ["personas", "catalog-v2", accountId],
  queryFn: () => api.getPersonas(),
  staleTime: 5 * 60_000,
  // The public catalog may become available while a local API deployment is
  // restarting. Always reconcile it when the app mounts instead of preserving
  // a failed query from an already-open development tab.
  refetchOnMount: "always"
});

export const personaQueryOptions = (id: string, accountId = "anonymous") => queryOptions({
  queryKey: ["personas", "detail", accountId, id],
  queryFn: () => api.getPersona(id),
  staleTime: 5 * 60_000,
  refetchOnMount: "always"
});

export const conversationsPageQueryOptions = (cursor?: string, query?: string, accountId = "anonymous") => queryOptions({
  queryKey: ["conversations", accountId, "keyset-v1", { cursor: cursor ?? null, query: query ?? null }],
  queryFn: () => api.listConversationsPage(cursor, 50, query)
});

export const conversationTurnsQueryOptions = (conversationId: string, cursor?: string, accountId = "anonymous") => queryOptions({
  queryKey: ["conversation-turns", accountId, conversationId, cursor ?? null],
  queryFn: () => api.getConversationTurnsPage(conversationId, cursor)
});
