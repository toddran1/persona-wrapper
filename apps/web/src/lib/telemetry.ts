const configuredApiBaseUrl = typeof import.meta.env.VITE_API_URL === "string" ? import.meta.env.VITE_API_URL.trim() : "";
const apiBaseUrl = configuredApiBaseUrl || "http://localhost:4000";
const telemetryEnabled = import.meta.env.VITE_TELEMETRY_ENABLED === "true";
const sampleRate = Math.min(1, Math.max(0, Number(import.meta.env.VITE_TELEMETRY_SAMPLE_RATE ?? "0.1") || 0));
const sampled = telemetryEnabled && Math.random() < sampleRate;

type ClientEventName = "client_error" | "client_promise_rejection" | "client_render_error" | "client_api_request";

function traceId(): string {
  return crypto.randomUUID().replaceAll("-", "");
}

function scrubMessage(value: unknown): string {
  const message = value instanceof Error ? value.message : typeof value === "string" ? value : "Unexpected client error";
  return message
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[email]")
    .replace(/(?:Bearer\s+)?[A-Za-z0-9_-]{24,}/g, "[redacted]")
    .slice(0, 500);
}

export function newClientTraceId(): string {
  return traceId();
}

export function logClientEvent(name: ClientEventName, options: {
  level?: "error" | "warn" | "info";
  error?: unknown;
  message?: string;
  durationMs?: number;
  status?: number;
  traceId?: string;
} = {}): void {
  const level = options.level ?? "info";
  const payload = {
    name,
    level,
    message: scrubMessage(options.message ?? options.error),
    path: window.location.pathname,
    traceId: options.traceId,
    durationMs: options.durationMs === undefined ? undefined : Math.round(options.durationMs),
    status: options.status
  };
  console[level === "error" ? "error" : level === "warn" ? "warn" : "info"]("[telemetry]", payload);
  if (!sampled && level !== "error") return;

  const body = JSON.stringify(payload);
  try {
    if (navigator.sendBeacon) {
      navigator.sendBeacon(`${apiBaseUrl}/api/observability/client-events`, new Blob([body], { type: "application/json" }));
      return;
    }
    void fetch(`${apiBaseUrl}/api/observability/client-events`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      keepalive: true
    }).catch(() => undefined);
  } catch {
    // Observability must never affect the user-facing action.
  }
}

export function installClientCrashReporting(): void {
  window.addEventListener("error", (event) => {
    logClientEvent("client_error", { level: "error", error: event.error ?? event.message });
  });
  window.addEventListener("unhandledrejection", (event) => {
    logClientEvent("client_promise_rejection", { level: "error", error: event.reason });
  });
}
