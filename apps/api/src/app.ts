import cors from "cors";
import type { CorsOptions } from "cors";
import express, { type NextFunction, type Request, type Response } from "express";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import multer from "multer";
import { ZodError } from "zod";
import { authenticateRequest } from "./middleware/authMiddleware.js";
import { authRouter } from "./routes/auth.routes.js";
import { chatRouter } from "./routes/chat.routes.js";
import { personaRouter } from "./routes/persona.routes.js";
import { uploadRouter } from "./routes/upload.routes.js";
import { getGeneratedAudio } from "./controllers/generatedAudio.controller.js";
import { getGeneratedMedia } from "./controllers/generatedMedia.controller.js";
import { getOpenAIArtifact } from "./controllers/openAIArtifact.controller.js";
import { env } from "./config/env.js";
import { storageService } from "./services/storageService.js";
import { HttpError } from "./utils/httpError.js";
import { logger } from "./utils/logger.js";

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

export function createApp() {
  const app = express();
  const personaAssetsRoot = resolve(findRepoRoot(process.cwd()), "apps/web/public/personas");

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
    allowedHeaders: ["Authorization", "Content-Type", "x-client-type", "x-owner-id"],
    optionsSuccessStatus: 204
  };
  app.use(cors(corsOptions));
  app.options("*", cors(corsOptions));
  app.use(express.json({ limit: "1mb" }));

  app.get("/health", (_request, response) => {
    response.status(200).json({ status: "ok" });
  });
  app.use("/personas", express.static(personaAssetsRoot, {
    fallthrough: false,
    immutable: true,
    maxAge: "1d"
  }));

  app.get("/health/storage", (async (_request: Request, response: Response) => {
    const storage = await storageService.healthCheck();
    response.status(storage.ok ? 200 : 503).json({ status: storage.ok ? "ok" : "error", storage });
  }) as express.RequestHandler);

  app.use(authenticateRequest);

  app.use("/api/auth", authRouter);
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

  app.use((error: unknown, _request: Request, response: Response, _next: NextFunction) => {
    if (error instanceof multer.MulterError) {
      response.status(error.code === "LIMIT_FILE_SIZE" ? 413 : 400).json({
        error: error.message,
        code: error.code
      });
      return;
    }
    if (error instanceof ZodError) {
      response.status(400).json({
        error: "Validation failed",
        details: error.flatten()
      });
      return;
    }

    if (error instanceof HttpError) {
      response.status(error.statusCode).json({ error: error.message });
      return;
    }

    logger.error("Unhandled API error", error);
    response.status(500).json({
      error: "Something went wrong on the server. Please try again.",
      code: "INTERNAL_SERVER_ERROR"
    });
  });

  return app;
}
