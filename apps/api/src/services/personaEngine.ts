import type {
  ChatMessage,
  ChatRequest,
  LLMInput,
  PersonaDefinition
} from "@persona/shared";
import { getToolsByNames } from "../providers/tools/toolRegistry.js";

export class PersonaEngine {
  createSystemPrompt(persona: PersonaDefinition): string {
    return [
      `You are ${persona.name}, a fictional AI persona.`,
      `Biography: ${persona.biography}`,
      `Personality traits: ${persona.personalityTraits.join(", ")}`,
      `Speech style: ${persona.speechStyle.join("; ")}`,
      `Catchphrases: ${persona.catchphrases.join(" | ")}`,
      `Visual style: ${persona.visualStyle.join(", ")}`,
      `Safety boundaries: ${persona.safetyBoundaries.join(" ")}`,
      "Stay entertaining, stylized, and coherent.",
      "Return multimodal output when useful, not only plain text.",
      "If a tool is needed, declare a structured tool call."
    ].join("\n");
  }

  createBaseSystemPrompt(persona: PersonaDefinition): string {
    return [
      `You are generating a base answer for ${persona.name}.`,
      `Use a light version of this persona: ${persona.personalityTraits.join(", ")}.`,
      `Keep the rhythm conversational and confident, with only mild slang when it fits.`,
      "Prioritize factual accuracy, directness, and semantic clarity over flourish.",
      "Do not use catchphrases, signature lines, or repeated branded phrases.",
      "Do not add dramatic filler, reality-TV narration, or extra opinion unless the user asked for it.",
      "Keep the answer clean enough for a separate style-transfer model to intensify later.",
      "Return structured tool calls or multimodal content only when the task actually needs them."
    ].join("\n");
  }

  buildMessages(systemPrompt: string, history: ChatMessage[], userMessage: string): ChatMessage[] {
    return [
      {
        role: "system",
        content: systemPrompt
      },
      ...history,
      {
        role: "user",
        content: userMessage
      }
    ];
  }

  prepareInput(persona: PersonaDefinition, request: ChatRequest): LLMInput {
    const systemPrompt = this.createSystemPrompt(persona);
    const baseSystemPrompt = this.createBaseSystemPrompt(persona);
    const messages = this.buildMessages(systemPrompt, request.history, request.message);
    const baseMessages = this.buildMessages(baseSystemPrompt, request.history, request.message);

    return {
      persona,
      systemPrompt,
      baseSystemPrompt,
      messages,
      baseMessages,
      userMessage: request.message,
      toolDefinitions: getToolsByNames(persona.defaultTools),
      requestedOutputs: request.requestedOutputs,
      attachments: request.attachments ?? [],
      toolOptions: request.toolOptions ?? {
        webSearch: false,
        fileSearch: false,
        codeInterpreter: false,
        imageGeneration: false,
        appFunctions: true,
        background: false,
        vectorStoreIds: []
      },
      clientContext: request.clientContext
    };
  }
}
