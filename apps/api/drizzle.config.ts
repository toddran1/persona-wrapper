import dotenv from "dotenv";
import { defineConfig } from "drizzle-kit";
import path from "node:path";
import { fileURLToPath } from "node:url";

const apiDir = path.dirname(fileURLToPath(import.meta.url));

dotenv.config({ path: path.resolve(apiDir, "../../.env") });
dotenv.config({ path: path.resolve(apiDir, ".env") });

export default defineConfig({
  schema: path.join(apiDir, "src/db/schema.ts"),
  // Drizzle prepends `./` internally; keep this relative so an absolute
  // workspace path cannot become an invalid `.//Users/...` migration path.
  out: path.relative(process.cwd(), path.join(apiDir, "drizzle")),
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "postgres://persona:persona_dev_password@localhost:5434/persona_wrapper_db"
  },
  strict: true,
  verbose: true
});
