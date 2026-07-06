import cors from "cors";
import express, { type NextFunction, type Request, type Response } from "express";
import multer from "multer";
import { ZodError } from "zod";
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

export function createApp() {
  const app = express();

  const allowedOrigins = env.CORS_ALLOWED_ORIGINS
    ?.split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
  app.use(cors({
    origin: allowedOrigins && allowedOrigins.length > 0 ? allowedOrigins : undefined
  }));
  app.use(express.json({ limit: "1mb" }));

  app.get("/health", (_request, response) => {
    response.status(200).json({ status: "ok" });
  });

  app.get("/health/storage", (async (_request: Request, response: Response) => {
    const storage = await storageService.healthCheck();
    response.status(storage.ok ? 200 : 503).json({ status: storage.ok ? "ok" : "error", storage });
  }) as express.RequestHandler);

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
    const message = env.NODE_ENV === "production"
      ? "Internal server error"
      : error instanceof Error ? error.message : "Internal server error";
    response.status(500).json({ error: message });
  });

  return app;
}
