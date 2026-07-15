import type { Request, Response } from "express";
import { z } from "zod";
import { env } from "../config/env.js";
import { HttpError } from "../utils/httpError.js";
import { logger } from "../utils/logger.js";
import { observabilitySnapshot, recordMetric } from "../utils/observability.js";

const clientEventSchema = z.object({
  name: z.enum(["client_error", "client_promise_rejection", "client_render_error", "client_api_request"]),
  level: z.enum(["error", "warn", "info"]).default("info"),
  message: z.string().min(1).max(500),
  path: z.string().max(300).optional(),
  traceId: z.string().regex(/^[a-zA-Z0-9_-]{16,128}$/).optional(),
  durationMs: z.number().min(0).max(15 * 60 * 1000).optional(),
  status: z.number().int().min(0).max(599).optional()
});

function requiresDashboardToken(request: Request): void {
  if (!env.OBSERVABILITY_DASHBOARD_TOKEN) throw new HttpError("Observability dashboard is not configured.", 404);
  const supplied = request.header("authorization")?.replace(/^Bearer\s+/i, "").trim();
  if (supplied !== env.OBSERVABILITY_DASHBOARD_TOKEN) throw new HttpError("Not authenticated.", 401);
}

export function postClientObservabilityEvent(request: Request, response: Response): void {
  const event = clientEventSchema.parse(request.body);
  recordMetric("client.event", {
    ...(event.durationMs === undefined ? {} : { durationMs: event.durationMs }),
    outcome: event.level === "error" ? "failure" : "success",
    attributes: { event: event.name, path: event.path ?? "unknown", status: event.status ?? 0 }
  });
  logger[event.level]("Client telemetry", {
    event: event.name,
    message: event.message,
    path: event.path,
    traceId: event.traceId,
    durationMs: event.durationMs,
    status: event.status
  });
  response.status(202).end();
}

export function getObservabilityMetrics(request: Request, response: Response): void {
  requiresDashboardToken(request);
  response.status(200).json(observabilitySnapshot());
}
