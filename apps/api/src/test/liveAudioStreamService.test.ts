import { EventEmitter } from "node:events";
import type { Response } from "express";
import { describe, expect, it } from "vitest";
import { LiveAudioStreamService, type LiveAudioStreamLimits } from "../services/liveAudioStreamService.js";

class FakeResponse extends EventEmitter {
  destroyed = false;
  writableEnded = false;
  statusCode = 0;
  readonly headers = new Map<string, string>();
  readonly chunks: Buffer[] = [];

  constructor(private readonly backpressure = false) {
    super();
  }

  status(code: number): this {
    this.statusCode = code;
    return this;
  }

  setHeader(name: string, value: string): this {
    this.headers.set(name.toLowerCase(), value);
    return this;
  }

  flushHeaders(): void {}

  write(chunk: Uint8Array): boolean {
    this.chunks.push(Buffer.from(chunk));
    return !this.backpressure;
  }

  end(): this {
    this.writableEnded = true;
    this.emit("finish");
    return this;
  }

  destroy(): this {
    if (this.destroyed) return this;
    this.destroyed = true;
    this.emit("close");
    return this;
  }
}

function createService(overrides: Partial<LiveAudioStreamLimits> = {}): LiveAudioStreamService {
  return new LiveAudioStreamService({
    sessionTtlMs: 60_000,
    completedSessionTtlMs: 60_000,
    maxSessionBytes: 1_024,
    maxTotalBufferedBytes: 1_024,
    maxActiveSessions: 4,
    drainTimeoutMs: 10,
    ...overrides
  });
}

describe("LiveAudioStreamService", () => {
  it("replays preconnected chunks and completes a single-use response", async () => {
    const service = createService();
    const stream = service.create("audio/mpeg");
    await service.write(stream.token, Buffer.from("ID3audio"));
    service.complete(stream.token);
    const response = new FakeResponse();

    await service.subscribe(stream.token, response as unknown as Response);

    expect(response.statusCode).toBe(200);
    expect(response.headers.get("content-type")).toBe("audio/mpeg");
    expect(response.headers.get("content-length")).toBe("8");
    expect(Buffer.concat(response.chunks).toString()).toBe("ID3audio");
    expect(response.writableEnded).toBe(true);
    await expect(service.subscribe(stream.token, new FakeResponse() as unknown as Response))
      .rejects.toMatchObject({ statusCode: 404 });
  });

  it("rejects a second consumer while a live response owns the token", async () => {
    const service = createService();
    const stream = service.create("audio/mpeg");
    const response = new FakeResponse();
    await service.subscribe(stream.token, response as unknown as Response);

    await expect(service.subscribe(stream.token, new FakeResponse() as unknown as Response))
      .rejects.toMatchObject({ statusCode: 410 });
    service.fail(stream.token);
  });

  it("allows a HEAD-style probe without consuming the stream token", async () => {
    const service = createService();
    const stream = service.create("audio/mpeg");
    const probe = new FakeResponse();
    service.probe(stream.token, probe as unknown as Response);
    const consumer = new FakeResponse();

    await expect(service.subscribe(stream.token, consumer as unknown as Response)).resolves.toBeUndefined();
    expect(probe.writableEnded).toBe(true);
    expect(consumer.statusCode).toBe(200);
    service.fail(stream.token);
  });

  it("enforces an aggregate preconnection buffer limit", async () => {
    const service = createService({ maxTotalBufferedBytes: 4 });
    const first = service.create("audio/mpeg");
    const second = service.create("audio/mpeg");
    await service.write(first.token, Buffer.from("1234"));

    await expect(service.write(second.token, Buffer.from("5")))
      .rejects.toMatchObject({ statusCode: 503 });
    service.fail(first.token);
  });

  it("disconnects a slow consumer instead of blocking provider persistence", async () => {
    const service = createService({ drainTimeoutMs: 5 });
    const stream = service.create("audio/mpeg");
    const response = new FakeResponse(true);
    await service.subscribe(stream.token, response as unknown as Response);

    await expect(service.write(stream.token, Buffer.from("ID3audio"))).resolves.toBeUndefined();
    expect(response.destroyed).toBe(true);
  });
});
