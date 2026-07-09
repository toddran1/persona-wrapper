import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

const apiDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

dotenv.config({ path: path.resolve(apiDir, "../../.env") });
dotenv.config({ path: path.resolve(apiDir, ".env") });

const databaseUrl = process.env.DATABASE_URL ?? "postgres://persona:persona_dev_password@localhost:5434/persona_wrapper_db";
const client = postgres(databaseUrl, { max: 1 });
const db = drizzle(client);

try {
  await migrate(db, { migrationsFolder: path.resolve(apiDir, "drizzle") });
  console.log("Database migrations applied.");
} finally {
  await client.end();
}
