import AsyncStorage from "@react-native-async-storage/async-storage";
import { createAsyncStoragePersister } from "@tanstack/query-async-storage-persister";
import {
  persistQueryClientRestore,
  persistQueryClientSubscribe
} from "@tanstack/react-query-persist-client";
import type { Query, QueryClient } from "@tanstack/react-query";

const CACHE_BUSTER = "mobile-query-cache-v2";
const CONVERSATION_CACHE_VERSION = "keyset-v1";
const PUBLIC_CACHE_KEY = "ftb-query-cache:public:v1";
const USER_CACHE_PREFIX = "ftb-query-cache:user:v1:";
const PUBLIC_MAX_AGE = 7 * 24 * 60 * 60_000;
const USER_MAX_AGE = 24 * 60 * 60_000;

function publicQuery(query: Query): boolean {
  if (query.state.status !== "success" || query.queryKey[0] !== "personas") return false;
  // Persona queries are account-scoped once they carry an account id (see
  // chatQueries.ts); only anonymous queries are safe for the shared public
  // bucket that is restored before authentication.
  const accountId = query.queryKey[2];
  return accountId === undefined || accountId === "anonymous";
}

function userQuery(query: Query, userId: string): boolean {
  return query.state.status === "success"
    // Persist summaries for a fast shell, but keep full message content out of
    // unencrypted AsyncStorage. Conversation turns still use the in-memory
    // query cache and are refreshed after authentication.
    && query.queryKey[0] === "conversations"
    && query.queryKey[1] === userId
    && query.queryKey[2] === CONVERSATION_CACHE_VERSION;
}

function persister(key: string) {
  return createAsyncStoragePersister({
    storage: AsyncStorage,
    key,
    throttleTime: 1_000
  });
}

export async function restorePublicQueryCache(queryClient: QueryClient): Promise<void> {
  await persistQueryClientRestore({
    queryClient,
    persister: persister(PUBLIC_CACHE_KEY),
    buster: CACHE_BUSTER,
    maxAge: PUBLIC_MAX_AGE
  });
}

export function subscribePublicQueryCache(queryClient: QueryClient): () => void {
  return persistQueryClientSubscribe({
    queryClient,
    persister: persister(PUBLIC_CACHE_KEY),
    buster: CACHE_BUSTER,
    dehydrateOptions: { shouldDehydrateQuery: publicQuery }
  });
}

export async function restoreUserQueryCache(queryClient: QueryClient, userId: string): Promise<void> {
  await persistQueryClientRestore({
    queryClient,
    persister: persister(`${USER_CACHE_PREFIX}${encodeURIComponent(userId)}`),
    buster: CACHE_BUSTER,
    maxAge: USER_MAX_AGE
  });
}

export function subscribeUserQueryCache(queryClient: QueryClient, userId: string): () => void {
  return persistQueryClientSubscribe({
    queryClient,
    persister: persister(`${USER_CACHE_PREFIX}${encodeURIComponent(userId)}`),
    buster: CACHE_BUSTER,
    dehydrateOptions: { shouldDehydrateQuery: (query) => userQuery(query, userId) }
  });
}

export async function clearUserQueryCache(queryClient: QueryClient, userId: string): Promise<void> {
  queryClient.removeQueries({
    predicate: (query) => userQuery(query, userId)
      || ((query.queryKey[0] === "conversations" || query.queryKey[0] === "conversation-turns") && query.queryKey[1] === userId)
  });
  await persister(`${USER_CACHE_PREFIX}${encodeURIComponent(userId)}`).removeClient();
}
