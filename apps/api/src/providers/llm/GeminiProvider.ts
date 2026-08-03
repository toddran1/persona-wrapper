import type { LLMInput, LLMOutput } from "@persona/shared";
import { env } from "../../config/env.js";
import { HttpError } from "../../utils/httpError.js";
import type { LLMProvider, LLMStreamCallbacks } from "./LLMProvider.js";
import {
  assertTextOnlyProviderRequest,
  consumeJsonSse,
  readProviderError,
  shouldUseProviderStub
} from "./providerStreamUtils.js";
import { buildStubOutput } from "./stubScenarioBuilder.js";

type GeminiUsage = { inputTokens: number; outputTokens: number };

function contents(input: LLMInput) {
  return input.messages
    .filter((message) => message.role === "user" || message.role === "assistant")
    .map((message) => ({
      role: message.role === "assistant" ? "model" : "user",
      parts: [{ text: message.content }]
    }));
}

function textFromPayload(payload: Record<string, unknown>): string {
  const candidates = Array.isArray(payload.candidates) ? payload.candidates : [];
  return candidates.flatMap((candidate) => {
    if (typeof candidate !== "object" || candidate === null) return [];
    const content = (candidate as Record<string, unknown>).content;
    if (typeof content !== "object" || content === null) return [];
    const parts = Array.isArray((content as Record<string, unknown>).parts)
      ? (content as Record<string, unknown>).parts as unknown[]
      : [];
    return parts.flatMap((part) => {
      if (typeof part !== "object" || part === null) return [];
      const text = (part as Record<string, unknown>).text;
      return typeof text === "string" ? [text] : [];
    });
  }).join("");
}

function usageFromPayload(payload: Record<string, unknown>): GeminiUsage {
  const usage = typeof payload.usageMetadata === "object" && payload.usageMetadata !== null
    ? payload.usageMetadata as Record<string, unknown>
    : {};
  return {
    inputTokens: typeof usage.promptTokenCount === "number" ? usage.promptTokenCount : 0,
    outputTokens: typeof usage.candidatesTokenCount === "number" ? usage.candidatesTokenCount : 0
  };
}

function output(text: string, usage: GeminiUsage): LLMOutput {
  return {
    provider: "gemini",
    rawText: text,
    content: [{ type: "text", text }],
    usage,
    metadata: { providerModel: env.GEMINI_MODEL }
  };
}

export class GeminiProvider implements LLMProvider {
  async generateResponse(input: LLMInput, signal?: AbortSignal): Promise<LLMOutput> {
    if (shouldUseProviderStub(env.GEMINI_API_KEY)) return buildStubOutput(input, "gemini", "full");
    assertTextOnlyProviderRequest(input, "Gemini");
    const response = await this.request(input, false, signal);
    if (!response.ok) throw await readProviderError(response, "Gemini");
    const payload = await response.json() as Record<string, unknown>;
    const text = textFromPayload(payload);
    if (!text.trim()) throw new HttpError("Gemini returned an empty response.", 502);
    return output(text, usageFromPayload(payload));
  }

  async generateResponseStream(
    input: LLMInput,
    callbacks: LLMStreamCallbacks,
    signal?: AbortSignal
  ): Promise<LLMOutput> {
    if (shouldUseProviderStub(env.GEMINI_API_KEY)) {
      const stub = buildStubOutput(input, "gemini", "full");
      callbacks.onTextDelta(stub.rawText);
      return stub;
    }
    assertTextOnlyProviderRequest(input, "Gemini");
    const response = await this.request(input, true, signal);
    if (!response.ok) throw await readProviderError(response, "Gemini");
    let text = "";
    let usage: GeminiUsage = { inputTokens: 0, outputTokens: 0 };
    await consumeJsonSse(response, (_eventName, payload) => {
      const delta = textFromPayload(payload);
      if (delta) {
        text += delta;
        callbacks.onTextDelta(delta);
      }
      const eventUsage = usageFromPayload(payload);
      if (eventUsage.inputTokens || eventUsage.outputTokens) usage = eventUsage;
    });
    if (!text.trim()) throw new HttpError("Gemini returned an empty response.", 502);
    return output(text, usage);
  }

  private request(input: LLMInput, stream: boolean, signal?: AbortSignal): Promise<Response> {
    const action = stream ? "streamGenerateContent" : "generateContent";
    const endpoint = new URL(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(env.GEMINI_MODEL)}:${action}`);
    if (stream) endpoint.searchParams.set("alt", "sse");
    return fetch(endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-goog-api-key": env.GEMINI_API_KEY!
      },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: input.systemPrompt }] },
        contents: contents(input),
        generationConfig: { maxOutputTokens: env.GEMINI_MAX_OUTPUT_TOKENS }
      }),
      signal: signal
        ? AbortSignal.any([signal, AbortSignal.timeout(env.API_REQUEST_TIMEOUT_MS)])
        : AbortSignal.timeout(env.API_REQUEST_TIMEOUT_MS)
    });
  }
}
