import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes("node_modules")) return undefined;
          if (id.includes("recharts")) return "charts";
          if (/(?:react-markdown|remark-gfm|remark-|rehype-|unified|micromark|mdast|hast|vfile)/.test(id)) {
            return "markdown";
          }
          if (id.includes("react-router")) return "router";
          if (id.includes("@tanstack/react-query")) return "query";
          if (id.includes("better-auth") || id.includes("@ts-rest")) return "api-client";
          return "vendor";
        }
      }
    }
  },
  server: {
    port: 5173
  },
  test: {
    environment: "jsdom",
    setupFiles: "./src/test/setup.ts"
  }
});
