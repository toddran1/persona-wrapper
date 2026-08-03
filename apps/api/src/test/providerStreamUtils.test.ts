import { describe, expect, it, vi } from "vitest";
import { consumeJsonSse, readProviderError } from "../providers/llm/providerStreamUtils.js";

describe("provider streaming utilities", () => {
  it("parses provider events split across network chunks", async () => {
    const encoder = new TextEncoder();
    const response = new Response(new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode("event: content_block_delta\ndata: {\"type\":\"content_"));
        controller.enqueue(encoder.encode("block_delta\",\"delta\":{\"text\":\"Hey\"}}\n\n"));
        controller.enqueue(encoder.encode(": heartbeat\n\nevent: message_stop\ndata: {\"type\":\"message_stop\"}\n\n"));
        controller.close();
      }
    }));
    const listener = vi.fn();

    await consumeJsonSse(response, listener);

    expect(listener).toHaveBeenCalledTimes(2);
    expect(listener).toHaveBeenNthCalledWith(1, "content_block_delta", {
      type: "content_block_delta",
      delta: { text: "Hey" }
    });
  });

  it("rejects malformed provider events without exposing partial JSON", async () => {
    const response = new Response("data: {not-json}\n\n", {
      headers: { "content-type": "text/event-stream" }
    });

    await expect(consumeJsonSse(response, vi.fn())).rejects.toThrow("invalid streaming event");
  });

  it("does not expose upstream provider error details", async () => {
    const error = await readProviderError(
      new Response("secret provider diagnostic", { status: 429 }),
      "Claude"
    );

    expect(error.message).toBe("Claude could not complete the request. Please try again.");
    expect(error.message).not.toContain("secret provider diagnostic");
  });
});
