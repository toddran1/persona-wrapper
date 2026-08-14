import { importPKCS8, SignJWT } from "jose";

export function normalizeApplePrivateKey(value: string): string {
  const trimmed = value.trim();
  const unquoted = trimmed.length >= 2
    && ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'")))
    ? trimmed.slice(1, -1)
    : trimmed;
  return unquoted.replaceAll("\\n", "\n").trim();
}

export async function importAppleSigningKey(privateKey: string): Promise<CryptoKey> {
  return importPKCS8(normalizeApplePrivateKey(privateKey), "ES256");
}

export async function generateAppleClientSecret(input: {
  clientId: string;
  teamId: string;
  keyId: string;
  signingKey: CryptoKey;
  now?: number;
}): Promise<string> {
  const now = input.now ?? Math.floor(Date.now() / 1000);
  return new SignJWT()
    .setProtectedHeader({ alg: "ES256", kid: input.keyId })
    .setIssuer(input.teamId)
    .setSubject(input.clientId)
    .setAudience("https://appleid.apple.com")
    .setIssuedAt(now)
    .setExpirationTime(now + (180 * 24 * 60 * 60))
    .sign(input.signingKey);
}
