import type { ChatMessage, ChatRequest, ChatResponse } from "@persona/shared";
import type { TTSOutput } from "@persona/shared";
import { getPersonaById } from "../personas/index.js";
import { createLLMProvider } from "../providers/llm/providerFactory.js";
import { createTTSProvider } from "../providers/tts/providerFactory.js";
import { ConversationStore } from "./conversationStore.js";
import { PersonaEngine } from "./personaEngine.js";
import { ResponseFormatter } from "./responseFormatter.js";
import { HttpError } from "../utils/httpError.js";

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

    let ttsOutput: TTSOutput | undefined;
    if (request.audio) {
      const textBlock = llmOutput.content.find((block) => block.type === "text");
      if (textBlock?.type === "text") {
        const ttsProvider = createTTSProvider(request.provider);
        ttsOutput = await ttsProvider.synthesize({
          text: textBlock.text,
          persona
        });
      }
    }

    const firstTextBlock = llmOutput.content.find((block) => block.type === "text");
    const assistantText = firstTextBlock?.type === "text" ? firstTextBlock.text : llmOutput.rawText;

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
      llmOutput,
      conversationId: updatedConversation.id,
      history: updatedConversation.messages,
      includeAudio: request.audio,
      ...(ttsOutput ? { ttsOutput } : {})
    });
  }
}
