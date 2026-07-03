import { createApp } from "./app.js";
import { env } from "./config/env.js";
import { closeDatabase } from "./db/client.js";
import { logger } from "./utils/logger.js";

const app = createApp();

const server = app.listen(env.PORT, () => {
  logger.info("API server started", {
    port: env.PORT,
    nodeEnv: env.NODE_ENV
  });
});

const shutdown = async (signal: NodeJS.Signals) => {
  logger.info("API server shutting down", { signal });
  server.close(async () => {
    await closeDatabase();
    process.exit(0);
  });
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
