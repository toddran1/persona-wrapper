import { createApp } from "./app.js";
import { env } from "./config/env.js";
import { logger } from "./utils/logger.js";

const app = createApp();

app.listen(env.PORT, () => {
  logger.info("API server started", {
    port: env.PORT,
    nodeEnv: env.NODE_ENV
  });
});

