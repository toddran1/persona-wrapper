import { createApp } from "./app.js";
import { env } from "./config/env.js";
import { closeDatabase } from "./db/client.js";
import { backgroundCleanupService } from "./services/backgroundCleanupService.js";
import { backgroundChatJobService } from "./services/backgroundChatJobService.js";
import { jobQueueService } from "./services/jobQueueService.js";
import { logger } from "./utils/logger.js";
import { initializeTelemetry, shutdownTelemetry } from "./utils/telemetry.js";

initializeTelemetry({ endpoint: env.OTEL_EXPORTER_OTLP_ENDPOINT, serviceName: env.OTEL_SERVICE_NAME });
const app = createApp();
let shuttingDown = false;

await backgroundChatJobService.startWorker();
await backgroundCleanupService.start();
const server = app.listen(env.PORT, () => {
  logger.info("API server started", {
    port: env.PORT,
    nodeEnv: env.NODE_ENV
  });
});
server.requestTimeout = env.API_REQUEST_TIMEOUT_MS;
server.headersTimeout = env.API_HEADERS_TIMEOUT_MS;
server.keepAliveTimeout = env.API_KEEP_ALIVE_TIMEOUT_MS;

const shutdown = (reason: string, exitCode = 0): void => {
  if (shuttingDown) return;
  shuttingDown = true;
  process.exitCode = exitCode;
  logger.info("API server shutting down", { reason, exitCode });
  backgroundCleanupService.stop();

  const forceExitTimer = setTimeout(() => {
    logger.error("API shutdown timed out", { reason, timeoutMs: env.API_SHUTDOWN_TIMEOUT_MS });
    process.exit(exitCode || 1);
  }, env.API_SHUTDOWN_TIMEOUT_MS);
  forceExitTimer.unref();

  server.close(async () => {
    let shutdownFailed = false;
    try {
      await jobQueueService.stop();
      await closeDatabase();
    } catch (error) {
      shutdownFailed = true;
      logger.error("Failed to close database during shutdown", error);
    }
    try {
      await shutdownTelemetry();
    } catch (error) {
      shutdownFailed = true;
      logger.error("Failed to flush telemetry during shutdown", {
        errorName: error instanceof Error ? error.name : "UnknownError"
      });
    }
    if (shutdownFailed) process.exitCode = 1;
    clearTimeout(forceExitTimer);
    process.exit(process.exitCode ?? exitCode);
  });
};

server.on("error", (error) => {
  logger.error("API server error", error);
  shutdown("server_error", 1);
});

server.on("clientError", (error, socket) => {
  logger.warn("Malformed client connection", { message: error.message });
  if (socket.writable) socket.end("HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n");
});

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("unhandledRejection", (reason) => {
  logger.error("Unhandled promise rejection", reason);
  shutdown("unhandled_rejection", 1);
});
process.on("uncaughtException", (error) => {
  logger.error("Uncaught exception", error);
  shutdown("uncaught_exception", 1);
});
