import { PgBoss, type Job, type SendOptions } from "pg-boss";
import { env } from "../config/env.js";
import { logger } from "../utils/logger.js";

type QueueHandler<T extends object> = (job: Job<T>) => Promise<void>;

class JobQueueService {
  private boss: PgBoss | undefined;
  private startPromise: Promise<PgBoss | undefined> | undefined;

  get enabled(): boolean {
    return Boolean(env.DATABASE_URL);
  }

  async start(): Promise<PgBoss | undefined> {
    if (!this.enabled) return undefined;
    if (this.startPromise) return this.startPromise;

    this.startPromise = (async () => {
      const boss = new PgBoss(env.DATABASE_URL as string);
      boss.on("error", (error) => {
        logger.error("pg-boss error", { error: error.message });
      });
      await boss.start();
      this.boss = boss;
      logger.info("Durable job queue started");
      return boss;
    })();
    return this.startPromise;
  }

  async work<T extends object>(queue: string, handler: QueueHandler<T>): Promise<void> {
    const boss = await this.start();
    if (!boss) return;
    await boss.createQueue(queue, {
      retryLimit: 3,
      retryDelay: 5,
      retryBackoff: true,
      expireInSeconds: 30 * 60,
      retentionSeconds: 24 * 60 * 60
    });
    await boss.work<T>(queue, { batchSize: 1 }, async ([job]) => {
      if (job) await handler(job);
    });
  }

  async send<T extends object>(queue: string, data: T, options: SendOptions = {}): Promise<string> {
    const boss = await this.start();
    if (!boss) throw new Error("Durable job queue is not configured.");
    const id = await boss.send(queue, data, options);
    if (!id) throw new Error(`Could not enqueue ${queue} job.`);
    return id;
  }

  async schedule(queue: string, cron: string, data: object = {}): Promise<void> {
    const boss = await this.start();
    if (!boss) return;
    await boss.schedule(queue, cron, data, { tz: "UTC" });
  }

  async cancel(queue: string, queueJobId: string): Promise<void> {
    const boss = await this.start();
    if (!boss) return;
    await boss.cancel(queue, queueJobId);
  }

  async findQueueJobId(queue: string, appJobId: string): Promise<string | undefined> {
    const boss = await this.start();
    if (!boss) return undefined;
    const jobs = await boss.findJobs<{ appJobId: string }>(queue, { data: { appJobId } });
    return jobs[0]?.id;
  }

  async stop(): Promise<void> {
    if (!this.boss) return;
    await this.boss.stop({ graceful: true, timeout: env.API_SHUTDOWN_TIMEOUT_MS });
    this.boss = undefined;
    this.startPromise = undefined;
  }
}

export const jobQueueService = new JobQueueService();
