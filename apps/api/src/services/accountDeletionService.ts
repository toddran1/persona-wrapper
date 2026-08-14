import OpenAI from "openai";
import { and, eq, lte } from "drizzle-orm";
import { env } from "../config/env.js";
import { getDatabase } from "../db/client.js";
import {
  backgroundJobs,
  betterAuthAccounts,
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
import { dataTransferJobService } from "./dataTransferJobService.js";
import { appleClientIdForScope, revokeAppleToken } from "./appleOAuthService.js";
import { appleSigningKey } from "./appleOAuthRuntime.js";

const REMOTE_DELETION_BATCH_SIZE = 20;

async function settleInBatches<T>(items: T[], operation: (item: T) => Promise<unknown>): Promise<PromiseSettledResult<unknown>[]> {
  const results: PromiseSettledResult<unknown>[] = [];
  for (let offset = 0; offset < items.length; offset += REMOTE_DELETION_BATCH_SIZE) {
    results.push(...await Promise.allSettled(items.slice(offset, offset + REMOTE_DELETION_BATCH_SIZE).map(operation)));
  }
  return results;
}

function requireDatabase() {
  const db = getDatabase();
  if (!db) throw new Error("Account deletion requires DATABASE_URL.");
  return db;
}

async function deleteStoredObjects(keys: Array<string | null>): Promise<void> {
  const uniqueKeys = [...new Set(keys.filter((key): key is string => Boolean(key)))];
  const results = await settleInBatches(uniqueKeys, (key) => storageService.delete(key));
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
  const operations: Array<() => Promise<unknown>> = [
    ...fileIds.map((id) => () => client.files.delete(id)),
    ...vectorStoreIds.map((id) => () => client.vectorStores.delete(id)),
    ...artifacts.map((artifact) => () => client.containers.files.delete(artifact.fileId, {
      container_id: artifact.containerId
    }))
  ];
  const results = await settleInBatches(operations, (operation) => operation());
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

async function revokeAppleAccounts(accounts: Array<typeof betterAuthAccounts.$inferSelect>): Promise<void> {
  const revocable = accounts.filter((account) => account.providerId === "apple" && (account.refreshToken || account.accessToken));
  if (revocable.length === 0) return;
  const signingKey = appleSigningKey;
  if (!env.APPLE_OAUTH_CLIENT_ID || !env.APPLE_OAUTH_TEAM_ID || !env.APPLE_OAUTH_KEY_ID || !signingKey) {
    throw new Error("Could not revoke Apple authorization because Apple OAuth is not configured.");
  }
  const results = await settleInBatches(revocable, (account) => {
    const refreshToken = account.refreshToken;
    return revokeAppleToken({
      token: refreshToken ?? account.accessToken!,
      tokenTypeHint: refreshToken ? "refresh_token" : "access_token",
      clientId: appleClientIdForScope(account.scope, env.APPLE_OAUTH_CLIENT_ID!, env.APPLE_APP_BUNDLE_IDENTIFIER),
      teamId: env.APPLE_OAUTH_TEAM_ID!,
      keyId: env.APPLE_OAUTH_KEY_ID!,
      signingKey
    });
  });
  const failed = results.filter((result) => result.status === "rejected").length;
  if (failed > 0) throw new Error(`Could not revoke ${failed} Apple account authorization(s).`);
}

export class AccountDeletionService {
  async purgeUser(userId: string): Promise<boolean> {
    const db = requireDatabase();
    const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
    if (!user) return false;

    await backgroundChatJobService.cancelForOwner(userId);
    await dataTransferJobService.cancelForOwner(userId);

    const [ownedUploads, ownedMedia, ownedAudio, ownedArtifacts, ownedVectorStores, ownedJobs, connectedAccounts] = await Promise.all([
      db.select().from(uploads).where(eq(uploads.ownerId, userId)),
      db.select().from(generatedMedia).where(eq(generatedMedia.ownerId, userId)),
      db.select().from(generatedAudio).where(eq(generatedAudio.ownerId, userId)),
      db.select().from(openAIArtifacts).where(eq(openAIArtifacts.ownerId, userId)),
      db.select().from(vectorStores).where(eq(vectorStores.ownerId, userId)),
      db.select().from(backgroundJobs).where(eq(backgroundJobs.ownerId, userId)),
      db.select().from(betterAuthAccounts).where(eq(betterAuthAccounts.userId, userId))
    ]);

    await revokeAppleAccounts(connectedAccounts);
    await deleteStoredObjects([
      ...ownedUploads.map((item) => item.storageKey),
      ...ownedMedia.map((item) => item.storageKey),
      ...ownedAudio.map((item) => item.storageKey),
      ...ownedArtifacts.map((item) => item.storageKey),
      ...ownedJobs.flatMap((item) => [
        typeof item.request?.storageKey === "string" ? item.request.storageKey : null,
        typeof item.metadata.resultStorageKey === "string" ? item.metadata.resultStorageKey : null
      ])
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
