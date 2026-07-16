import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./App.js";
import { AppErrorBoundary } from "./components/AppErrorBoundary.js";
import { PublicLegalPage, PUBLIC_PAGE_PATHS } from "./components/PublicLegalPage.js";
import { MobileOAuthReturnPage } from "./components/MobileOAuthReturnPage.js";
import { installClientCrashReporting } from "./lib/telemetry.js";
import "./styles.css";

installClientCrashReporting();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <AppErrorBoundary>
      {window.location.pathname === "/auth/mobile-callback"
        ? <MobileOAuthReturnPage />
        : PUBLIC_PAGE_PATHS.has(window.location.pathname.replace(/\/$/, "") || "/")
        ? <PublicLegalPage path={window.location.pathname.replace(/\/$/, "")} />
        : <App />}
    </AppErrorBoundary>
  </React.StrictMode>
);
