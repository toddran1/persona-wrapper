import type { ChatMessage, ChatRequest, ChatResponse } from "@persona/shared";
import type { TTSOutput } from "@persona/shared";
import { getPersonaById } from "../personas/index.js";
import { createLLMProvider } from "../providers/llm/providerFactory.js";
import { createStyleTransferProvider } from "../providers/styleTransfer/providerFactory.js";
import { createTTSProvider } from "../providers/tts/providerFactory.js";
import { ConversationStore } from "./conversationStore.js";
import { PersonaEngine } from "./personaEngine.js";
import { ResponseFormatter } from "./responseFormatter.js";
import { HttpError } from "../utils/httpError.js";
import { logger } from "../utils/logger.js";

export class ChatService {
  constructor(
    private readonly conversationStore = new ConversationStore(),
    private readonly personaEngine = new PersonaEngine(),
    private readonly responseFormatter = new ResponseFormatter()
  ) {}

  async handleChat(request: ChatRequest): Promise<ChatResponse> {
    const persona = getPersonaById(request.personaId);
    if (!persona) {
      throw new HttpError(`Unknown persona: ${request.personaId}`, 404);
    }

    const conversation = this.conversationStore.getOrCreate(request.conversationId, request.history);
    const llmProvider = createLLMProvider(request.provider);
    const llmInput = this.personaEngine.prepareInput(persona, {
      ...request,
      conversationId: conversation.id,
      history: this.conversationStore.getPromptHistory(conversation)
    });
    const llmOutput = await llmProvider.generateResponse(llmInput);
    const firstNeutralTextBlock = llmOutput.content.find((block) => block.type === "text");
    const neutralText =
      firstNeutralTextBlock?.type === "text" && firstNeutralTextBlock.text.trim().length > 0
        ? firstNeutralTextBlock.text
        : llmOutput.rawText;

    const neutralResponseMetadata = {
      provider: llmOutput.provider,
      providerModel: llmOutput.metadata?.providerModel,
      personaId: persona.id,
      conversationId: conversation.id,
      userMessage: request.message
    };

    logger.info("Neutral LLM response metadata", neutralResponseMetadata);
    logger.info("Neutral LLM response before style transfer", {
      conversationId: conversation.id,
      neutralText
    });

    const styleTransferProvider = createStyleTransferProvider();
    const styleTransferInput = {
      neutralText,
      persona,
      conversationHistory: conversation.messages,
      userMessage: request.message,
      provider: llmOutput.provider
    };
    const styleTransferOutput = await styleTransferProvider.transferStyle(styleTransferInput);

    logger.info("Style transfer model response", {
      conversationId: conversation.id,
      styledText: styleTransferOutput.styledText,
      metadata: styleTransferOutput.metadata
    });

    logger.llmTurn({
      conversationId: conversation.id,
      personaId: persona.id,
      userMessage: request.message,
      provider: request.provider,
      neutralLlm: {
        requestMessages: llmInput.messages,
        responseMetadata: neutralResponseMetadata,
        responseText: neutralText
      },
      styleTransfer: {
        request: {
          neutralText: styleTransferInput.neutralText,
          userMessage: styleTransferInput.userMessage,
          provider: styleTransferInput.provider,
          conversationHistoryCount: styleTransferInput.conversationHistory.length
        },
        responseText: styleTransferOutput.styledText,
        responseMetadata: styleTransferOutput.metadata
      }
    });

    const styledLlmOutput = {
      ...llmOutput,
      rawText: styleTransferOutput.styledText,
      content: llmOutput.content.map((block) =>
        block.type === "text" ? { ...block, text: styleTransferOutput.styledText } : block
      ),
      metadata: {
        ...(llmOutput.metadata ?? {}),
        styleTransfer: styleTransferOutput
      }
    };

    let ttsOutput: TTSOutput | undefined;
    if (request.audio) {
      const textBlock = styledLlmOutput.content.find((block) => block.type === "text");
      if (textBlock?.type === "text") {
        const ttsProvider = createTTSProvider(request.provider);
        ttsOutput = await ttsProvider.synthesize({
          text: textBlock.text,
          persona
        });
      }
    }

    const firstTextBlock = styledLlmOutput.content.find((block) => block.type === "text");
    const assistantText = firstTextBlock?.type === "text" ? firstTextBlock.text : styledLlmOutput.rawText;

    const updatedConversation = this.conversationStore.appendTurn(conversation, [
      {
        role: "user",
        content: request.message
      },
      {
        role: "assistant",
        content: assistantText
      }
    ] satisfies ChatMessage[]);

    return this.responseFormatter.format({
      persona,
      llmOutput: styledLlmOutput,
      conversationId: updatedConversation.id,
      history: updatedConversation.messages,
      includeAudio: request.audio,
      ...(ttsOutput ? { ttsOutput } : {})
    });
  }
}
