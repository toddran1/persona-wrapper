import OpenAI from "openai";
import { and, eq, lte } from "drizzle-orm";
import { env } from "../config/env.js";
import { getDatabase } from "../db/client.js";
import {
  backgroundJobs,
  conversations,
  generatedAudio,
  generatedMedia,
  openAIArtifacts,
  uploads,
  usageEvents,
  users,
  vectorStores
} from "../db/schema.js";
import { logger } from "../utils/logger.js";
import { storageService } from "./storageService.js";
import { backgroundChatJobService } from "./backgroundChatJobService.js";

function requireDatabase() {
  const db = getDatabase();
  if (!db) throw new Error("Account deletion requires DATABASE_URL.");
  return db;
}

async function deleteStoredObjects(keys: Array<string | null>): Promise<void> {
  const uniqueKeys = [...new Set(keys.filter((key): key is string => Boolean(key)))];
  const results = await Promise.allSettled(uniqueKeys.map((key) => storageService.delete(key)));
  const failed = results.filter((result) => result.status === "rejected");
  if (failed.length > 0) {
    throw new Error(`Could not delete ${failed.length} stored account object(s).`);
  }
}

async function deleteOpenAIResources(
  fileIds: string[],
  vectorStoreIds: string[],
  artifacts: Array<{ fileId: string; containerId: string }>
): Promise<void> {
  if (!env.OPENAI_API_KEY) return;
  const client = new OpenAI({ apiKey: env.OPENAI_API_KEY, timeout: env.OPENAI_REQUEST_TIMEOUT_MS });
  const results = await Promise.allSettled([
    ...fileIds.map((id) => client.files.delete(id)),
    ...vectorStoreIds.map((id) => client.vectorStores.delete(id)),
    ...artifacts.map((artifact) => client.containers.files.delete(artifact.fileId, {
      container_id: artifact.containerId
    }))
  ]);
  const failed = results.filter((result) => {
    if (result.status !== "rejected") return false;
    const status = typeof result.reason === "object" && result.reason !== null && "status" in result.reason
      ? result.reason.status
      : undefined;
    return status !== 404;
  }).length;
  if (failed > 0) {
    throw new Error(`Could not delete ${failed} remote OpenAI account resource(s).`);
  }
}

export class AccountDeletionService {
  async purgeUser(userId: string): Promise<boolean> {
    const db = requireDatabase();
    const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
    if (!user) return false;

    await backgroundChatJobService.cancelForOwner(userId);

    const [ownedUploads, ownedMedia, ownedAudio, ownedArtifacts, ownedVectorStores] = await Promise.all([
      db.select().from(uploads).where(eq(uploads.ownerId, userId)),
      db.select().from(generatedMedia).where(eq(generatedMedia.ownerId, userId)),
      db.select().from(generatedAudio).where(eq(generatedAudio.ownerId, userId)),
      db.select().from(openAIArtifacts).where(eq(openAIArtifacts.ownerId, userId)),
      db.select().from(vectorStores).where(eq(vectorStores.ownerId, userId))
    ]);

    await deleteStoredObjects([
      ...ownedUploads.map((item) => item.storageKey),
      ...ownedMedia.map((item) => item.storageKey),
      ...ownedAudio.map((item) => item.storageKey),
      ...ownedArtifacts.map((item) => item.storageKey)
    ]);
    await deleteOpenAIResources(
      ownedUploads.flatMap((item) => item.openaiFileId ? [item.openaiFileId] : []),
      ownedVectorStores.map((item) => item.id),
      ownedArtifacts.map((item) => ({ fileId: item.fileId, containerId: item.containerId }))
    );

    await db.transaction(async (tx) => {
      await tx.delete(backgroundJobs).where(eq(backgroundJobs.ownerId, userId));
      await tx.delete(openAIArtifacts).where(eq(openAIArtifacts.ownerId, userId));
      await tx.delete(generatedAudio).where(eq(generatedAudio.ownerId, userId));
      await tx.delete(generatedMedia).where(eq(generatedMedia.ownerId, userId));
      await tx.delete(vectorStores).where(eq(vectorStores.ownerId, userId));
      await tx.delete(uploads).where(eq(uploads.ownerId, userId));
      await tx.delete(usageEvents).where(eq(usageEvents.identity, userId));
      await tx.delete(conversations).where(eq(conversations.userId, userId));
      await tx.delete(users).where(eq(users.id, userId));
    });
    logger.info("Account permanently deleted", { userId });
    return true;
  }

  async purgeDueAccounts(now = new Date()): Promise<number> {
    // Local/in-memory development has no persistent accounts to purge. Cleanup
    // should remain usable there instead of reporting a failed maintenance job.
    const db = getDatabase();
    if (!db) return 0;
    const due = await db.select({ id: users.id }).from(users)
      .where(and(eq(users.status, "pending_deletion"), lte(users.deletionScheduledFor, now)));
    let purged = 0;
    for (const user of due) {
      try {
        if (await this.purgeUser(user.id)) purged += 1;
      } catch (error) {
        logger.error("Scheduled account purge failed", {
          userId: user.id,
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }
    return purged;
  }
}

export const accountDeletionService = new AccountDeletionService();
