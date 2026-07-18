import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCallback);
const PASSWORD_HASH_BYTES = 64;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString("base64url");
  const derived = await scrypt(password, salt, PASSWORD_HASH_BYTES) as Buffer;
  return `scrypt$v=1$${salt}$${derived.toString("base64url")}`;
}

export async function verifyPassword(password: string, storedHash: string): Promise<boolean> {
  const parts = storedHash.split("$");
  const salt = parts[2];
  const expectedHash = parts[3];
  if (parts[0] !== "scrypt" || !salt || !expectedHash) return false;

  const actual = await scrypt(password, salt, PASSWORD_HASH_BYTES) as Buffer;
  const expected = Buffer.from(expectedHash, "base64url");
  if (actual.byteLength !== expected.byteLength) return false;
  return timingSafeEqual(actual, expected);
}
