import { env } from "../config/env.js";
import { logger } from "../utils/logger.js";
import { importAppleSigningKey } from "./appleOAuthService.js";

export const appleSigningKey = env.APPLE_OAUTH_PRIVATE_KEY
  ? await importAppleSigningKey(env.APPLE_OAUTH_PRIVATE_KEY).catch((error: unknown) => {
    logger.error("Apple sign-in is disabled because its private key is invalid.", {
      error: error instanceof Error ? error.message : "Invalid APPLE_OAUTH_PRIVATE_KEY."
    });
    return undefined;
  })
  : undefined;

export const appleOAuthAvailable = Boolean(
  env.APPLE_OAUTH_CLIENT_ID
  && env.APPLE_OAUTH_TEAM_ID
  && env.APPLE_OAUTH_KEY_ID
  && appleSigningKey
);
