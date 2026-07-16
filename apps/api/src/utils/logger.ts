import { appendFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { emitTelemetryLog } from "./telemetry.js";

type LogLevel = "info" | "warn" | "error";

const defaultLlmTurnLogPath = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../logs/llm-turns.jsonl"
);

function safeSerialize(value: unknown): string {
  const seen = new WeakSet<object>();
  try {
    return JSON.stringify(value, (_key, item: unknown) => {
      if (item instanceof Error) {
        return { name: item.name, message: item.message, stack: item.stack };
      }
      if (typeof item === "bigint") return item.toString();
      if (typeof item === "object" && item !== null) {
        if (seen.has(item)) return "[Circular]";
        seen.add(item);
      }
      return item;
    });
  } catch (error) {
    return JSON.stringify({
      timestamp: new Date().toISOString(),
      level: "error",
      message: "Failed to serialize log entry",
      serializationError: error instanceof Error ? error.message : String(error)
    });
  }
}

function write(level: LogLevel, message: string, payload?: unknown): void {
  const line = {
    timestamp: new Date().toISOString(),
    level,
    message,
    payload
  };

  const serialized = safeSerialize(line);
  emitTelemetryLog(level, message, payload);
  if (level === "error") {
    console.error(serialized);
    return;
  }

  console.log(serialized);
}

function appendJsonl(filePath: string, payload: unknown): void {
  try {
    mkdirSync(dirname(filePath), { recursive: true });
    appendFileSync(filePath, `${safeSerialize(payload)}\n`, "utf8");
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
