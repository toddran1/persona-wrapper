import { QueryClient } from "@tanstack/react-query";

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      gcTime: 10 * 60_000,
      retry: 2,
      networkMode: "offlineFirst"
    },
    mutations: { retry: 0, networkMode: "online" }
  }
});
