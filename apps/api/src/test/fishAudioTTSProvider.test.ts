import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { personaDefinitionSchema } from "@persona/shared";
import { env } from "../config/env.js";
import { getPersonaById } from "../personas/index.js";
import { FishAudioTTSProvider } from "../providers/tts/FishAudioTTSProvider.js";
import { createTTSProvider } from "../providers/tts/providerFactory.js";
import { generatedAudioService } from "../services/generatedAudioService.js";

const larae = getPersonaById("larae")!;
const originalApiKey = env.FISH_AUDIO_API_KEY;
const originalMaxRetries = env.FISH_AUDIO_MAX_RETRIES;
const originalRetryBaseMs = env.FISH_AUDIO_RETRY_BASE_MS;
const originalRetryMaxMs = env.FISH_AUDIO_RETRY_MAX_MS;
const originalMaxResponseBytes = env.FISH_AUDIO_MAX_RESPONSE_BYTES;
const originalAppTestMode = env.APP_TEST_MODE;
const originalTtsProvider = env.TTS_PROVIDER;
const originalGenericReferenceId = env.FISH_AUDIO_REFERENCE_ID;
const originalLaraeReferenceId = process.env.FISH_AUDIO_REFERENCE_ID_LARAE;

const validMp3 = Buffer.from([0x49, 0x44, 0x33, 0x04, 0x00, 0x00, 0x00, 0x00]);

function audioResponse(body: BodyInit = validMp3, init: ResponseInit = {}): Response {
  return new Response(body, {
    status: 200,
    headers: { "content-type": "audio/mpeg" },
    ...init
  });
}

beforeEach(() => {
  process.env.FISH_AUDIO_REFERENCE_ID_LARAE = "test-larae-reference";
});

afterEach(() => {
  vi.useRealTimers();
  env.FISH_AUDIO_API_KEY = originalApiKey;
  env.FISH_AUDIO_MAX_RETRIES = originalMaxRetries;
  env.FISH_AUDIO_RETRY_BASE_MS = originalRetryBaseMs;
  env.FISH_AUDIO_RETRY_MAX_MS = originalRetryMaxMs;
  env.FISH_AUDIO_MAX_RESPONSE_BYTES = originalMaxResponseBytes;
  env.APP_TEST_MODE = originalAppTestMode;
  env.TTS_PROVIDER = originalTtsProvider;
  env.FISH_AUDIO_REFERENCE_ID = originalGenericReferenceId;
  if (originalLaraeReferenceId === undefined) delete process.env.FISH_AUDIO_REFERENCE_ID_LARAE;
  else process.env.FISH_AUDIO_REFERENCE_ID_LARAE = originalLaraeReferenceId;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("FishAudioTTSProvider", () => {
  it("rejects raw PCM persona output because app clients require a playable container", () => {
    expect(personaDefinitionSchema.safeParse({
      ...larae,
      voiceProfile: {
        ...larae.voiceProfile,
        fishAudio: {
          ...larae.voiceProfile.fishAudio,
          format: "pcm"
        }
      }
    }).success).toBe(false);
  });

  it("is selected independently of the configured LLM provider", () => {
    env.APP_TEST_MODE = false;
    env.TTS_PROVIDER = "fish_audio";

    expect(createTTSProvider("claude")).toBeInstanceOf(FishAudioTTSProvider);
  });

  it("synthesizes a persona voice with Fish Audio and stores the result", async () => {
    env.FISH_AUDIO_API_KEY = "test-fish-key";
    env.FISH_AUDIO_MAX_RETRIES = 0;
    const fetchMock = vi.fn().mockResolvedValue(audioResponse());
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(generatedAudioService, "register").mockResolvedValue("/api/generated-audio/test-token");

    const output = await new FishAudioTTSProvider().synthesize({
      text: "Hey baby!",
      persona: larae,
      voiceId: "fish-larae-reference",
      ownerId: "user-test",
      conversationId: "conv-test",
      messageId: "msg-test"
    });

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.fish.audio/v1/tts");
    expect(init.headers).toMatchObject({
      authorization: "Bearer test-fish-key",
      model: "s2.1-pro"
    });
    expect(JSON.parse(String(init.body))).toMatchObject({
      text: "Hey baby!",
      reference_id: "fish-larae-reference",
      format: "mp3",
      latency: "balanced",
      prosody: { speed: 1.06, volume: 0, normalize_loudness: true }
    });
    expect(generatedAudioService.register).toHaveBeenCalledWith(expect.any(Buffer), expect.objectContaining({
      fileName: "larae-voice.mp3",
      mimeType: "audio/mpeg",
      ownerId: "user-test",
      conversationId: "conv-test",
      messageId: "msg-test"
    }));
    expect(output).toEqual({
      provider: "fish_audio_tts",
      url: "/api/generated-audio/test-token",
      mimeType: "audio/mpeg"
    });
  });

  it("fails safely when the API key is missing", async () => {
    env.FISH_AUDIO_API_KEY = undefined;

    await expect(new FishAudioTTSProvider().synthesize({
      text: "Hey baby!",
      persona: larae
    })).rejects.toMatchObject({ statusCode: 503 });
  });

  it("fails before calling Fish when the persona reference ID is missing", async () => {
    env.FISH_AUDIO_API_KEY = "test-fish-key";
    env.FISH_AUDIO_REFERENCE_ID = undefined;
    delete process.env.FISH_AUDIO_REFERENCE_ID_LARAE;
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(new FishAudioTTSProvider().synthesize({
      text: "Hey baby!",
      persona: larae
    })).rejects.toMatchObject({ statusCode: 503 });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("resolves a persona-specific reference ID from its configured environment variable", async () => {
    env.FISH_AUDIO_API_KEY = "test-fish-key";
    env.FISH_AUDIO_MAX_RETRIES = 0;
    process.env.FISH_AUDIO_REFERENCE_ID_LARAE = "larae-environment-reference";
    const fetchMock = vi.fn().mockResolvedValue(audioResponse());
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(generatedAudioService, "register").mockResolvedValue("/api/generated-audio/test-token");

    await new FishAudioTTSProvider().synthesize({ text: "Hey baby!", persona: larae });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toMatchObject({ reference_id: "larae-environment-reference" });
  });

  it.each([
    ["wav" as const, Buffer.from("RIFF\u0000\u0000\u0000\u0000WAVEfmt "), "audio/wav", "larae-voice.wav"],
    ["opus" as const, Buffer.from("OggS\u0000\u0000\u0000\u0000OpusHead"), "audio/ogg", "larae-voice.opus"]
  ])("accepts validated %s container output", async (format, bytes, mimeType, fileName) => {
    env.FISH_AUDIO_API_KEY = "test-fish-key";
    env.FISH_AUDIO_MAX_RETRIES = 0;
    const persona = {
      ...larae,
      voiceProfile: {
        ...larae.voiceProfile,
        fishAudio: {
          ...larae.voiceProfile.fishAudio,
          format
        }
      }
    };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(bytes, {
      status: 200,
      headers: { "content-type": mimeType }
    })));
    const register = vi.spyOn(generatedAudioService, "register").mockResolvedValue("/api/generated-audio/test-token");

    await expect(new FishAudioTTSProvider().synthesize({ text: "Hey baby!", persona })).resolves.toMatchObject({ mimeType });
    expect(register).toHaveBeenCalledWith(expect.any(Buffer), expect.objectContaining({ fileName, mimeType }));
  });

  it.each([
    ["an empty response", new Response(null, { status: 200, headers: { "content-type": "audio/mpeg" } })],
    ["a non-audio content type", new Response(validMp3, { status: 200, headers: { "content-type": "application/json" } })],
    ["audio bytes with the wrong signature", audioResponse(Buffer.from("not-an-mp3"))]
  ])("rejects %s before storage", async (_label, response) => {
    env.FISH_AUDIO_API_KEY = "test-fish-key";
    env.FISH_AUDIO_MAX_RETRIES = 0;
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response));
    const register = vi.spyOn(generatedAudioService, "register");

    await expect(new FishAudioTTSProvider().synthesize({
      text: "Hey baby!",
      persona: larae
    })).rejects.toMatchObject({ statusCode: 502 });
    expect(register).not.toHaveBeenCalled();
  });

  it("rejects an oversized streamed response before storage", async () => {
    env.FISH_AUDIO_API_KEY = "test-fish-key";
    env.FISH_AUDIO_MAX_RETRIES = 0;
    env.FISH_AUDIO_MAX_RESPONSE_BYTES = 4;
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(audioResponse()));
    const register = vi.spyOn(generatedAudioService, "register");

    await expect(new FishAudioTTSProvider().synthesize({
      text: "Hey baby!",
      persona: larae
    })).rejects.toMatchObject({ statusCode: 502 });
    expect(register).not.toHaveBeenCalled();
  });

  it("retries a rate-limited request and honors Retry-After", async () => {
    env.FISH_AUDIO_API_KEY = "test-fish-key";
    env.FISH_AUDIO_MAX_RETRIES = 1;
    env.FISH_AUDIO_RETRY_BASE_MS = 1;
    env.FISH_AUDIO_RETRY_MAX_MS = 2_000;
    vi.useFakeTimers();
    vi.spyOn(Math, "random").mockReturnValue(0);
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response("rate limited", { status: 429, headers: { "retry-after": "1" } }))
      .mockResolvedValueOnce(audioResponse());
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(generatedAudioService, "register").mockResolvedValue("/api/generated-audio/test-token");

    const synthesis = new FishAudioTTSProvider().synthesize({ text: "Hey baby!", persona: larae });
    await vi.advanceTimersByTimeAsync(999);
    expect(fetchMock).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(1);
    await expect(synthesis).resolves.toMatchObject({
      provider: "fish_audio_tts"
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("aborts an in-flight Fish request when the chat request is cancelled", async () => {
    env.FISH_AUDIO_API_KEY = "test-fish-key";
    env.FISH_AUDIO_MAX_RETRIES = 0;
    const fetchMock = vi.fn((_url: string, init: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
    }));
    vi.stubGlobal("fetch", fetchMock);
    const controller = new AbortController();

    const synthesis = new FishAudioTTSProvider().synthesize({ text: "Hey baby!", persona: larae }, controller.signal);
    controller.abort(new Error("User stopped generation."));

    await expect(synthesis).rejects.toThrow("User stopped generation.");
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it.each([
    ["a server error", "server" as const, 500],
    ["an ambiguous transport failure", "transport" as const, 502]
  ])("does not retry %s without an idempotency guarantee", async (_label, failureKind, expectedStatus) => {
    env.FISH_AUDIO_API_KEY = "test-fish-key";
    env.FISH_AUDIO_MAX_RETRIES = 2;
    const fetchMock = failureKind === "server"
      ? vi.fn().mockResolvedValue(new Response("server error", { status: 500 }))
      : vi.fn().mockRejectedValue(new Error("socket closed"));
    vi.stubGlobal("fetch", fetchMock);

    await expect(new FishAudioTTSProvider().synthesize({ text: "Hey baby!", persona: larae })).rejects.toMatchObject({
      statusCode: expectedStatus
    });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("propagates storage failures instead of returning a broken audio URL", async () => {
    env.FISH_AUDIO_API_KEY = "test-fish-key";
    env.FISH_AUDIO_MAX_RETRIES = 0;
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(audioResponse()));
    vi.spyOn(generatedAudioService, "register").mockRejectedValue(new Error("storage unavailable"));

    await expect(new FishAudioTTSProvider().synthesize({ text: "Hey baby!", persona: larae }))
      .rejects.toThrow("storage unavailable");
  });
});
