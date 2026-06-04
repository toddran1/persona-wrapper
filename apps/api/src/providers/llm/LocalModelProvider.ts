import type { LLMInput, LLMOutput } from "@persona/shared";
import { env } from "../../config/env.js";
import { HttpError } from "../../utils/httpError.js";
import type { LLMProvider } from "./LLMProvider.js";
import { buildStubOutput } from "./stubScenarioBuilder.js";

interface OllamaChatResponse {
  message?: {
    content?: unknown;
  };
  prompt_eval_count?: unknown;
  eval_count?: unknown;
}

export class LocalModelProvider implements LLMProvider {
  async generateResponse(input: LLMInput): Promise<LLMOutput> {
    if (env.LOCAL_LLM_ENDPOINT) {
      return this.generateWithOllama(input);
    }

    return buildStubOutput(input, "local");
  }

  private async generateWithOllama(input: LLMInput): Promise<LLMOutput> {
    const baseMessages = (input.baseMessages ?? input.messages).filter(
      (message) => message.role === "user" || message.role === "assistant"
    );

    let response: Response;
    try {
      response = await fetch(new URL("/api/chat", env.LOCAL_LLM_ENDPOINT), {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify({
          model: env.LOCAL_LLM_MODEL,
          stream: false,
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
        })
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown network error";
      throw new HttpError(
        `Local LLM connection failed. Check that Ollama is running and reachable at ${env.LOCAL_LLM_ENDPOINT}. ${message}`,
        502
      );
    }

    if (!response.ok) {
      throw new HttpError(`Local LLM request failed with status ${response.status}`, 502);
    }

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
        inputTokens: typeof payload.prompt_eval_count === "number" ? payload.prompt_eval_count : 0,
        outputTokens: typeof payload.eval_count === "number" ? payload.eval_count : 0
      },
      metadata: {
        providerModel: env.LOCAL_LLM_MODEL,
        endpoint: env.LOCAL_LLM_ENDPOINT
      }
    };
  }
}
