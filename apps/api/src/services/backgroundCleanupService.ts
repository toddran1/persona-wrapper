import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { env } from "../config/env.js";
import { getDatabase } from "../db/client.js";
import { operationalEvents } from "../db/schema.js";
import { logger } from "../utils/logger.js";
import { generatedAudioService } from "./generatedAudioService.js";
import { generatedMediaService } from "./generatedMediaService.js";
import { openAIArtifactService } from "./openAIArtifactService.js";
import { uploadService } from "./uploadService.js";
import { accountDeletionService } from "./accountDeletionService.js";
import { jobQueueService } from "./jobQueueService.js";
import { usageControlService } from "./usageControlService.js";
import { dataTransferJobService } from "./dataTransferJobService.js";
import { customerUsageService } from "./customerUsageService.js";
import { cleanupExpiredAdRewardData } from "./adRewardVerificationService.js";

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
      const tasks = [
        ["uploads", uploadService.cleanupExpiredNow()],
        ["generated media", generatedMediaService.cleanupExpiredNow()],
        ["generated audio", generatedAudioService.cleanupExpiredNow()],
        ["OpenAI artifacts", openAIArtifactService.cleanupExpiredNow()],
        ["usage reservations", usageControlService.cleanupExpiredNow()],
        ["pending customer usage settlements", customerUsageService.drainPendingSettlements()],
        ["customer usage reservations", customerUsageService.cleanupExpiredNow()],
        ["ad reward data", cleanupExpiredAdRewardData()],
        ["scheduled accounts", accountDeletionService.purgeDueAccounts()],
        ["data transfers", dataTransferJobService.cleanupExpiredNow()]
      ] as const;
      const results = await Promise.allSettled(tasks.map(([, task]) => task));
      await Promise.all(results.map(async (result, index) => {
        const task = tasks[index]?.[0] ?? "unknown";
        const database = getDatabase();
        if (result.status === "rejected") {
          const message = result.reason instanceof Error ? result.reason.message : String(result.reason);
          logger.warn("Storage cleanup task failed", {
            task,
            error: message
          });
          if (database) {
            try {
              await database.insert(operationalEvents).values({
                id: `op_${randomUUID()}`,
                kind: "storage_cleanup",
                component: task,
                message: message.slice(0, 4000)
              });
            } catch (persistenceError) {
              logger.warn("Could not persist storage cleanup failure", {
                task,
                error: persistenceError instanceof Error ? persistenceError.message : String(persistenceError)
              });
            }
          }
        } else if (database) {
          try {
            await database.update(operationalEvents).set({ status: "resolved", resolvedAt: new Date() }).where(and(
              eq(operationalEvents.kind, "storage_cleanup"),
              eq(operationalEvents.component, task),
              eq(operationalEvents.status, "failed")
            ));
          } catch (persistenceError) {
            logger.warn("Could not resolve persisted storage cleanup failures", {
              task,
              error: persistenceError instanceof Error ? persistenceError.message : String(persistenceError)
            });
          }
        }
      }));
    } finally {
      this.running = false;
    }
  }
}

export const backgroundCleanupService = new BackgroundCleanupService();
