import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./App.js";
import { AppErrorBoundary } from "./components/AppErrorBoundary.js";
import { PublicLegalPage, PUBLIC_PAGE_PATHS } from "./components/PublicLegalPage.js";
import "./styles.css";

window.addEventListener("error", (event) => {
  console.error("Unhandled web error", event.error ?? event.message);
});

window.addEventListener("unhandledrejection", (event) => {
  console.error("Unhandled web promise rejection", event.reason);
});

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <AppErrorBoundary>
      {PUBLIC_PAGE_PATHS.has(window.location.pathname.replace(/\/$/, "") || "/")
        ? <PublicLegalPage path={window.location.pathname.replace(/\/$/, "")} />
        : <App />}
    </AppErrorBoundary>
  </React.StrictMode>
);
