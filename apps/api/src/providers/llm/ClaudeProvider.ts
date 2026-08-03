import type { LLMInput, LLMOutput } from "@persona/shared";
import { env } from "../../config/env.js";
import { HttpError } from "../../utils/httpError.js";
import type { LLMProvider, LLMStreamCallbacks } from "./LLMProvider.js";
import { buildStubOutput } from "./stubScenarioBuilder.js";
import {
  assertTextOnlyProviderRequest,
  consumeJsonSse,
  readProviderError,
  shouldUseProviderStub
} from "./providerStreamUtils.js";

type ClaudeUsage = { inputTokens: number; outputTokens: number };

function claudeMessages(input: LLMInput) {
  return input.messages
    .filter((message) => message.role === "user" || message.role === "assistant")
    .map((message) => ({ role: message.role, content: message.content }));
}

function output(text: string, usage: ClaudeUsage): LLMOutput {
  return {
    provider: "claude",
    rawText: text,
    content: [{ type: "text", text }],
    usage,
    metadata: { providerModel: env.ANTHROPIC_MODEL }
  };
}

export class ClaudeProvider implements LLMProvider {
  async generateResponse(input: LLMInput, signal?: AbortSignal): Promise<LLMOutput> {
    if (shouldUseProviderStub(env.ANTHROPIC_API_KEY)) return buildStubOutput(input, "claude", "full");
    assertTextOnlyProviderRequest(input, "Claude");
    const response = await this.request(input, false, signal);
    if (!response.ok) throw await readProviderError(response, "Claude");
    const payload = await response.json() as Record<string, unknown>;
    const content = Array.isArray(payload.content) ? payload.content : [];
    const text = content.flatMap((block) => {
      if (typeof block !== "object" || block === null) return [];
      const value = block as Record<string, unknown>;
      return value.type === "text" && typeof value.text === "string" ? [value.text] : [];
    }).join("");
    if (!text.trim()) throw new HttpError("Claude returned an empty response.", 502);
    const usage = typeof payload.usage === "object" && payload.usage !== null
      ? payload.usage as Record<string, unknown>
      : {};
    return output(text, {
      inputTokens: typeof usage.input_tokens === "number" ? usage.input_tokens : 0,
      outputTokens: typeof usage.output_tokens === "number" ? usage.output_tokens : 0
    });
  }

  async generateResponseStream(
    input: LLMInput,
    callbacks: LLMStreamCallbacks,
    signal?: AbortSignal
  ): Promise<LLMOutput> {
    if (shouldUseProviderStub(env.ANTHROPIC_API_KEY)) {
      const stub = buildStubOutput(input, "claude", "full");
      callbacks.onTextDelta(stub.rawText);
      return stub;
    }
    assertTextOnlyProviderRequest(input, "Claude");
    const response = await this.request(input, true, signal);
    if (!response.ok) throw await readProviderError(response, "Claude");
    let text = "";
    const usage: ClaudeUsage = { inputTokens: 0, outputTokens: 0 };
    await consumeJsonSse(response, (eventName, payload) => {
      if (eventName === "error" || payload.type === "error") {
        throw new HttpError("Claude interrupted the response stream.", 502);
      }
      if (payload.type === "message_start") {
        const message = typeof payload.message === "object" && payload.message !== null
          ? payload.message as Record<string, unknown>
          : {};
        const initialUsage = typeof message.usage === "object" && message.usage !== null
          ? message.usage as Record<string, unknown>
          : {};
        if (typeof initialUsage.input_tokens === "number") usage.inputTokens = initialUsage.input_tokens;
      }
      if (payload.type === "content_block_delta") {
        const delta = typeof payload.delta === "object" && payload.delta !== null
          ? payload.delta as Record<string, unknown>
          : {};
        if (delta.type === "text_delta" && typeof delta.text === "string") {
          text += delta.text;
          callbacks.onTextDelta(delta.text);
        }
      }
      if (payload.type === "message_delta") {
        const finalUsage = typeof payload.usage === "object" && payload.usage !== null
          ? payload.usage as Record<string, unknown>
          : {};
        if (typeof finalUsage.output_tokens === "number") usage.outputTokens = finalUsage.output_tokens;
      }
    });
    if (!text.trim()) throw new HttpError("Claude returned an empty response.", 502);
    return output(text, usage);
  }

  private request(input: LLMInput, stream: boolean, signal?: AbortSignal): Promise<Response> {
    return fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
        "x-api-key": env.ANTHROPIC_API_KEY!
      },
      body: JSON.stringify({
        model: env.ANTHROPIC_MODEL,
        max_tokens: env.ANTHROPIC_MAX_OUTPUT_TOKENS,
        stream,
        system: input.systemPrompt,
        messages: claudeMessages(input)
      }),
      signal: signal
        ? AbortSignal.any([signal, AbortSignal.timeout(env.API_REQUEST_TIMEOUT_MS)])
        : AbortSignal.timeout(env.API_REQUEST_TIMEOUT_MS)
    });
  }
}
