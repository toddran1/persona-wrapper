import { createAuthClient } from "better-auth/react";
import { usernameClient } from "better-auth/client/plugins";

const configuredApiBaseUrl = typeof import.meta.env.VITE_API_URL === "string" ? import.meta.env.VITE_API_URL.trim() : "";

export const authClient = createAuthClient({
  baseURL: configuredApiBaseUrl || "http://localhost:4000",
  fetchOptions: {
    credentials: "include",
    headers: { "x-client-type": "web" }
  },
  plugins: [usernameClient()]
});
