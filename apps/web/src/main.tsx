import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClientProvider } from "@tanstack/react-query";
import { App } from "./App.js";
import { AppErrorBoundary } from "./components/AppErrorBoundary.js";
import { PublicLegalPage, PUBLIC_PAGE_PATHS } from "./components/PublicLegalPage.js";
import { MobileOAuthReturnPage } from "./components/MobileOAuthReturnPage.js";
import { installClientCrashReporting } from "./lib/telemetry.js";
import "./styles.css";
import { queryClient } from "./lib/queryClient.js";

installClientCrashReporting();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <AppErrorBoundary>
        {window.location.pathname === "/auth/mobile-callback"
          ? <MobileOAuthReturnPage />
          : PUBLIC_PAGE_PATHS.has(window.location.pathname.replace(/\/$/, "") || "/")
          ? <PublicLegalPage path={window.location.pathname.replace(/\/$/, "")} />
          : <App />}
      </AppErrorBoundary>
    </QueryClientProvider>
  </React.StrictMode>
);
