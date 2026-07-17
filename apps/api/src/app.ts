import cors from "cors";
import type { CorsOptions } from "cors";
import express, { type NextFunction, type Request, type Response } from "express";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import multer from "multer";
import { ZodError } from "zod";
import { authenticateRequest } from "./middleware/authMiddleware.js";
import { authRouter } from "./routes/auth.routes.js";
import { chatRouter } from "./routes/chat.routes.js";
import { personaRouter } from "./routes/persona.routes.js";
import { uploadRouter } from "./routes/upload.routes.js";
import { dataTransferRouter } from "./routes/dataTransfer.routes.js";
import { observabilityRouter } from "./routes/observability.routes.js";
import { getGeneratedAudio } from "./controllers/generatedAudio.controller.js";
import { getGeneratedMedia } from "./controllers/generatedMedia.controller.js";
import { getOpenAIArtifact } from "./controllers/openAIArtifact.controller.js";
import { env } from "./config/env.js";
import { storageService } from "./services/storageService.js";
import { HttpError } from "./utils/httpError.js";
import { logger } from "./utils/logger.js";
import { recordMetric, traceIdFromRequest, withObservabilityContext } from "./utils/observability.js";
import { finishHttpRequestSpan, runWithTelemetrySpan, startHttpRequestSpan } from "./utils/telemetry.js";

function findRepoRoot(startDir: string): string {
  let current = startDir;

  for (let depth = 0; depth < 8; depth += 1) {
    const packageJsonPath = resolve(current, "package.json");
    if (existsSync(packageJsonPath)) {
      try {
        const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8")) as { name?: string };
        if (packageJson.name === "persona-wrapper-app") return current;
      } catch {
        // Keep walking if this is not the repo root package.json.
      }
    }

    const parent = resolve(current, "..");
    if (parent === current) break;
    current = parent;
  }

  return process.cwd();
}

export function notFoundHandler(_request: Request, response: Response): void {
  response.status(404).json({
    error: "Route not found.",
    code: "NOT_FOUND",
    requestId: response.locals.requestId
  });
}

function isDatabaseUnavailable(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const code = "code" in error && typeof error.code === "string" ? error.code : undefined;
  if (code && ["ECONNREFUSED", "ECONNRESET", "ETIMEDOUT", "CONNECTION_CLOSED"].includes(code)) {
    return true;
  }
  const message = "message" in error && typeof error.message === "string" ? error.message : "";
  return /database connection|connect (econnrefused|etimedout)|connection (closed|refused|terminated)/i.test(message);
}

function requireAuthenticatedRequest(request: Request, _response: Response, next: NextFunction): void {
  if (request.auth) {
    next();
    return;
  }
  next(new HttpError("Authentication required.", 401));
}

export function apiErrorHandler(error: unknown, request: Request, response: Response, next: NextFunction): void {
  if (response.headersSent) {
    next(error);
    return;
  }
  const requestId = response.locals.requestId as string | undefined;
  if (error instanceof multer.MulterError) {
    response.status(error.code === "LIMIT_FILE_SIZE" ? 413 : 400).json({ error: error.message, code: error.code, requestId });
    return;
  }
  if (error instanceof ZodError) {
    response.status(400).json({ error: "Validation failed", details: error.flatten(), requestId });
    return;
  }
  if (error instanceof HttpError) {
    response.status(error.statusCode).json({ error: error.message, requestId });
    return;
  }

  const errorStatus = typeof error === "object" && error !== null && "status" in error && typeof error.status === "number"
    ? error.status
    : undefined;
  if (errorStatus === 400) {
    response.status(400).json({ error: "Malformed request body.", code: "BAD_REQUEST", requestId });
    return;
  }
  if (errorStatus === 413) {
    response.status(413).json({ error: "Request body is too large.", code: "PAYLOAD_TOO_LARGE", requestId });
    return;
  }
  if (error instanceof Error && error.message.startsWith("CORS origin not allowed:")) {
    response.status(403).json({ error: "Origin not allowed.", code: "CORS_ORIGIN_DENIED", requestId });
    return;
  }
  if (isDatabaseUnavailable(error)) {
    logger.error("Database connection unavailable", {
      requestId,
      method: request.method,
      path: request.path,
      error: error instanceof Error ? { name: error.name, message: error.message } : String(error)
    });
    response.status(503).json({
      error: "The service is temporarily unavailable. Please try again shortly.",
      code: "DATABASE_UNAVAILABLE",
      requestId
    });
    return;
  }

  logger.error("Unhandled API error", {
    requestId,
    method: request.method,
    path: request.path,
    error: error instanceof Error ? { name: error.name, message: error.message, stack: error.stack } : String(error)
  });
  response.status(500).json({
    error: "Something went wrong on the server. Please try again.",
    code: "INTERNAL_SERVER_ERROR",
    requestId
  });
}

export function createApp() {
  const app = express();
  const personaAssetsRoot = resolve(findRepoRoot(process.cwd()), "apps/web/public/personas");

  if (env.API_TRUST_PROXY_HOPS > 0) {
    app.set("trust proxy", env.API_TRUST_PROXY_HOPS);
  }

  const allowedOrigins = env.CORS_ALLOWED_ORIGINS
    ?.split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
  const corsOptions: CorsOptions = {
    origin(origin, callback) {
      if (!origin) {
        callback(null, true);
        return;
      }
      if (!allowedOrigins || allowedOrigins.length === 0 || allowedOrigins.includes(origin)) {
        callback(null, true);
        return;
      }
      callback(new Error(`CORS origin not allowed: ${origin}`));
    },
    methods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    // Every first-party client adds this correlation header for observability.
    // Keep it in the preflight allow-list or browsers reject requests before
    // they reach the API.
    allowedHeaders: ["Authorization", "Content-Type", "x-client-type", "x-owner-id", "x-client-trace-id"],
    optionsSuccessStatus: 204
  };
  app.disable("x-powered-by");
  app.use((request, response, next) => {
    const suppliedRequestId = request.header("x-request-id")?.trim();
    const requestId = suppliedRequestId && /^[a-zA-Z0-9._-]{1,100}$/.test(suppliedRequestId)
      ? suppliedRequestId
      : randomUUID();
    response.locals.requestId = requestId;
    const traceId = traceIdFromRequest(request.header("x-client-trace-id"));
    const startedAt = performance.now();
    response.setHeader("X-Request-Id", requestId);
    response.setHeader("X-Trace-Id", traceId);
    const telemetrySpan = startHttpRequestSpan(request.method, traceId);
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("X-Frame-Options", "DENY");
    response.setHeader("Referrer-Policy", "no-referrer");
    response.setHeader("Permissions-Policy", "camera=(), geolocation=(), microphone=()");
    response.setHeader("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'");
    if (env.NODE_ENV === "production") {
      response.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
    }
    response.once("finish", () => {
      const durationMs = performance.now() - startedAt;
      const route = request.route?.path ? `${request.baseUrl}${request.route.path}` : "unmatched";
      const outcome = response.statusCode >= 500 ? "failure" : "success";
      recordMetric("http.server.request", {
        durationMs,
        outcome,
        attributes: { method: request.method, route, status: response.statusCode }
      });
      finishHttpRequestSpan(telemetrySpan, { route, status: response.statusCode, durationMs });
      if (response.statusCode >= 500 || durationMs >= 5000) {
        logger[response.statusCode >= 500 ? "error" : "warn"]("API request completed", {
          requestId,
          traceId,
          method: request.method,
          route,
          status: response.statusCode,
          durationMs: Math.round(durationMs)
        });
      }
    });
    runWithTelemetrySpan(telemetrySpan, () => withObservabilityContext({ requestId, traceId }, next));
  });
  app.use(cors(corsOptions));
  app.options("*", cors(corsOptions));
  app.use("/api/data", authenticateRequest, requireAuthenticatedRequest, express.json({ limit: env.DATA_TRANSFER_MAX_BYTES }), dataTransferRouter);
  app.use(express.json({ limit: env.API_JSON_MAX_BYTES }));
  app.use(authenticateRequest);

  app.get("/health", (_request, response) => {
    response.status(200).json({ status: "ok" });
  });
  app.use("/personas", express.static(personaAssetsRoot, {
    fallthrough: false,
    immutable: true,
    maxAge: "1d"
  }));

  app.get("/health/storage", (_request: Request, response: Response, next: NextFunction) => {
    if (env.NODE_ENV === "production" && !_request.auth) {
      response.status(401).json({ error: "Authentication required." });
      return;
    }
    void storageService.healthCheck()
      .then((storage) => {
        response.status(storage.ok ? 200 : 503).json({ status: storage.ok ? "ok" : "error", storage });
      })
      .catch(next);
  });

  app.use("/api/auth", authRouter);
  app.use("/api/observability", observabilityRouter);
  app.use("/api/chat", chatRouter);
  app.use("/api/personas", personaRouter);
  app.use("/api/uploads", uploadRouter);
  app.get("/api/generated-audio/:token", (request, response, next) => {
    getGeneratedAudio(request, response).catch(next);
  });
  app.get("/api/generated-media/:fileName", (request, response, next) => {
    getGeneratedMedia(request, response).catch(next);
  });
  app.get("/api/openai-artifacts/:token", (request, response, next) => {
    getOpenAIArtifact(request, response).catch(next);
  });

  app.use(notFoundHandler);
  app.use(apiErrorHandler);

  return app;
}
