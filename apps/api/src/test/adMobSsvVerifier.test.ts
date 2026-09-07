import { generateKeyPairSync, sign } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { resetAdMobSsvKeyCacheForTests, verifyAdMobSsvQuery } from "../services/adMobSsvVerifier.js";

const TEST_REWARDED_AD_UNIT = "ca-app-pub-3940256099942544/5224354917";

function signedQuery(input: { privateKey: ReturnType<typeof generateKeyPairSync>["privateKey"]; now: Date }) {
  const signedContent = new URLSearchParams({
    ad_unit: TEST_REWARDED_AD_UNIT,
    custom_data: "ad_reward_session_test",
    reward_amount: "1",
    reward_item: "media_credit",
    timestamp: String(input.now.getTime()),
    transaction_id: "transaction_test",
    user_id: "user_test"
  }).toString();
  const signature = sign("sha256", Buffer.from(signedContent), input.privateKey).toString("base64url");
  return `${signedContent}&signature=${encodeURIComponent(signature)}&key_id=7`;
}

describe("AdMob SSV verification", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    resetAdMobSsvKeyCacheForTests();
  });

  it("accepts an authorized callback with a valid ECDSA signature", async () => {
    const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      keys: [{ keyId: 7, pem: publicKey.export({ type: "spki", format: "pem" }).toString() }]
    }), { status: 200 })));
    const now = new Date("2026-09-06T12:00:00.000Z");

    await expect(verifyAdMobSsvQuery(signedQuery({ privateKey, now }), now)).resolves.toMatchObject({
      adUnit: TEST_REWARDED_AD_UNIT,
      customData: "ad_reward_session_test",
      rewardAmount: 1,
      rewardItem: "media_credit",
      transactionId: "transaction_test",
      userId: "user_test"
    });
  });

  it("rejects a callback whose signed values were changed", async () => {
    const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      keys: [{ keyId: 7, pem: publicKey.export({ type: "spki", format: "pem" }).toString() }]
    }), { status: 200 })));
    const now = new Date("2026-09-06T12:00:00.000Z");
    const tampered = signedQuery({ privateKey, now }).replace("reward_amount=1", "reward_amount=9");

    await expect(verifyAdMobSsvQuery(tampered, now)).rejects.toThrow("signature is invalid");
  });
});
