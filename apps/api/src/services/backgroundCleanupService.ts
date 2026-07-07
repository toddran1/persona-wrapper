import { env } from "../config/env.js";
import { logger } from "../utils/logger.js";
import { generatedAudioService } from "./generatedAudioService.js";
import { generatedMediaService } from "./generatedMediaService.js";
import { openAIArtifactService } from "./openAIArtifactService.js";
import { uploadService } from "./uploadService.js";

export class BackgroundCleanupService {
  private interval: NodeJS.Timeout | undefined;
  private running = false;

  start(): void {
    if (this.interval || env.STORAGE_CLEANUP_INTERVAL_MS <= 0) return;
    void this.runOnce();
    this.interval = setInterval(() => void this.runOnce(), env.STORAGE_CLEANUP_INTERVAL_MS);
    this.interval.unref();
    logger.info("Storage cleanup job started", {
      intervalMs: env.STORAGE_CLEANUP_INTERVAL_MS
    });
  }

  stop(): void {
    if (!this.interval) return;
    clearInterval(this.interval);
    this.interval = undefined;
  }

  async runOnce(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      await Promise.all([
        uploadService.cleanupExpiredNow(),
        generatedMediaService.cleanupExpiredNow(),
        generatedAudioService.cleanupExpiredNow(),
        openAIArtifactService.cleanupExpiredNow()
      ]);
    } catch (error) {
      logger.warn("Storage cleanup job failed", {
        error: error instanceof Error ? error.message : String(error)
      });
    } finally {
      this.running = false;
    }
  }
}

export const backgroundCleanupService = new BackgroundCleanupService();
