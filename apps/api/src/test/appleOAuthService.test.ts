import { generateKeyPair, exportPKCS8, jwtVerify } from "jose";
import { describe, expect, it } from "vitest";
import { generateAppleClientSecret, importAppleSigningKey, normalizeApplePrivateKey } from "../services/appleOAuthService.js";

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
});
