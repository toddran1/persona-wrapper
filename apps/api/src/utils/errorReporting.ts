const INTERNAL_DATABASE_ERROR_PATTERN =
  /failed query:|\bparams:|drizzle|postgres|violates .*constraint|duplicate key|relation .* does not exist|insert into|update ["a-z_]+ set/i;

const ROUTINE_DISCONNECT_CODES = new Set(["ECONNRESET", "EPIPE", "ERR_STREAM_PREMATURE_CLOSE"]);

function errorCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  return "code" in error && typeof error.code === "string" ? error.code : undefined;
}

export function isRoutineClientDisconnect(error: unknown): boolean {
  const code = errorCode(error);
  if (code && ROUTINE_DISCONNECT_CODES.has(code)) return true;
  const message = error instanceof Error ? error.message : String(error);
  return /\b(?:read|write) ECONNRESET\b|socket hang up|premature close/i.test(message);
}

export function errorMessageForLog(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (INTERNAL_DATABASE_ERROR_PATTERN.test(message)) {
    const code = errorCode(error) ?? (error instanceof Error ? errorCode(error.cause) : undefined);
    return code ? `Database operation failed (${code}).` : "Database operation failed.";
  }

  return message
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [REDACTED]")
    .replace(/\bsk-(?:proj-)?[A-Za-z0-9_-]{12,}/g, "[REDACTED_API_KEY]")
    .slice(0, 1_000);
}
