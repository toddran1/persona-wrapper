import { finiteNonnegativeIntegerOr, type LLMInput, type LLMOutput } from "@persona/shared";
import { env } from "../../config/env.js";
import { HttpError } from "../../utils/httpError.js";
import type { LLMProvider, LLMStreamCallbacks } from "./LLMProvider.js";
import { emitTextChunks } from "./streamText.js";
import { buildStubOutput } from "./stubScenarioBuilder.js";

interface OllamaChatResponse {
  message?: {
    content?: unknown;
  };
  prompt_eval_count?: unknown;
  eval_count?: unknown;
}

function ollamaRequestBody(input: LLMInput, stream: boolean): Record<string, unknown> {
  const baseMessages = (input.baseMessages ?? input.messages).filter(
    (message) => message.role === "user" || message.role === "assistant"
  );
  return {
    model: env.LOCAL_LLM_MODEL,
    stream,
    messages: [
      {
        role: "system",
        content:
          input.baseSystemPrompt ??
          "Answer directly with a light persona touch. Avoid catchphrases, signature lines, and heavy style. The response will be intensified by a separate style-transfer model."
      },
      ...baseMessages.map((message) => ({
        role: message.role,
        content: message.content
      }))
    ],
    options: {
      temperature: 0.4,
      top_p: 0.9,
      num_ctx: env.LOCAL_LLM_NUM_CTX,
      num_predict: env.LOCAL_LLM_NUM_PREDICT
    }
  };
}

export class LocalModelProvider implements LLMProvider {
  async generateResponse(input: LLMInput, signal?: AbortSignal): Promise<LLMOutput> {
    if (env.LOCAL_LLM_ENDPOINT) {
      return this.generateWithOllama(input, signal);
    }

    return buildStubOutput(input, "local");
  }

  async generateResponseStream(
    input: LLMInput,
    callbacks: LLMStreamCallbacks,
    signal?: AbortSignal
  ): Promise<LLMOutput> {
    if (!env.LOCAL_LLM_ENDPOINT) {
      const output = buildStubOutput(input, "local");
      emitTextChunks(output.rawText, callbacks);
      return output;
    }
    return this.generateStreamWithOllama(input, callbacks, signal);
  }

  private async generateWithOllama(input: LLMInput, signal?: AbortSignal): Promise<LLMOutput> {
    const response = await this.requestOllama(input, false, signal);

    const payload = (await response.json()) as OllamaChatResponse;
    const text =
      typeof payload.message?.content === "string" && payload.message.content.trim().length > 0
        ? payload.message.content.trim()
        : "The local model returned an empty response.";

    return {
      provider: "local",
      rawText: text,
      content: [
        {
          type: "text",
          text
        },
        {
          type: "json",
          data: {
            mode: "ollama",
            model: env.LOCAL_LLM_MODEL
          }
        }
      ],
      usage: {
        inputTokens: finiteNonnegativeIntegerOr(payload.prompt_eval_count),
        outputTokens: finiteNonnegativeIntegerOr(payload.eval_count)
      },
      metadata: {
        providerModel: env.LOCAL_LLM_MODEL,
        endpoint: env.LOCAL_LLM_ENDPOINT
      }
    };
  }

  private async generateStreamWithOllama(
    input: LLMInput,
    callbacks: LLMStreamCallbacks,
    signal?: AbortSignal
  ): Promise<LLMOutput> {
    const response = await this.requestOllama(input, true, signal);
    if (!response.body) throw new HttpError("The local LLM returned an empty response stream.", 502);

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let pending = "";
    let text = "";
    let finalPayload: OllamaChatResponse = {};

    const consumeLine = (line: string): void => {
      const trimmed = line.trim();
      if (!trimmed) return;
      let payload: OllamaChatResponse;
      try {
        payload = JSON.parse(trimmed) as OllamaChatResponse;
      } catch {
        throw new HttpError("The local LLM returned an invalid response stream.", 502);
      }
      finalPayload = payload;
      if (typeof payload.message?.content === "string" && payload.message.content) {
        text += payload.message.content;
        callbacks.onTextDelta(payload.message.content);
      }
    };

    while (true) {
      signal?.throwIfAborted();
      const { done, value } = await reader.read();
      pending += decoder.decode(value, { stream: !done });
      const lines = pending.split(/\r?\n/);
      pending = lines.pop() ?? "";
      for (const line of lines) consumeLine(line);
      if (done) break;
    }
    consumeLine(pending);

    const outputText = text.trim() || "The local model returned an empty response.";
    if (!text.trim()) callbacks.onTextDelta(outputText);
    return {
      provider: "local",
      rawText: outputText,
      content: [
        { type: "text", text: outputText },
        { type: "json", data: { mode: "ollama", model: env.LOCAL_LLM_MODEL } }
      ],
      usage: {
        inputTokens: finiteNonnegativeIntegerOr(finalPayload.prompt_eval_count),
        outputTokens: finiteNonnegativeIntegerOr(finalPayload.eval_count)
      },
      metadata: {
        providerModel: env.LOCAL_LLM_MODEL,
        endpoint: env.LOCAL_LLM_ENDPOINT
      }
    };
  }

  private async requestOllama(input: LLMInput, stream: boolean, signal?: AbortSignal): Promise<Response> {
    let response: Response;
    try {
      const requestSignal = signal
        ? AbortSignal.any([signal, AbortSignal.timeout(env.API_REQUEST_TIMEOUT_MS)])
        : AbortSignal.timeout(env.API_REQUEST_TIMEOUT_MS);
      response = await fetch(new URL("/api/chat", env.LOCAL_LLM_ENDPOINT), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(ollamaRequestBody(input, stream)),
        signal: requestSignal
      });
    } catch (error) {
      if (signal?.aborted) throw error;
      const message = error instanceof Error ? error.message : "Unknown network error";
      throw new HttpError(
        `Local LLM connection failed. Check that Ollama is running and reachable at ${env.LOCAL_LLM_ENDPOINT}. ${message}`,
        502
      );
    }
    if (!response.ok) {
      throw new HttpError(`Local LLM request failed with status ${response.status}`, 502);
    }
    return response;
  }
}
