import { context, metrics, SpanStatusCode, trace, type Attributes, type Counter, type Histogram, type Span } from "@opentelemetry/api";
import { logs, SeverityNumber } from "@opentelemetry/api-logs";
import { OTLPLogExporter } from "@opentelemetry/exporter-logs-otlp-proto";
import { OTLPMetricExporter } from "@opentelemetry/exporter-metrics-otlp-proto";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-proto";
import { BatchLogRecordProcessor } from "@opentelemetry/sdk-logs";
import { PeriodicExportingMetricReader } from "@opentelemetry/sdk-metrics";
import { NodeSDK } from "@opentelemetry/sdk-node";

type TelemetryLevel = "info" | "warn" | "error";
type TelemetryConfiguration = {
  endpoint: string | undefined;
  serviceName: string;
};

const instrumentationName = "for-the-baddiez-api";
const safeLogAttributeKeys = new Set([
  "durationMs",
  "errorName",
  "event",
  "exitCode",
  "method",
  "mode",
  "nodeEnv",
  "operation",
  "path",
  "port",
  "provider",
  "reason",
  "requestId",
  "route",
  "status",
  "traceId"
]);

let sdk: NodeSDK | undefined;
let telemetryEnabled = false;
let operationCounter: Counter | undefined;
let operationFailureCounter: Counter | undefined;
let operationDuration: Histogram | undefined;

function safeAttribute(value: unknown): string | number | boolean | undefined {
  if (typeof value === "string") return value.slice(0, 160);
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "boolean") return value;
  return undefined;
}

export function telemetryAttributes(values: Record<string, unknown>): Attributes {
  return Object.fromEntries(Object.entries(values).flatMap(([key, value]) => {
    const safe = safeAttribute(value);
    return safe === undefined ? [] : [[key, safe]];
  }));
}

function logAttributes(payload: unknown): Attributes {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return {};
  const attributes: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(payload)) {
    if (key === "attributes" && value && typeof value === "object" && !Array.isArray(value)) {
      for (const [attributeKey, attributeValue] of Object.entries(value)) {
        const safe = safeAttribute(attributeValue);
        if (safe !== undefined) attributes[`operation.${attributeKey}`] = safe;
      }
      continue;
    }
    if (!safeLogAttributeKeys.has(key)) continue;
    const safe = safeAttribute(value);
    if (safe !== undefined) attributes[key] = safe;
  }
  return attributes;
}

export function initializeTelemetry(configuration: TelemetryConfiguration): void {
  if (sdk || !configuration.endpoint?.trim()) return;
  try {
    sdk = new NodeSDK({
      serviceName: configuration.serviceName,
      traceExporter: new OTLPTraceExporter(),
      metricReaders: [new PeriodicExportingMetricReader({
        exporter: new OTLPMetricExporter(),
        exportIntervalMillis: 60_000
      })],
      logRecordProcessors: [new BatchLogRecordProcessor({ exporter: new OTLPLogExporter() })]
    });
    sdk.start();

    const meter = metrics.getMeter(instrumentationName);
    operationCounter = meter.createCounter("app_operation_count", {
      description: "Number of application operations"
    });
    operationFailureCounter = meter.createCounter("app_operation_failure_count", {
      description: "Number of failed application operations"
    });
    operationDuration = meter.createHistogram("app_operation_duration_ms", {
      description: "Application operation duration in milliseconds",
      unit: "ms"
    });
    telemetryEnabled = true;
  } catch (error) {
    sdk = undefined;
    telemetryEnabled = false;
    console.error(JSON.stringify({
      timestamp: new Date().toISOString(),
      level: "error",
      message: "Failed to initialize OpenTelemetry",
      payload: { errorName: error instanceof Error ? error.name : "UnknownError" }
    }));
  }
}

export async function shutdownTelemetry(): Promise<void> {
  const activeSdk = sdk;
  sdk = undefined;
  telemetryEnabled = false;
  if (activeSdk) await activeSdk.shutdown();
}

export function recordPersistentMetric(name: string, options: {
  durationMs?: number;
  outcome?: "success" | "failure";
  attributes?: Record<string, unknown>;
}): void {
  if (!telemetryEnabled) return;
  const attributes = telemetryAttributes({ operation: name, ...(options.attributes ?? {}) });
  operationCounter?.add(1, attributes);
  if (options.outcome === "failure") operationFailureCounter?.add(1, attributes);
  if (options.durationMs !== undefined) operationDuration?.record(Math.max(0, options.durationMs), attributes);
}

export async function traceOperation<T>(
  name: string,
  attributes: Record<string, unknown>,
  operation: () => Promise<T>
): Promise<T> {
  if (!telemetryEnabled) return operation();
  return trace.getTracer(instrumentationName).startActiveSpan(name, {
    attributes: telemetryAttributes(attributes)
  }, async (span) => {
    try {
      const result = await operation();
      span.setStatus({ code: SpanStatusCode.OK });
      return result;
    } catch (error) {
      span.setStatus({ code: SpanStatusCode.ERROR, message: error instanceof Error ? error.name : "UnknownError" });
      span.recordException({
        name: error instanceof Error ? error.name : "UnknownError",
        message: "Operation failed"
      });
      throw error;
    } finally {
      span.end();
    }
  });
}

export function startHttpRequestSpan(method: string, traceId: string): Span | undefined {
  if (!telemetryEnabled) return undefined;
  return trace.getTracer(instrumentationName).startSpan(`HTTP ${method}`, {
    attributes: telemetryAttributes({
      "http.request.method": method,
      "app.trace_id": traceId
    })
  });
}

export function runWithTelemetrySpan<T>(span: Span | undefined, callback: () => T): T {
  if (!span) return callback();
  return context.with(trace.setSpan(context.active(), span), callback);
}

export function finishHttpRequestSpan(span: Span | undefined, options: {
  route: string;
  status: number;
  durationMs: number;
}): void {
  if (!span) return;
  span.setAttributes(telemetryAttributes({
    "http.route": options.route,
    "http.response.status_code": options.status,
    "http.server.request.duration_ms": Math.max(0, options.durationMs)
  }));
  span.setStatus({ code: options.status >= 500 ? SpanStatusCode.ERROR : SpanStatusCode.OK });
  span.end();
}

export function emitTelemetryLog(level: TelemetryLevel, message: string, payload?: unknown): void {
  if (!telemetryEnabled) return;
  const severityNumber = level === "error"
    ? SeverityNumber.ERROR
    : level === "warn"
      ? SeverityNumber.WARN
      : SeverityNumber.INFO;
  logs.getLogger(instrumentationName).emit({
    severityNumber,
    severityText: level.toUpperCase(),
    body: message.slice(0, 300),
    attributes: logAttributes(payload)
  });
}
