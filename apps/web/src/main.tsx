import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { App } from "./App.js";
import { AppErrorBoundary } from "./components/AppErrorBoundary.js";
import { PublicLegalPage, PUBLIC_PAGE_PATHS } from "./components/PublicLegalPage.js";
import { MobileOAuthReturnPage } from "./components/MobileOAuthReturnPage.js";
import { ResetPasswordPage } from "./components/ResetPasswordPage.js";
import { installClientCrashReporting } from "./lib/telemetry.js";
import "./styles.css";
import { queryClient } from "./lib/queryClient.js";

installClientCrashReporting();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <AppErrorBoundary>
        <BrowserRouter>
          <Routes>
            <Route path="/" element={<App />} />
            <Route path="/review" element={<App reviewPage />} />
            <Route path="/auth/mobile-callback" element={<MobileOAuthReturnPage />} />
            <Route path="/reset-password" element={<ResetPasswordPage />} />
            {[...PUBLIC_PAGE_PATHS].map((path) => (
              <Route key={path} path={path} element={<PublicLegalPage path={path} />} />
            ))}
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </BrowserRouter>
      </AppErrorBoundary>
    </QueryClientProvider>
  </React.StrictMode>
);
