export function hasDatabaseErrorCode(error: unknown, expectedCode: string): boolean {
  const visited = new Set<object>();
  let current = error;

  for (let depth = 0; depth < 6; depth += 1) {
    if (typeof current !== "object" || current === null || visited.has(current)) return false;
    visited.add(current);

    if ("code" in current && current.code === expectedCode) return true;
    current = "cause" in current ? current.cause : undefined;
  }

  return false;
}
