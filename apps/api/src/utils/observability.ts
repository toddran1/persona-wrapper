import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { logger } from "./logger.js";

type ObservabilityContext = { requestId?: string; traceId?: string };
type MetricRecord = {
  count: number;
  failures: number;
  totalDurationMs: number;
  maxDurationMs: number;
  lastUpdatedAt: string;
  attributes: Record<string, string>;
};

const context = new AsyncLocalStorage<ObservabilityContext>();
const metrics = new Map<string, MetricRecord>();
const MAX_METRICS = 500;

function safeAttribute(value: unknown): string | undefined {
  if (typeof value !== "string" && typeof value !== "number" && typeof value !== "boolean") return undefined;
  return String(value).slice(0, 120);
}

function metricKey(name: string, attributes: Record<string, unknown>): { key: string; attributes: Record<string, string> } {
  const normalized = Object.fromEntries(Object.entries(attributes)
    .flatMap(([key, value]) => {
      const safe = safeAttribute(value);
      return safe === undefined ? [] : [[key, safe]];
    })
    .sort((left, right) => (left[0] ?? "").localeCompare(right[0] ?? "")));
  return { key: `${name}|${JSON.stringify(normalized)}`, attributes: normalized };
}

export function withObservabilityContext<T>(value: ObservabilityContext, callback: () => T): T {
  return context.run(value, callback);
}

export function observabilityContext(): ObservabilityContext {
  return context.getStore() ?? {};
}

export function traceIdFromRequest(value: string | undefined): string {
  const candidate = value?.trim();
  return candidate && /^[a-zA-Z0-9_-]{16,128}$/.test(candidate) ? candidate : randomUUID();
}

export function recordMetric(name: string, options: {
  durationMs?: number;
  outcome?: "success" | "failure";
  attributes?: Record<string, unknown>;
} = {}): void {
  const { key, attributes } = metricKey(name, options.attributes ?? {});
  const current = metrics.get(key) ?? {
    count: 0,
    failures: 0,
    totalDurationMs: 0,
    maxDurationMs: 0,
    lastUpdatedAt: new Date().toISOString(),
    attributes
  };
  const durationMs = Math.max(0, Math.round(options.durationMs ?? 0));
  current.count += 1;
  current.failures += options.outcome === "failure" ? 1 : 0;
  current.totalDurationMs += durationMs;
  current.maxDurationMs = Math.max(current.maxDurationMs, durationMs);
  current.lastUpdatedAt = new Date().toISOString();
  metrics.set(key, current);

  if (metrics.size > MAX_METRICS) {
    const oldest = metrics.keys().next().value;
    if (oldest) metrics.delete(oldest);
  }
}

export async function measureOperation<T>(name: string, attributes: Record<string, unknown>, operation: () => Promise<T>): Promise<T> {
  const startedAt = performance.now();
  try {
    const result = await operation();
    recordMetric(name, { durationMs: performance.now() - startedAt, attributes });
    return result;
  } catch (error) {
    const durationMs = performance.now() - startedAt;
    recordMetric(name, { durationMs, outcome: "failure", attributes });
    logger.warn("Observed operation failed", {
      operation: name,
      durationMs: Math.round(durationMs),
      attributes,
      errorName: error instanceof Error ? error.name : "UnknownError"
    });
    throw error;
  }
}

export function observabilitySnapshot(): { generatedAt: string; metrics: Array<MetricRecord & { name: string; averageDurationMs: number }> } {
  return {
    generatedAt: new Date().toISOString(),
    metrics: [...metrics.entries()].map(([key, metric]) => ({
      name: key.slice(0, key.indexOf("|")),
      ...metric,
      averageDurationMs: metric.count ? Math.round(metric.totalDurationMs / metric.count) : 0
    })).sort((left, right) => right.lastUpdatedAt.localeCompare(left.lastUpdatedAt))
  };
}
