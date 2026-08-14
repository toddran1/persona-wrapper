import { decodeJwt, importPKCS8, SignJWT } from "jose";

export const APPLE_NATIVE_SCOPE_MARKER = "apple-native";
const APPLE_HTTP_TIMEOUT_MS = 15_000;

type AppleTokenResponse = {
  access_token: string;
  expires_in?: number;
  id_token?: string;
  refresh_token?: string;
};

type AppleTokenRequest = {
  clientId: string;
  teamId: string;
  keyId: string;
  signingKey: CryptoKey;
  fetchImpl?: typeof fetch;
};

export function normalizeApplePrivateKey(value: string): string {
  const trimmed = value.trim();
  const unquoted = trimmed.length >= 2
    && ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'")))
    ? trimmed.slice(1, -1)
    : trimmed;
  return unquoted.replaceAll("\\n", "\n").trim();
}

export async function importAppleSigningKey(privateKey: string): Promise<CryptoKey> {
  try {
    return await importPKCS8(normalizeApplePrivateKey(privateKey), "ES256");
  } catch (error) {
    throw new Error(
      "APPLE_OAUTH_PRIVATE_KEY must be a valid PKCS#8 ES256 private key. Preserve the BEGIN/END lines and encode line breaks as \\n in hosted environment variables.",
      { cause: error }
    );
  }
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

function appleOAuthError(payload: unknown, operation: "exchange" | "revoke"): Error {
  const code = typeof payload === "object" && payload !== null && "error" in payload && typeof payload.error === "string"
    ? payload.error
    : undefined;
  const action = operation === "exchange" ? "complete native Apple authorization" : "revoke Apple authorization";
  return new Error(`Could not ${action}${code ? ` (${code})` : ""}.`);
}

async function appleClientSecret(input: AppleTokenRequest): Promise<string> {
  return generateAppleClientSecret({
    clientId: input.clientId,
    teamId: input.teamId,
    keyId: input.keyId,
    signingKey: input.signingKey
  });
}

export async function exchangeAppleAuthorizationCode(
  input: AppleTokenRequest & { authorizationCode: string }
): Promise<AppleTokenResponse & { subject: string }> {
  if (!input.authorizationCode) throw new Error("Apple did not return an authorization code.");
  let response: Response;
  try {
    response = await (input.fetchImpl ?? fetch)("https://appleid.apple.com/auth/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: input.clientId,
        client_secret: await appleClientSecret(input),
        code: input.authorizationCode,
        grant_type: "authorization_code"
      }),
      signal: AbortSignal.timeout(APPLE_HTTP_TIMEOUT_MS)
    });
  } catch {
    throw new Error("Could not reach Apple to complete native authorization.");
  }
  const payload = await response.json().catch(() => undefined) as Partial<AppleTokenResponse> & { error?: string } | undefined;
  if (!response.ok || !payload?.access_token || !payload.id_token) throw appleOAuthError(payload, "exchange");
  const claims = decodeJwt(payload.id_token);
  const audience = Array.isArray(claims.aud) ? claims.aud : claims.aud ? [claims.aud] : [];
  const subject = claims.sub;
  if (!subject || claims.iss !== "https://appleid.apple.com" || !audience.includes(input.clientId)) {
    throw new Error("Apple's token response did not match this app or account.");
  }
  return { ...payload, access_token: payload.access_token, id_token: payload.id_token, subject };
}

export async function revokeAppleToken(
  input: AppleTokenRequest & { token: string; tokenTypeHint: "access_token" | "refresh_token" }
): Promise<void> {
  let response: Response;
  try {
    response = await (input.fetchImpl ?? fetch)("https://appleid.apple.com/auth/revoke", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: input.clientId,
        client_secret: await appleClientSecret(input),
        token: input.token,
        token_type_hint: input.tokenTypeHint
      }),
      signal: AbortSignal.timeout(APPLE_HTTP_TIMEOUT_MS)
    });
  } catch {
    throw new Error("Could not reach Apple to revoke authorization.");
  }
  if (!response.ok) {
    const payload = await response.json().catch(() => undefined);
    throw appleOAuthError(payload, "revoke");
  }
}

export function appleClientIdForScope(scope: string | null | undefined, serviceClientId: string, appBundleIdentifier: string): string {
  return scope?.split(/[ ,]+/).includes(APPLE_NATIVE_SCOPE_MARKER) ? appBundleIdentifier : serviceClientId;
}
