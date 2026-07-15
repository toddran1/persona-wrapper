import { defineConfig } from "@playwright/test";

const root = process.cwd();
const databaseUrl = process.env.E2E_DATABASE_URL ?? "postgres://persona:persona_dev_password@localhost:5434/persona_wrapper_e2e";

const testEnvironment = {
  ...process.env,
  APP_TEST_MODE: "true",
  AUTH_REQUIRED: "true",
  AUTH_REQUIRE_OWNED_MEDIA_ACCESS: "true",
  DATABASE_URL: databaseUrl,
  NODE_ENV: "test",
  OAUTH_REDIRECT_BASE_URL: "http://127.0.0.1:4100",
  PORT: "4100",
  STORAGE_LOCAL_ROOT: `${root}/.e2e/storage`,
  ELEVENLABS_API_KEY: "",
  ELEVENLABS_VOICE_ID: "",
  ELEVENLABS_VOICE_ID_LARAE: "",
  TTS_PROVIDER: "local",
  VITE_API_URL: "http://127.0.0.1:4100",
  VITE_TEST_MODE: "true",
  WEB_APP_URL: "http://127.0.0.1:5173"
};

export default defineConfig({
  testDir: "./e2e/web",
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  timeout: 90_000,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: "http://127.0.0.1:5173",
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    video: "retain-on-failure"
  },
  webServer: [
    {
      command: "npm run dev -w @persona/api",
      url: "http://127.0.0.1:4100/health",
      reuseExistingServer: false,
      env: testEnvironment
    },
    {
      command: "npm run dev -w @persona/web -- --host 127.0.0.1 --port 5173",
      url: "http://127.0.0.1:5173",
      reuseExistingServer: false,
      env: testEnvironment
    }
  ]
});
