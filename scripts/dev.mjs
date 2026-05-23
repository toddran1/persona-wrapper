import { spawn } from "node:child_process";

const testMode = process.argv.slice(2).includes("--test-mode") || process.env.npm_config_test_mode === "true";

const child = spawn(
  "npx",
  [
    "concurrently",
    "-k",
    "-n",
    "api,web",
    "-c",
    "magenta,cyan",
    "npm run dev -w @persona/api",
    "npm run dev -w @persona/web"
  ],
  {
    stdio: "inherit",
    env: {
      ...process.env,
      APP_TEST_MODE: testMode ? "true" : "false",
      VITE_TEST_MODE: testMode ? "true" : "false"
    }
  }
);

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }

  process.exit(code ?? 0);
});
