import { afterEach, describe, expect, it, vi } from "vitest";
import { env } from "../config/env.js";
import { getPersonaById } from "../personas/index.js";
import { ElevenLabsTTSProvider } from "../providers/tts/ElevenLabsTTSProvider.js";
import { generatedAudioService } from "../services/generatedAudioService.js";

const larae = getPersonaById("larae")!;
const originalApiKey = env.ELEVENLABS_API_KEY;
const originalVoiceId = env.ELEVENLABS_VOICE_ID;
const originalRetries = env.ELEVENLABS_MAX_RETRIES;
const originalMaxBytes = env.ELEVENLABS_MAX_RESPONSE_BYTES;
const validMp3 = Buffer.from([0x49, 0x44, 0x33, 0x04, 0x00, 0x00, 0x00, 0x00]);

afterEach(() => {
  env.ELEVENLABS_API_KEY = originalApiKey;
  env.ELEVENLABS_VOICE_ID = originalVoiceId;
  env.ELEVENLABS_MAX_RETRIES = originalRetries;
  env.ELEVENLABS_MAX_RESPONSE_BYTES = originalMaxBytes;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("ElevenLabsTTSProvider", () => {
  it("uses the streaming endpoint, emits chunks, and persists the complete audio", async () => {
    env.ELEVENLABS_API_KEY = "test-eleven-key";
    env.ELEVENLABS_VOICE_ID = "test-voice";
    env.ELEVENLABS_MAX_RETRIES = 0;
    const fetchMock = vi.fn().mockResolvedValue(new Response(validMp3, {
      status: 200,
      headers: { "content-type": "audio/mpeg" }
    }));
    vi.stubGlobal("fetch", fetchMock);
    const register = vi.spyOn(generatedAudioService, "register").mockResolvedValue("/api/generated-audio/test-token");
    const streamedChunks: Buffer[] = [];
    const start = vi.fn();

    await new ElevenLabsTTSProvider().synthesize({ text: "Hey baby!", persona: larae }, undefined, {
      onStart: start,
      onChunk: (chunk) => {
        streamedChunks.push(Buffer.from(chunk));
      }
    });

    expect(String(fetchMock.mock.calls[0]?.[0])).toMatch(/\/text-to-speech\/[^/]+\/stream\?/);
    expect(start).toHaveBeenCalledWith({ mimeType: "audio/mpeg" });
    expect(Buffer.concat(streamedChunks)).toEqual(validMp3);
    expect(register).toHaveBeenCalledWith(validMp3, expect.any(Object));
  });

  it("rejects a successful non-audio response before exposing or storing it", async () => {
    env.ELEVENLABS_API_KEY = "test-eleven-key";
    env.ELEVENLABS_VOICE_ID = "test-voice";
    env.ELEVENLABS_MAX_RETRIES = 0;
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{}", {
      status: 200,
      headers: { "content-type": "application/json" }
    })));
    const register = vi.spyOn(generatedAudioService, "register");
    const start = vi.fn();

    await expect(new ElevenLabsTTSProvider().synthesize({ text: "Hey baby!", persona: larae }, undefined, {
      onStart: start,
      onChunk: vi.fn()
    })).rejects.toMatchObject({ statusCode: 502 });
    expect(start).not.toHaveBeenCalled();
    expect(register).not.toHaveBeenCalled();
  });

  it("normalizes octet-stream responses and streams validated MP3 audio", async () => {
    env.ELEVENLABS_API_KEY = "test-eleven-key";
    env.ELEVENLABS_VOICE_ID = "test-voice";
    env.ELEVENLABS_MAX_RETRIES = 0;
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(validMp3, {
      status: 200,
      headers: { "content-type": "application/octet-stream" }
    })));
    vi.spyOn(generatedAudioService, "register").mockResolvedValue("/api/generated-audio/test-token");
    const start = vi.fn();

    const output = await new ElevenLabsTTSProvider().synthesize({ text: "Hey baby!", persona: larae }, undefined, {
      onStart: start,
      onChunk: vi.fn()
    });

    expect(start).toHaveBeenCalledWith({ mimeType: "audio/mpeg" });
    expect(output.mimeType).toBe("audio/mpeg");
  });

  it("rejects invalid MP3 bytes before exposing or storing them", async () => {
    env.ELEVENLABS_API_KEY = "test-eleven-key";
    env.ELEVENLABS_VOICE_ID = "test-voice";
    env.ELEVENLABS_MAX_RETRIES = 0;
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("not-an-mp3", {
      status: 200,
      headers: { "content-type": "audio/mpeg" }
    })));
    const register = vi.spyOn(generatedAudioService, "register");
    const start = vi.fn();

    await expect(new ElevenLabsTTSProvider().synthesize({ text: "Hey baby!", persona: larae }, undefined, {
      onStart: start,
      onChunk: vi.fn()
    })).rejects.toMatchObject({ statusCode: 502 });
    expect(start).not.toHaveBeenCalled();
    expect(register).not.toHaveBeenCalled();
  });

  it("does not retry an ambiguous transport failure that may already be billable", async () => {
    env.ELEVENLABS_API_KEY = "test-eleven-key";
    env.ELEVENLABS_VOICE_ID = "test-voice";
    env.ELEVENLABS_MAX_RETRIES = 3;
    const fetchMock = vi.fn().mockRejectedValue(new Error("socket closed after request upload"));
    vi.stubGlobal("fetch", fetchMock);

    await expect(new ElevenLabsTTSProvider().synthesize({ text: "Hey baby!", persona: larae }))
      .rejects.toMatchObject({ statusCode: 502 });
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});
