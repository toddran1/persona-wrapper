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
    const messages = this.buildMessages(systemPrompt, request.history, request.message);

    return {
      persona,
      systemPrompt,
      messages,
      userMessage: request.message,
      toolDefinitions: getToolsByNames(persona.defaultTools),
      requestedOutputs: request.requestedOutputs
    };
  }
}

