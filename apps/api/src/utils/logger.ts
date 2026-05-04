type LogLevel = "info" | "warn" | "error";

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

export const logger = {
  info: (message: string, payload?: unknown) => write("info", message, payload),
  warn: (message: string, payload?: unknown) => write("warn", message, payload),
  error: (message: string, payload?: unknown) => write("error", message, payload)
};

