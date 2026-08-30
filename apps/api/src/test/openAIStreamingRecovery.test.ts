import { describe, expect, it, vi } from "vitest";
import { getPersonaById } from "../personas/index.js";
import { OpenAIProvider } from "../providers/llm/OpenAIProvider.js";
import { PersonaEngine } from "../services/personaEngine.js";

const persona = getPersonaById("larae")!;

function input() {
  return new PersonaEngine().prepareInput(persona, {
    personaId: persona.id,
    provider: "openai",
    message: "Find current video-generation options.",
    audio: false,
    testMode: false,
    history: []
  });
}

function streamEvents(events: unknown[]): AsyncIterable<unknown> {
  return {
    async *[Symbol.asyncIterator]() {
      for (const event of events) yield event;
    }
  };
}

describe("OpenAI streaming response recovery", () => {
  it("retrieves an already-created response when the stream ends before response.completed", async () => {
    const completed = {
      id: "resp_recoverable",
      status: "completed",
      output_text: "Recovered answer",
      output: []
    };
    const retrieve = vi.fn().mockResolvedValue(completed);
    const client = {
      responses: {
        create: vi.fn().mockResolvedValue(streamEvents([
          {
            type: "response.created",
            response: { id: "resp_recoverable", status: "in_progress" }
          }
        ])),
        retrieve
      }
    };
    const callbacks = { onTextDelta: vi.fn() };

    const response = await (new OpenAIProvider() as any).createStreamingResponse(
      client,
      input(),
      [],
      [],
      callbacks
    );

    expect(response).toBe(completed);
    expect(retrieve).toHaveBeenCalledWith(
      "resp_recoverable",
      expect.objectContaining({ stream: false }),
      expect.any(Object)
    );
  });

  it("keeps the original failure when the stream closes before exposing a response ID", async () => {
    const client = {
      responses: {
        create: vi.fn().mockResolvedValue(streamEvents([])),
        retrieve: vi.fn()
      }
    };

    await expect((new OpenAIProvider() as any).createStreamingResponse(
      client,
      input(),
      [],
      [],
      { onTextDelta: vi.fn() }
    )).rejects.toThrow("OpenAI stream ended without a completed response.");
    expect(client.responses.retrieve).not.toHaveBeenCalled();
  });
});
