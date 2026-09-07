import { generateKeyPairSync, sign } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { resetAdMobSsvKeyCacheForTests, verifyAdMobSsvQuery } from "../services/adMobSsvVerifier.js";

const TEST_REWARDED_AD_UNIT = "ca-app-pub-3940256099942544/5224354917";

function signedQuery(input: { privateKey: ReturnType<typeof generateKeyPairSync>["privateKey"]; now: Date; includeIdentity?: boolean }) {
  const params = new URLSearchParams({
    ad_unit: TEST_REWARDED_AD_UNIT,
    reward_amount: "1",
    reward_item: "media_credit",
    timestamp: String(input.now.getTime()),
    transaction_id: "transaction_test"
  });
  if (input.includeIdentity !== false) {
    params.set("custom_data", "ad_reward_session_test");
    params.set("user_id", "user_test");
  }
  const signedContent = params.toString();
  const signature = sign("sha256", Buffer.from(signedContent), input.privateKey).toString("base64url");
  return `${signedContent}&signature=${encodeURIComponent(signature)}&key_id=7`;
}

describe("AdMob SSV verification", () => {
  afterEach(() => {
    vi.restoreAllMocks();
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
      kind: "reward",
      customData: "ad_reward_session_test",
      rewardAmount: 1,
      rewardItem: "media_credit",
      transactionId: "transaction_test",
      userId: "user_test"
    });
  });

  it("accepts a signed console verification callback without optional identity fields", async () => {
    const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      keys: [{ keyId: 7, pem: publicKey.export({ type: "spki", format: "pem" }).toString() }]
    }), { status: 200 })));
    const now = new Date("2026-09-06T12:00:00.000Z");

    await expect(verifyAdMobSsvQuery(signedQuery({ privateKey, now, includeIdentity: false }), now))
      .resolves.toMatchObject({ kind: "unattributed", transactionId: "transaction_test" });
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

  it("coalesces concurrent signing-key refreshes", async () => {
    const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      keys: [{ keyId: 7, pem: publicKey.export({ type: "spki", format: "pem" }).toString() }]
    }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const now = new Date("2026-09-06T12:00:00.000Z");
    const query = signedQuery({ privateKey, now });

    await Promise.all([
      verifyAdMobSsvQuery(query, now),
      verifyAdMobSsvQuery(query, now)
    ]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("uses a previously trusted stale key during a refresh outage and honors backoff", async () => {
    const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
    const now = new Date("2026-09-06T12:00:00.000Z");
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(now.getTime());
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        keys: [{ keyId: 7, pem: publicKey.export({ type: "spki", format: "pem" }).toString() }]
      }), { status: 200 }))
      .mockRejectedValue(new Error("key service unavailable"));
    vi.stubGlobal("fetch", fetchMock);
    const query = signedQuery({ privateKey, now });
    await verifyAdMobSsvQuery(query, now);

    nowSpy.mockReturnValue(now.getTime() + 13 * 60 * 60 * 1000);
    await expect(verifyAdMobSsvQuery(query, now)).resolves.toMatchObject({ keyId: "7" });
    nowSpy.mockReturnValue(now.getTime() + 13 * 60 * 60 * 1000 + 1_000);
    await expect(verifyAdMobSsvQuery(query, now)).resolves.toMatchObject({ keyId: "7" });

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("maps malformed signing-key responses to a retryable service error", async () => {
    const { privateKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("not-json", { status: 200 })));
    const now = new Date("2026-09-06T12:00:00.000Z");

    await expect(verifyAdMobSsvQuery(signedQuery({ privateKey, now }), now)).rejects.toMatchObject({
      statusCode: 503
    });
  });
});
