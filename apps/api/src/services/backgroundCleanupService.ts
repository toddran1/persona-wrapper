import { env } from "../config/env.js";
import { logger } from "../utils/logger.js";
import { generatedAudioService } from "./generatedAudioService.js";
import { generatedMediaService } from "./generatedMediaService.js";
import { openAIArtifactService } from "./openAIArtifactService.js";
import { uploadService } from "./uploadService.js";
import { accountDeletionService } from "./accountDeletionService.js";
import { jobQueueService } from "./jobQueueService.js";
import { usageControlService } from "./usageControlService.js";

const CLEANUP_QUEUE = "storage-cleanup";

export class BackgroundCleanupService {
  private interval: NodeJS.Timeout | undefined;
  private running = false;

  async start(): Promise<void> {
    if (jobQueueService.enabled) {
      await jobQueueService.work(CLEANUP_QUEUE, async () => this.runOnce());
      await jobQueueService.schedule(CLEANUP_QUEUE, env.STORAGE_CLEANUP_CRON);
      await jobQueueService.send(CLEANUP_QUEUE, {}, { singletonKey: "startup-cleanup" });
      logger.info("Storage cleanup job scheduled", { cron: env.STORAGE_CLEANUP_CRON });
      return;
    }
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
        openAIArtifactService.cleanupExpiredNow(),
        usageControlService.cleanupExpiredNow(),
        accountDeletionService.purgeDueAccounts()
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
