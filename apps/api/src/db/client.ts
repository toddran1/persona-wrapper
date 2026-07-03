import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { env } from "../config/env.js";
import * as schema from "./schema.js";

export type AppDatabase = PostgresJsDatabase<typeof schema>;

let client: postgres.Sql | undefined;
let database: AppDatabase | undefined;

export function getDatabase(): AppDatabase | undefined {
  if (!env.DATABASE_URL) return undefined;
  if (!client) {
    client = postgres(env.DATABASE_URL, {
      max: 10,
      idle_timeout: 20,
      connect_timeout: 10
    });
    database = drizzle(client, { schema });
  }
  return database;
}

export async function closeDatabase(): Promise<void> {
  if (!client) return;
  await client.end({ timeout: 5 });
  client = undefined;
  database = undefined;
}
