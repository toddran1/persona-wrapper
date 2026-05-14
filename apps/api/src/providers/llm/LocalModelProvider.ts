import type { LLMInput, LLMOutput } from "@persona/shared";
import { env } from "../../config/env.js";
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
    const response = await fetch(new URL("/api/chat", env.LOCAL_LLM_ENDPOINT), {
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
              "Answer neutrally and directly. Do not imitate a persona, slang style, or voice. The response will be styled by a separate style-transfer model."
          },
          ...input.messages
            .filter((message) => message.role === "user" || message.role === "assistant" || message.role === "system")
            .map((message) => ({
              role: message.role === "system" ? "system" : message.role,
              content: message.content
            }))
        ],
        options: {
          temperature: 0.4,
          top_p: 0.9,
          num_predict: 220
        }
      })
    });

    if (!response.ok) {
      throw new Error(`Local LLM request failed with status ${response.status}`);
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
