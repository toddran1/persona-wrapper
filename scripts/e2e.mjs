import { mkdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const databaseUrl = process.env.E2E_DATABASE_URL ?? "postgres://persona:persona_dev_password@localhost:5434/persona_wrapper_e2e";
const parsedDatabaseUrl = new URL(databaseUrl);

if (!new Set(["localhost", "127.0.0.1", "::1"]).has(parsedDatabaseUrl.hostname) || !parsedDatabaseUrl.pathname.endsWith("_e2e")) {
  throw new Error("E2E_DATABASE_URL must point to a local database whose name ends in _e2e.");
}

const testEnvironment = {
  ...process.env,
  APP_TEST_MODE: "true",
  AUTH_REQUIRED: "true",
  AUTH_REQUIRE_OWNED_MEDIA_ACCESS: "true",
  DATABASE_URL: databaseUrl,
  NODE_ENV: "test",
  OAUTH_REDIRECT_BASE_URL: "http://127.0.0.1:4100",
  PORT: "4100",
  STORAGE_LOCAL_ROOT: path.join(root, ".e2e", "storage"),
  ELEVENLABS_API_KEY: "",
  ELEVENLABS_VOICE_ID: "",
  ELEVENLABS_VOICE_ID_LARAE: "",
  TTS_PROVIDER: "local",
  VITE_API_URL: "http://127.0.0.1:4100",
  VITE_TEST_MODE: "true",
  WEB_APP_URL: "http://127.0.0.1:5173"
};

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: root,
    env: testEnvironment,
    stdio: "inherit",
    ...options
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

mkdirSync(testEnvironment.STORAGE_LOCAL_ROOT, { recursive: true });
run("docker", ["compose", "up", "-d", "postgres"]);

const databaseName = decodeURIComponent(parsedDatabaseUrl.pathname.slice(1));
const exists = spawnSync("docker", ["compose", "exec", "-T", "postgres", "psql", "-U", "persona", "-d", "postgres", "-tAc", `SELECT 1 FROM pg_database WHERE datname = '${databaseName.replace(/'/g, "''")}';`], {
  cwd: root,
  env: testEnvironment,
  encoding: "utf8"
});
if (exists.error) throw exists.error;
if (exists.status !== 0) process.exit(exists.status ?? 1);
if (!exists.stdout.trim()) run("docker", ["compose", "exec", "-T", "postgres", "createdb", "-U", "persona", databaseName]);

run("npm", ["run", "db:migrate", "-w", "@persona/api"]);
run("npx", ["playwright", "test"]);
