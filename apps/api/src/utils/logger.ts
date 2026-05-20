import { appendFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

type LogLevel = "info" | "warn" | "error";

const defaultLlmTurnLogPath = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../logs/llm-turns.jsonl"
);

function write(level: LogLevel, message: string, payload?: unknown): void {
  const line = {
    timestamp: new Date().toISOString(),
    level,
    message,
    payload
  };

  const serialized = JSON.stringify(line);
  if (level === "error") {
    console.error(serialized);
    return;
  }

  console.log(serialized);
}

function appendJsonl(filePath: string, payload: unknown): void {
  try {
    mkdirSync(dirname(filePath), { recursive: true });
    appendFileSync(filePath, `${JSON.stringify(payload)}\n`, "utf8");
  } catch (error) {
    write("warn", "Failed to append JSONL log", {
      filePath,
      error: error instanceof Error ? error.message : String(error)
    });
  }
}

export const logger = {
  info: (message: string, payload?: unknown) => write("info", message, payload),
  warn: (message: string, payload?: unknown) => write("warn", message, payload),
  error: (message: string, payload?: unknown) => write("error", message, payload),
  llmTurn: (payload: unknown) => {
    const logPath = process.env.LLM_TURN_LOG_PATH ?? defaultLlmTurnLogPath;
    appendJsonl(logPath, {
      timestamp: new Date().toISOString(),
      ...((payload && typeof payload === "object") ? payload : { payload })
    });
  }
};
