import { eq, like, sql } from "drizzle-orm";
import { closeDatabase, getDatabase } from "../db/client.js";
import { messages } from "../db/schema.js";
import { generatedMediaService } from "../services/generatedMediaService.js";

type MigrationStats = {
  messagesScanned: number;
  messagesUpdated: number;
  dataUrlsExtracted: number;
};

async function migrateValue(value: unknown, stats: MigrationStats): Promise<unknown> {
  if (Array.isArray(value)) {
    return Promise.all(value.map((item) => migrateValue(item, stats)));
  }

  if (!value || typeof value !== "object") {
    return value;
  }

  const record = value as Record<string, unknown>;
  const migrated: Record<string, unknown> = {};

  for (const [key, fieldValue] of Object.entries(record)) {
    if (key === "url" && typeof fieldValue === "string" && fieldValue.startsWith("data:")) {
      const messageId = typeof record.messageId === "string" ? record.messageId : undefined;
      const persisted = await generatedMediaService.persistDataUrl(fieldValue, {
        ...(messageId ? { messageId } : {}),
        metadata: {
          migratedFrom: "message_metadata_data_url"
        }
      });
      if (persisted) {
        stats.dataUrlsExtracted += 1;
        migrated.url = persisted.url;
        migrated.mimeType = typeof record.mimeType === "string" ? record.mimeType : persisted.mimeType;
        migrated.metadata = {
          ...((record.metadata && typeof record.metadata === "object" && !Array.isArray(record.metadata)) ? record.metadata : {}),
          storage: "generated_media",
          sizeBytes: persisted.sizeBytes,
          migratedFrom: "message_metadata_data_url"
        };
        continue;
      }
    }

    migrated[key] = await migrateValue(fieldValue, stats);
  }

  return migrated;
}

async function main(): Promise<void> {
  const db = getDatabase();
  if (!db) {
    throw new Error("DATABASE_URL is required to migrate embedded generated media.");
  }

  const rows = await db
    .select({ id: messages.id, metadata: messages.metadata })
    .from(messages)
    .where(like(sql<string>`${messages.metadata}::text`, "%data:%;base64,%"));

  const stats: MigrationStats = {
    messagesScanned: rows.length,
    messagesUpdated: 0,
    dataUrlsExtracted: 0
  };

  for (const row of rows) {
    const before = stats.dataUrlsExtracted;
    const metadata = await migrateValue(row.metadata, stats) as Record<string, unknown>;
    if (stats.dataUrlsExtracted === before) continue;

    await db.update(messages).set({ metadata }).where(eq(messages.id, row.id));
    stats.messagesUpdated += 1;
  }

  console.log(JSON.stringify(stats, null, 2));
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeDatabase();
  });
