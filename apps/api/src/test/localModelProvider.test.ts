import { afterEach, describe, expect, it, vi } from "vitest";
import { env } from "../config/env.js";
import { getPersonaById } from "../personas/index.js";
import { LocalModelProvider } from "../providers/llm/LocalModelProvider.js";
import { PersonaEngine } from "../services/personaEngine.js";

const originalEndpoint = env.LOCAL_LLM_ENDPOINT;

afterEach(() => {
  env.LOCAL_LLM_ENDPOINT = originalEndpoint;
  vi.unstubAllGlobals();
});

describe("LocalModelProvider", () => {
  it("consumes Ollama NDJSON incrementally and requests streaming output", async () => {
    const persona = getPersonaById("larae");
    if (!persona) throw new Error("LaRae persona not found");
    const input = new PersonaEngine().prepareInput(persona, {
      personaId: persona.id,
      provider: "local",
      message: "Introduce yourself.",
      audio: false,
      testMode: false,
      history: []
    });
    env.LOCAL_LLM_ENDPOINT = "http://ollama.test";
    const fetchMock = vi.fn().mockResolvedValue(new Response([
      JSON.stringify({ message: { content: "Hello " } }),
      JSON.stringify({ message: { content: "world." }, prompt_eval_count: 8, eval_count: 2 })
    ].join("\n") + "\n", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const deltas: string[] = [];

    const output = await new LocalModelProvider().generateResponseStream(input, {
      onTextDelta: (delta) => deltas.push(delta)
    });

    expect(deltas.join("")).toBe("Hello world.");
    expect(output.rawText).toBe("Hello world.");
    expect(output.usage).toEqual({ inputTokens: 8, outputTokens: 2 });
    const request = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined;
    expect(JSON.parse(String(request?.body))).toMatchObject({ stream: true });
  });
});
