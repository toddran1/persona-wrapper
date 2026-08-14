import { generateKeyPair, exportPKCS8, jwtVerify, SignJWT } from "jose";
import { describe, expect, it, vi } from "vitest";
import {
  appleClientIdForScope,
  exchangeAppleAuthorizationCode,
  generateAppleClientSecret,
  importAppleSigningKey,
  normalizeApplePrivateKey,
  revokeAppleToken
} from "../services/appleOAuthService.js";

describe("appleOAuthService", () => {
  it("normalizes multiline, escaped, and quoted private keys", () => {
    const pem = "-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----";
    expect(normalizeApplePrivateKey(pem)).toBe(pem);
    expect(normalizeApplePrivateKey(pem.replaceAll("\n", "\\n"))).toBe(pem);
    expect(normalizeApplePrivateKey(`"${pem.replaceAll("\n", "\\n")}"`)).toBe(pem);
  });

  it("generates a verifiable Apple client-secret JWT", async () => {
    const { privateKey, publicKey } = await generateKeyPair("ES256", { extractable: true });
    const signingKey = await importAppleSigningKey(await exportPKCS8(privateKey));
    const token = await generateAppleClientSecret({
      clientId: "com.forthebaddiez.web",
      teamId: "TEAM123",
      keyId: "KEY123",
      signingKey,
      now: 1_800_000_000
    });
    const verified = await jwtVerify(token, publicKey, {
      issuer: "TEAM123",
      subject: "com.forthebaddiez.web",
      audience: "https://appleid.apple.com",
      currentDate: new Date(1_800_000_000 * 1000)
    });
    expect(verified.protectedHeader).toMatchObject({ alg: "ES256", kid: "KEY123" });
    expect(verified.payload.exp).toBe(1_800_000_000 + (180 * 24 * 60 * 60));
  });

  it("reports malformed private keys without echoing the secret", async () => {
    await expect(importAppleSigningKey("definitely-not-a-private-key")).rejects.toThrow(
      "APPLE_OAUTH_PRIVATE_KEY must be a valid PKCS#8 ES256 private key"
    );
  });

  it("exchanges a native authorization code using the app bundle identifier", async () => {
    const { privateKey } = await generateKeyPair("ES256", { extractable: true });
    const signingKey = await importAppleSigningKey(await exportPKCS8(privateKey));
    const idToken = await new SignJWT({ sub: "apple-user-123" })
      .setProtectedHeader({ alg: "ES256" })
      .setIssuer("https://appleid.apple.com")
      .setAudience("com.forthebaddiez.mobile")
      .sign(privateKey);
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      access_token: "access-token",
      refresh_token: "refresh-token",
      id_token: idToken,
      expires_in: 3600
    }), { status: 200, headers: { "Content-Type": "application/json" } }));

    await expect(exchangeAppleAuthorizationCode({
      authorizationCode: "native-code",
      clientId: "com.forthebaddiez.mobile",
      teamId: "TEAM123",
      keyId: "KEY123",
      signingKey,
      fetchImpl
    })).resolves.toMatchObject({
      access_token: "access-token",
      refresh_token: "refresh-token",
      subject: "apple-user-123"
    });
    const [, init] = fetchImpl.mock.calls[0] ?? [];
    expect(String(init?.body)).toContain("client_id=com.forthebaddiez.mobile");
    expect(String(init?.body)).toContain("code=native-code");
  });

  it("revokes the stored token with the client that issued it", async () => {
    const { privateKey } = await generateKeyPair("ES256", { extractable: true });
    const signingKey = await importAppleSigningKey(await exportPKCS8(privateKey));
    const fetchImpl = vi.fn(async () => new Response(null, { status: 200 }));
    await revokeAppleToken({
      token: "refresh-token",
      tokenTypeHint: "refresh_token",
      clientId: "com.forthebaddiez.mobile",
      teamId: "TEAM123",
      keyId: "KEY123",
      signingKey,
      fetchImpl
    });
    const [, init] = fetchImpl.mock.calls[0] ?? [];
    expect(String(init?.body)).toContain("token=refresh-token");
    expect(String(init?.body)).toContain("token_type_hint=refresh_token");
    expect(appleClientIdForScope("email,apple-native", "web.service", "mobile.bundle")).toBe("mobile.bundle");
    expect(appleClientIdForScope("email,name", "web.service", "mobile.bundle")).toBe("web.service");
  });
});
