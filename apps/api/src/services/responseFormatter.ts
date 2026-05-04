import { randomUUID } from "node:crypto";
import type { ChatMessage, ChatResponse, ContentBlock, LLMOutput, PersonaDefinition, TTSOutput } from "@persona/shared";

function createConversationId(): string {
  return `conv_${randomUUID()}`;
}

export class ResponseFormatter {
  format(params: {
    persona: PersonaDefinition;
    llmOutput: LLMOutput;
    conversationId?: string;
    history: ChatMessage[];
    includeAudio: boolean;
    ttsOutput?: TTSOutput;
  }): ChatResponse {
    const outputs: ContentBlock[] = [...params.llmOutput.content];

    if (params.includeAudio && params.ttsOutput) {
      const firstText = outputs.find((output) => output.type === "text");
      const audioBlock: Extract<ContentBlock, { type: "audio" }> = {
        type: "audio",
        url: params.ttsOutput.url,
        mimeType: params.ttsOutput.mimeType
      };

      if (firstText?.type === "text") {
        audioBlock.transcript = firstText.text;
      }

      outputs.push(audioBlock);
    }

    return {
      persona: {
        id: params.persona.id,
        name: params.persona.name,
        tagline: params.persona.tagline,
        description: params.persona.description,
        avatarColor: params.persona.avatarColor,
        theme: params.persona.theme,
        supportedProviders: params.persona.supportedProviders
      },
      provider: params.llmOutput.provider,
      conversationId: params.conversationId ?? createConversationId(),
      history: params.history,
      outputs,
      generatedAt: new Date().toISOString(),
      diagnostics: {
        requestedAudio: params.includeAudio,
        toolsAvailable: params.persona.defaultTools,
        messageCount: params.history.length
      },
      usage: params.llmOutput.usage
    };
  }
}
