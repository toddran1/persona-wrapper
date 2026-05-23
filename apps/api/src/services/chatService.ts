import type { ChatMessage, ChatRequest, ChatResponse } from "@persona/shared";
import type { TTSOutput } from "@persona/shared";
import { getPersonaById } from "../personas/index.js";
import { createLLMProvider } from "../providers/llm/providerFactory.js";
import { createStyleTransferProvider } from "../providers/styleTransfer/providerFactory.js";
import { createTTSProvider } from "../providers/tts/providerFactory.js";
import { env } from "../config/env.js";
import { ConversationStore } from "./conversationStore.js";
import { PersonaEngine } from "./personaEngine.js";
import { ResponseFormatter } from "./responseFormatter.js";
import { HttpError } from "../utils/httpError.js";
import { logger } from "../utils/logger.js";
import { ToolContextService, type ToolContext } from "./toolContextService.js";

const TEST_MODE_NEUTRAL_SYSTEM_PROMPT = [
  "You are generating a fully neutral base answer for a downstream style-transfer model.",
  "Do not use persona voice, slang, catchphrases, theatrical framing, or character-specific wording.",
  "Answer the user's request directly with clear, factual, plain language.",
  "Preserve names, dates, years, numbers, locations, durations, lists, bullets, and formatting.",
  "Do not add flourish or extra opinions unless the user explicitly asks for opinion."
].join("\n");

function insertToolContext(input: ChatMessage[], toolContext: ToolContext | undefined): ChatMessage[] {
  if (!toolContext) {
    return input;
  }

  const messages = [...input];
  const lastUserIndex = messages.map((message) => message.role).lastIndexOf("user");
  if (lastUserIndex === -1) {
    return [...messages, toolContext.message];
  }

  messages.splice(lastUserIndex, 0, toolContext.message);
  return messages;
}

export class ChatService {
  constructor(
    private readonly conversationStore = new ConversationStore(),
    private readonly personaEngine = new PersonaEngine(),
    private readonly responseFormatter = new ResponseFormatter(),
    private readonly toolContextService = new ToolContextService()
  ) {}

  async handleChat(request: ChatRequest): Promise<ChatResponse> {
    const persona = getPersonaById(request.personaId);
    if (!persona) {
      throw new HttpError(`Unknown persona: ${request.personaId}`, 404);
    }

    const testMode = request.testMode || env.APP_TEST_MODE;
    const conversation = this.conversationStore.getOrCreate(request.conversationId, request.history);
    const llmProvider = createLLMProvider(request.provider);
    const llmInput = this.personaEngine.prepareInput(persona, {
      ...request,
      conversationId: conversation.id,
      history: this.conversationStore.getPromptHistory(conversation)
    });
    if (testMode) {
      llmInput.baseSystemPrompt = TEST_MODE_NEUTRAL_SYSTEM_PROMPT;
      llmInput.baseMessages = this.personaEngine.buildMessages(
        TEST_MODE_NEUTRAL_SYSTEM_PROMPT,
        this.conversationStore.getPromptHistory(conversation),
        request.message
      );
    }
    const toolContext = await this.toolContextService.buildContext(request.message, request.clientContext);
    if (toolContext) {
      llmInput.messages = insertToolContext(llmInput.messages, toolContext);
      llmInput.baseMessages = insertToolContext(llmInput.baseMessages ?? llmInput.messages, toolContext);
      console.log(
        `\n--- Tool context before neutral LLM ---\n\n${toolContext.results
          .map((result) => `${result.name} (${result.status}): ${result.summary}`)
          .join("\n\n")}\n`
      );
    }
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

    console.log("\nNeutral LLM response object data:", neutralResponseMetadata);
    console.log(`\n--- Neutral LLM response before style transfer ---\n\n${neutralText}\n`);

    const styleTransferProvider = createStyleTransferProvider();
    const styleTransferInput = {
      neutralText,
      persona,
      conversationHistory: conversation.messages,
      userMessage: request.message,
      provider: llmOutput.provider
    };
    const styleTransferOutput = await styleTransferProvider.transferStyle(styleTransferInput);

    console.log(`--- Style transfer model response ---\n\n${styleTransferOutput.styledText}\n`);

    logger.llmTurn({
      conversationId: conversation.id,
      personaId: persona.id,
      userMessage: request.message,
      provider: request.provider,
      testMode,
      neutralLlm: {
        requestMessages: llmInput.baseMessages ?? llmInput.messages,
        responseMetadata: neutralResponseMetadata,
        responseText: neutralText,
        toolContext: toolContext?.results ?? []
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
      diagnostics: {
        testMode,
        ...(testMode ? { neutralResponse: neutralText } : {})
      },
      ...(ttsOutput ? { ttsOutput } : {})
    });
  }
}
