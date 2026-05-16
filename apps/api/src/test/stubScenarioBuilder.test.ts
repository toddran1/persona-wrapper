import { describe, expect, it } from "vitest";
import { getPersonaById } from "../personas/index.js";
import { buildStubOutput } from "../providers/llm/stubScenarioBuilder.js";

describe("stubScenarioBuilder", () => {
  it("builds a persona-lite base response for openai without catchphrases", () => {
    const persona = getPersonaById("larae");

    expect(persona).toBeDefined();

    const output = buildStubOutput(
      {
        persona: persona!,
        systemPrompt: "full prompt",
        baseSystemPrompt: "base prompt",
        messages: [
          { role: "system", content: "full prompt" },
          { role: "user", content: "Who was president in 2010?" }
        ],
        baseMessages: [
          { role: "system", content: "base prompt" },
          { role: "user", content: "Who was president in 2010?" }
        ],
        userMessage: "Who was president in 2010?",
        toolDefinitions: [],
        requestedOutputs: []
      },
      "openai",
      "base"
    );

    const textBlock = output.content.find((block) => block.type === "text");

    expect(textBlock?.type).toBe("text");
    expect(textBlock?.type === "text" ? textBlock.text : "").not.toContain("Clock it");
    expect(textBlock?.type === "text" ? textBlock.text : "").not.toContain("Gurl, be serious.");
    expect(output.metadata?.promptTrack).toBe("base");
  });

  it("preserves the full-style demo stub mode", () => {
    const persona = getPersonaById("larae");

    expect(persona).toBeDefined();

    const output = buildStubOutput(
      {
        persona: persona!,
        systemPrompt: "full prompt",
        messages: [
          { role: "system", content: "full prompt" },
          { role: "user", content: "Give me a dramatic intro." }
        ],
        userMessage: "Give me a dramatic intro.",
        toolDefinitions: [],
        requestedOutputs: []
      },
      "local",
      "full"
    );

    const textBlock = output.content.find((block) => block.type === "text");

    expect(textBlock?.type).toBe("text");
    expect(textBlock?.type === "text" ? textBlock.text : "").toContain("Clock it");
    expect(output.metadata?.promptTrack).toBe("full");
  });
});
