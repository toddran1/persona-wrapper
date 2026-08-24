import { randomUUID } from "node:crypto";
import { llmOutputSchema, MAX_CHAT_ATTACHMENTS, type ChatMessage, type ChatRequest, type ChatResponse, type ContentBlock, type ImageProviderId, type UserPersonalizationProfile } from "@persona/shared";
import { eq } from "drizzle-orm";
import type { TTSOutput } from "@persona/shared";
import { getPersonaById } from "../personas/index.js";
import { createLLMProvider } from "../providers/llm/providerFactory.js";
import { createStyleTransferProvider } from "../providers/styleTransfer/providerFactory.js";
import { createTTSProvider } from "../providers/tts/providerFactory.js";
import { env } from "../config/env.js";
import { ConversationStore } from "./conversationStore.js";
import { PersonaEngine } from "./personaEngine.js";
import { ResponseFormatter, type TTSDiagnostic } from "./responseFormatter.js";
import { HttpError } from "../utils/httpError.js";
import { logger } from "../utils/logger.js";
import { measureOperation } from "../utils/observability.js";
import { generatedMediaService } from "./generatedMediaService.js";
import { generatedAudioService } from "./generatedAudioService.js";
import { liveAudioStreamService } from "./liveAudioStreamService.js";
import { stripPersonaAttributionMarkers } from "./personaAttribution.js";
import { ToolContextService, type ToolContext } from "./toolContextService.js";
import { buildTtsScript, buildTtsScriptForSpeech } from "./ttsScriptBuilder.js";
import { limitAudioResponseText } from "./audioResponsePolicy.js";
import { CONVERSATION_MEDIA_UNAVAILABLE_TEXT, resolveConversationMediaContext } from "./conversationMediaContext.js";
import { openAIArtifactService } from "./openAIArtifactService.js";
import { applyPersonaPhraseReplacements } from "./personaPhraseReplacementService.js";
import { getDatabase } from "../db/client.js";
import { users } from "../db/schema.js";
import { analyzeImageReferenceRequirement, missingImageReferenceMessage } from "./imageReferenceRequirement.js";
import {
  sanitizeProfessionalContentBlock,
  sanitizeProfessionalLanguage,
  sanitizeProfessionalSpeech
} from "./professionalLanguageService.js";

export type ChatStreamCallbacks = {
  onTextDelta: (delta: string) => void;
  onAudioStart?: (event: { id: string; url: string; mimeType: string }) => void;
  onAudioComplete?: (event: { id: string }) => void;
  onAudioError?: (event: { id: string }) => void;
};

export type ChatProgressCallbacks = {
  onProviderResponse?: (event: { id: string; status?: string }) => void;
};

export type ChatServiceOptions = {
  ownerId?: string;
  imageProvider?: ImageProviderId;
};

const PUBLIC_TTS_FAILURE_MESSAGE = "Audio could not be generated. You can retry this response or continue with the text reply.";

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

function shouldUseStyleTransfer(provider: ChatRequest["provider"]): boolean {
  return provider === "claude" || provider === "local";
}

function isErrorLikeText(text: string): boolean {
  const normalized = text.trim();
  // Match the provider error envelope only. A bare leading "failed" also
  // matches legitimate persona replies ("Failed your driving test? Baby, ...")
  // and would silently suppress their TTS narration.
  return /^request failed:/i.test(normalized);
}

function hasErrorLikeContent(blocks: ContentBlock[], rawText?: string): boolean {
  if (rawText && isErrorLikeText(rawText)) return true;
  return blocks.some((block) => {
    if (block.type === "status" && (block.status === "failed" || block.status === "cancelled")) return true;
    if (block.type === "tool_result" && block.status === "failed") return true;
    if (block.type === "text" && isErrorLikeText(block.text)) return true;
    return false;
  });
}

async function loadUserChatContext(ownerId?: string): Promise<{
  profile?: UserPersonalizationProfile;
  memoryEnabled: boolean;
  imageProvider?: ImageProviderId;
}> {
  const db = getDatabase();
  if (!db || !ownerId) return { memoryEnabled: true };
  const [user] = await db.select({
    preferredName: users.preferredName,
    gender: users.gender,
    birthMonth: users.birthMonth,
    birthDay: users.birthDay,
    memoryEnabled: users.memoryEnabled,
    imageProvider: users.imageProvider
  }).from(users).where(eq(users.id, ownerId)).limit(1);
  if (!user) return { memoryEnabled: true };
  return {
    memoryEnabled: user.memoryEnabled,
    imageProvider: user.imageProvider === "flux" ? "flux" : "openai",
    profile: {
      preferredName: user.preferredName,
      gender: user.gender === "male" || user.gender === "female" || user.gender === "nonbinary" || user.gender === "other"
        ? user.gender
        : null,
      birthday: user.birthMonth !== null && user.birthDay !== null
        ? { month: user.birthMonth, day: user.birthDay }
        : null
    }
  };
}

export class ChatService {
  constructor(
    private readonly conversationStore = new ConversationStore(),
    private readonly personaEngine = new PersonaEngine(),
    private readonly responseFormatter = new ResponseFormatter(),
    private readonly toolContextService = new ToolContextService()
  ) {}

  async handleChat(
    request: ChatRequest,
    streamCallbacks?: ChatStreamCallbacks,
    signal?: AbortSignal,
    progressCallbacks?: ChatProgressCallbacks,
    options: ChatServiceOptions = {}
  ): Promise<ChatResponse> {
    signal?.throwIfAborted();
    request = {
      ...request,
      personaInfluenceLevel: request.personaInfluenceLevel ?? "uncensored"
    };
    const persona = getPersonaById(request.personaId);
    if (!persona) {
      throw new HttpError(`Unknown persona: ${request.personaId}`, 404);
    }
    // Neutral-style personas never produce audio, regardless of the client's
    // audio toggle — the toggle state itself is left untouched so audio resumes
    // when the user switches back to a voiced persona.
    if (persona.neutralStyle && request.audio) {
      request = { ...request, audio: false };
    }

    const testMode = request.testMode || env.APP_TEST_MODE;
    const userContext = await loadUserChatContext(options.ownerId);
    const conversation = await this.conversationStore.getOrCreate(request.conversationId, request.history, {
      ...(options.ownerId ? { userId: options.ownerId } : {}),
      personaId: request.personaId,
      titleSeed: request.message,
      memoryEnabled: userContext.memoryEnabled
    });
    const retryContext = request.retryAssistantMessageId
      ? this.conversationStore.prepareRetry(conversation, request.retryAssistantMessageId)
      : undefined;
    if (retryContext && retryContext.originalMessage !== request.message) {
      throw new HttpError("The response no longer matches the message being retried.", 409);
    }
    const userMessageId = retryContext?.userMessageId ?? `msg_${randomUUID()}`;
    const assistantMessageId = request.retryAssistantMessageId ?? `msg_${randomUUID()}`;
    const imageReferenceRequirement = analyzeImageReferenceRequirement(request.message);
    const currentImageCount = (request.attachments ?? []).filter((attachment) => attachment.kind === "image").length;
    const conversationMediaAttachments = await resolveConversationMediaContext(retryContext?.conversation ?? conversation, {
      message: request.message,
      ...(options.ownerId ? { ownerId: options.ownerId } : {}),
      provider: request.provider,
      maxImages: Math.max(MAX_CHAT_ATTACHMENTS - currentImageCount, 0),
      currentImageCount,
      minimumImages: imageReferenceRequirement.minimumImages,
      expectsNewUploads: imageReferenceRequirement.expectsNewUploads,
      ...(request.mediaReferenceHint ? { mediaReferenceHint: request.mediaReferenceHint } : {})
    });
    const userAssets = (request.attachments ?? []).map((asset) => ({
      id: asset.id,
      kind: asset.kind,
      fileName: asset.fileName,
      mimeType: asset.mimeType,
      ...(asset.url ? { url: asset.url } : {})
    }));

    if (conversationMediaAttachments.ambiguityMessage) {
      const clarificationText = conversationMediaAttachments.ambiguityMessage;
      const clarificationOutput = llmOutputSchema.parse({
        provider: request.provider,
        rawText: clarificationText,
        content: [{ type: "text", text: clarificationText }],
        metadata: {
          conversationMediaContext: {
            status: "ambiguous",
            candidateCount: conversationMediaAttachments.candidateCount,
            selectedPositions: conversationMediaAttachments.selectedPositions
          }
        }
      });
      if (streamCallbacks) streamCallbacks.onTextDelta(clarificationText);
      logger.info("Visual conversation reference was ambiguous", {
        conversationId: conversation.id,
        personaId: persona.id,
        candidateCount: conversationMediaAttachments.candidateCount,
        selectedPositions: conversationMediaAttachments.selectedPositions
      });
      const assistantMessage = {
        id: assistantMessageId,
        role: "assistant" as const,
        content: clarificationText,
        metadata: {
          personaId: persona.id,
          outputs: clarificationOutput.content,
          provider: clarificationOutput.provider,
          visualClarification: {
            status: "ambiguous" as const,
            originalRequest: request.message,
            selectedPositions: conversationMediaAttachments.selectedPositions
          }
        }
      };
      const updatedConversation = retryContext
        ? await this.conversationStore.replaceAssistantMessage(conversation, assistantMessageId, assistantMessage)
        : await this.conversationStore.appendTurn(conversation, [
          {
            id: userMessageId,
            role: "user",
            content: request.message,
            metadata: {
              provider: request.provider,
              userAssets
            }
          },
          {
          id: assistantMessageId,
          role: "assistant",
          content: clarificationText,
          metadata: {
            personaId: persona.id,
            outputs: clarificationOutput.content,
            provider: clarificationOutput.provider,
            visualClarification: {
              status: "ambiguous",
              originalRequest: request.message,
              selectedPositions: conversationMediaAttachments.selectedPositions
            }
          }
          }
        ]);
      return this.responseFormatter.format({
        persona,
        llmOutput: clarificationOutput,
        conversationId: updatedConversation.id,
        userMessageId,
        assistantMessageId,
        history: updatedConversation.messages,
        includeAudio: false,
        diagnostics: {
          testMode,
          ...(testMode ? { neutralResponse: clarificationText } : {})
        }
      });
    }

    if (
      !request.attachments?.length &&
      !imageReferenceRequirement.expectsNewUploads &&
      conversationMediaAttachments.referenced &&
      conversationMediaAttachments.candidateCount > 0 &&
      conversationMediaAttachments.attachments.length === 0 &&
      conversationMediaAttachments.unavailableCount > 0
    ) {
      const fallbackOutput = llmOutputSchema.parse({
        provider: request.provider,
        rawText: CONVERSATION_MEDIA_UNAVAILABLE_TEXT,
        content: [
          {
            type: "text",
            text: CONVERSATION_MEDIA_UNAVAILABLE_TEXT
          },
          {
            type: "tool_result",
            toolName: "conversation_media_context",
            status: "failed",
            result: {
              reason: "generated_media_unavailable",
              candidateCount: conversationMediaAttachments.candidateCount,
              unavailableCount: conversationMediaAttachments.unavailableCount
            }
          }
        ],
        metadata: {
          conversationMediaContext: {
            status: "unavailable",
            candidateCount: conversationMediaAttachments.candidateCount,
            unavailableCount: conversationMediaAttachments.unavailableCount
          }
        }
      });
      logger.llmTurn({
        conversationId: conversation.id,
        personaId: persona.id,
        provider: request.provider,
        testMode,
        status: "failed",
        messageCharacters: request.message.length,
        neutralLlm: testMode
          ? {
              skipped: "Referenced generated media was unavailable.",
              conversationMediaContext: conversationMediaAttachments
            }
          : {
              skipped: "Referenced generated media was unavailable.",
              conversationMediaContext: {
                imageCount: conversationMediaAttachments.attachments.length,
                candidateCount: conversationMediaAttachments.candidateCount,
                unavailableCount: conversationMediaAttachments.unavailableCount
              }
            }
      });
      const assistantMessage = {
        id: assistantMessageId,
        role: "assistant" as const,
        content: CONVERSATION_MEDIA_UNAVAILABLE_TEXT,
        metadata: {
          personaId: persona.id,
          outputs: fallbackOutput.content,
          provider: fallbackOutput.provider
        }
      };
      const updatedConversation = retryContext
        ? await this.conversationStore.replaceAssistantMessage(conversation, assistantMessageId, assistantMessage)
        : await this.conversationStore.appendTurn(conversation, [
          {
            id: userMessageId,
            role: "user",
            content: request.message,
            metadata: {
              provider: request.provider,
              userAssets
            }
          },
          {
          id: assistantMessageId,
          role: "assistant",
          content: CONVERSATION_MEDIA_UNAVAILABLE_TEXT,
          metadata: {
            personaId: persona.id,
            outputs: fallbackOutput.content,
            provider: fallbackOutput.provider
          }
          }
        ]);

      return this.responseFormatter.format({
        persona,
        llmOutput: fallbackOutput,
        conversationId: updatedConversation.id,
        userMessageId,
        assistantMessageId,
        history: updatedConversation.messages,
        includeAudio: false,
        diagnostics: {
          testMode,
          ...(testMode ? { neutralResponse: CONVERSATION_MEDIA_UNAVAILABLE_TEXT } : {})
        }
      });
    }

    const contextualImageCount = conversationMediaAttachments.attachments.filter((attachment) => attachment.kind === "image").length;
    const availableImageCount = currentImageCount + contextualImageCount;
    const requiredImageCount = Math.max(
      imageReferenceRequirement.minimumImages,
      conversationMediaAttachments.minimumImages
    );
    const requiresImageReferences = imageReferenceRequirement.required ||
      (conversationMediaAttachments.referenced && conversationMediaAttachments.candidateCount > 0);
    if (requiresImageReferences && availableImageCount < requiredImageCount) {
      const clarificationText = missingImageReferenceMessage(
        requiredImageCount,
        availableImageCount
      );
      const clarificationOutput = llmOutputSchema.parse({
        provider: request.provider,
        rawText: clarificationText,
        content: [{ type: "text", text: clarificationText }],
        metadata: {
          imageReferenceRequirement: {
            status: "missing",
            requiredImages: requiredImageCount,
            availableImages: availableImageCount,
            expectsNewUploads: imageReferenceRequirement.expectsNewUploads,
            conversationMediaSource: conversationMediaAttachments.source
          }
        }
      });
      if (streamCallbacks) streamCallbacks.onTextDelta(clarificationText);
      logger.llmTurn({
        conversationId: conversation.id,
        personaId: persona.id,
        provider: request.provider,
        testMode,
        status: "completed",
        messageCharacters: request.message.length,
        neutralLlm: {
          skipped: "Required image references were not supplied.",
          requiredImages: requiredImageCount,
          availableImages: availableImageCount,
          expectsNewUploads: imageReferenceRequirement.expectsNewUploads,
          conversationMediaSource: conversationMediaAttachments.source
        }
      });
      const assistantMessage = {
        id: assistantMessageId,
        role: "assistant" as const,
        content: clarificationText,
        metadata: {
          personaId: persona.id,
          outputs: clarificationOutput.content,
          provider: clarificationOutput.provider
        }
      };
      const updatedConversation = retryContext
        ? await this.conversationStore.replaceAssistantMessage(conversation, assistantMessageId, assistantMessage)
        : await this.conversationStore.appendTurn(conversation, [
          {
            id: userMessageId,
            role: "user",
            content: request.message,
            metadata: {
              provider: request.provider,
              userAssets
            }
          },
          {
          id: assistantMessageId,
          role: "assistant",
          content: clarificationText,
          metadata: {
            personaId: persona.id,
            outputs: clarificationOutput.content,
            provider: clarificationOutput.provider
          }
          }
        ]);

      return this.responseFormatter.format({
        persona,
        llmOutput: clarificationOutput,
        conversationId: updatedConversation.id,
        userMessageId,
        assistantMessageId,
        history: updatedConversation.messages,
        includeAudio: false,
        diagnostics: {
          testMode,
          ...(testMode ? { neutralResponse: clarificationText } : {})
        }
      });
    }

    const userProfile = userContext.profile;
    const llmProvider = createLLMProvider(request.provider);
    const resolvedHistoricalVisuals = conversationMediaAttachments.attachments.length > 0;
    const effectiveToolOptions = resolvedHistoricalVisuals && conversationMediaAttachments.intent === "transform"
      ? {
          webSearch: request.toolOptions?.webSearch ?? false,
          fileSearch: request.toolOptions?.fileSearch ?? false,
          codeInterpreter: request.toolOptions?.codeInterpreter ?? false,
          imageGeneration: true,
          videoAnalysis: request.toolOptions?.videoAnalysis ?? false,
          ...(request.toolOptions?.videoAnalysisMode
            ? { videoAnalysisMode: request.toolOptions.videoAnalysisMode }
            : {}),
          ...(request.toolOptions?.imageQuality ? { imageQuality: request.toolOptions.imageQuality } : {}),
          appFunctions: request.toolOptions?.appFunctions ?? true,
          background: request.toolOptions?.background ?? false,
          vectorStoreIds: request.toolOptions?.vectorStoreIds ?? []
        }
      : request.toolOptions;
    const llmInput = this.personaEngine.prepareInput(persona, {
      ...request,
      attachments: [...(request.attachments ?? []), ...conversationMediaAttachments.attachments],
      ...(effectiveToolOptions ? { toolOptions: effectiveToolOptions } : {}),
      conversationId: conversation.id,
      history: retryContext?.history ?? this.conversationStore.getPromptContext(conversation)
    }, userProfile);
    // The controller stamps the account preference onto the request before it
    // reserves usage. Keep that value stable for background jobs so generation
    // cannot exceed the reservation if the user changes the setting meanwhile.
    llmInput.conciseAudioResponse = request.conciseAudioResponse;
    // The controller stamps the resolved preference onto the request (kept
    // stable for background jobs); fall back to the live account value only
    // when no stamp is present.
    llmInput.imageProvider = request.imageProvider ?? options.imageProvider ?? userContext.imageProvider;
    llmInput.imageOrientation = request.imageOrientation;
    if (
      conversationMediaAttachments.promptContext &&
      conversationMediaAttachments.source !== "none"
    ) {
      llmInput.visualContext = {
        intent: conversationMediaAttachments.intent,
        source: conversationMediaAttachments.source,
        summary: conversationMediaAttachments.promptContext,
        selectedTurnIndexes: conversationMediaAttachments.selectedTurnIndexes,
        selectedPositions: conversationMediaAttachments.selectedPositions
      };
    }
    const toolContext = await this.toolContextService.buildContext(
      request.message,
      request.clientContext,
      retryContext?.history ?? this.conversationStore.getPromptContext(conversation),
      signal,
      options.ownerId
        ? { ownerId: options.ownerId, attachments: llmInput.attachments ?? [], provider: request.provider }
        : undefined
    );
    if (toolContext) {
      llmInput.messages = insertToolContext(llmInput.messages, toolContext);
      llmInput.baseMessages = insertToolContext(llmInput.baseMessages ?? llmInput.messages, toolContext);
      if (testMode) {
        console.log(
          `\n--- Tool context before neutral LLM ---\n\n${toolContext.results
            .map((result) => `${result.name} (${result.status}): ${result.summary}`)
            .join("\n\n")}\n`
        );
      } else {
        logger.info("Tool context prepared for LLM", {
          conversationId: conversation.id,
          personaId: persona.id,
          provider: request.provider,
          tools: toolContext.results.map((result) => ({
            name: result.name,
            status: result.status,
            summaryCharacters: result.summary.length
          }))
        });
      }
    }
    const providerStreamCallbacks = streamCallbacks && request.personaInfluenceLevel === "professional"
      ? { onTextDelta: (_delta: string) => undefined }
      : streamCallbacks;
    let llmOutput;
    try {
      llmOutput = llmOutputSchema.parse(await measureOperation("provider.llm", {
        provider: request.provider,
        mode: providerStreamCallbacks && llmProvider.generateResponseStream ? "stream" : "standard",
        imageGeneration: Boolean(llmInput.toolOptions?.imageGeneration),
        codeInterpreter: Boolean(llmInput.toolOptions?.codeInterpreter),
        webSearch: Boolean(llmInput.toolOptions?.webSearch)
      }, () => providerStreamCallbacks && llmProvider.generateResponseStream
        ? llmProvider.generateResponseStream(llmInput, providerStreamCallbacks, signal, progressCallbacks)
        : llmProvider.generateResponse(llmInput, signal, progressCallbacks)));
    } catch (error) {
      logger.llmTurn({
        conversationId: conversation.id,
        personaId: persona.id,
        provider: request.provider,
        testMode,
        status: "failed",
        messageCharacters: request.message.length,
        error: {
          message: error instanceof Error ? error.message : String(error),
          name: error instanceof Error ? error.name : undefined
        },
        neutralLlm: testMode
          ? {
              requestMessages: llmInput.baseMessages ?? llmInput.messages,
              toolOptions: llmInput.toolOptions,
              conversationMediaContext: {
                imageCount: conversationMediaAttachments.attachments.length,
                candidateCount: conversationMediaAttachments.candidateCount,
                unavailableCount: conversationMediaAttachments.unavailableCount
              },
              toolContext: toolContext?.results ?? []
            }
          : {
              requestMessageCount: (llmInput.baseMessages ?? llmInput.messages).length,
              toolOptions: llmInput.toolOptions,
              conversationMediaContext: {
                imageCount: conversationMediaAttachments.attachments.length,
                candidateCount: conversationMediaAttachments.candidateCount,
                unavailableCount: conversationMediaAttachments.unavailableCount
              },
              toolContext: toolContext?.results.map((result) => ({
                name: result.name,
                status: result.status,
                summaryCharacters: result.summary.length
              })) ?? []
            }
      });
      throw error;
    }
    const firstNeutralTextBlock = llmOutput.content.find((block) => block.type === "text");
    const rawNeutralText =
      firstNeutralTextBlock?.type === "text" && firstNeutralTextBlock.text.trim().length > 0
        ? firstNeutralTextBlock.text
        : llmOutput.rawText;
    const neutralText = stripPersonaAttributionMarkers(rawNeutralText);
    if (streamCallbacks && request.personaInfluenceLevel !== "professional" && !llmProvider.generateResponseStream && neutralText) {
      streamCallbacks.onTextDelta(neutralText);
    }

    const neutralResponseMetadata = {
      provider: llmOutput.provider,
      providerModel: llmOutput.metadata?.providerModel,
      personaId: persona.id,
      conversationId: conversation.id,
      userMessage: request.message
    };

    // Trained style-transfer examples intentionally target the uncensored
    // voice. Professional mode uses the persona's clean instructions directly
    // so the second pass cannot reintroduce profanity or vulgar catchphrases.
    const useStyleTransfer = shouldUseStyleTransfer(request.provider)
      && !persona.neutralStyle
      && request.personaInfluenceLevel === "uncensored";
    if (testMode) {
      console.log(useStyleTransfer ? "\nNeutral LLM response object data:" : "\nDirect persona LLM response object data:", neutralResponseMetadata);
      console.log(
        useStyleTransfer
          ? `\n--- Neutral LLM response before style transfer ---\n\n${neutralText}\n`
          : `\n--- Direct persona LLM response ---\n\n${neutralText}\n`
      );
    } else {
      logger.info(useStyleTransfer ? "Neutral LLM response received" : "Direct persona LLM response received", {
        provider: llmOutput.provider,
        providerModel: llmOutput.metadata?.providerModel,
        personaId: persona.id,
        conversationId: conversation.id,
        textCharacters: neutralText.length,
        contentTypes: llmOutput.content.map((block) => block.type),
        usage: llmOutput.usage
      });
    }

    const styleTransferInput = {
      neutralText,
      persona,
      conversationHistory: conversation.messages,
      userMessage: request.message,
      provider: llmOutput.provider
    };
    const styleTransferOutput = useStyleTransfer
      ? neutralText.trim()
        ? await measureOperation("provider.style_transfer", { provider: request.provider }, () =>
          createStyleTransferProvider().transferStyle(styleTransferInput, signal)
        )
        : {
            provider: "stub_style_transfer" as const,
            styledText: "",
            metadata: { skipped: "No text content to style." }
          }
      : {
          provider: "stub_style_transfer" as const,
          styledText: neutralText,
          metadata: {
            skipped: "Provider produces the persona response directly.",
            mode: "direct_persona_response"
          }
        };

    if (useStyleTransfer && styleTransferOutput.styledText && testMode) {
      console.log(`--- Style transfer model response ---\n\n${styleTransferOutput.styledText}\n`);
    } else if (useStyleTransfer && styleTransferOutput.styledText) {
      logger.info("Style transfer response received", {
        personaId: persona.id,
        conversationId: conversation.id,
        provider: styleTransferOutput.provider,
        textCharacters: styleTransferOutput.styledText.length
      });
    }

    const styledTextBeforePhraseReplacements = stripPersonaAttributionMarkers(
      styleTransferOutput.styledText || neutralText
    );
    const phraseReplacementResult = request.personaInfluenceLevel === "professional"
      ? { text: styledTextBeforePhraseReplacements, totalReplacements: 0, replacementsByRule: {} }
      : applyPersonaPhraseReplacements(styledTextBeforePhraseReplacements, persona);
    const professionalLanguageResult = request.personaInfluenceLevel === "professional"
      ? sanitizeProfessionalLanguage(phraseReplacementResult.text)
      : { text: phraseReplacementResult.text, replacements: 0 };
    const fullResponseText = professionalLanguageResult.text.trim();
    // Never cut a user-visible answer after generation. The concise-audio
    // instruction guides the model toward an affordable length; the separate
    // speech script cap below is the cost-control backstop for narration.
    const responseText = fullResponseText;
    let styledPrimaryText = false;
    let professionalContentBlockReplacements = 0;
    const styledLlmOutput = llmOutputSchema.parse({
      ...llmOutput,
      rawText: request.personaInfluenceLevel === "professional"
        ? responseText
        : responseText || llmOutput.rawText,
      content: llmOutput.content.map((block) => {
        if (block.type !== "text") {
          if (request.personaInfluenceLevel !== "professional") return block;
          const sanitized = sanitizeProfessionalContentBlock(block);
          professionalContentBlockReplacements += sanitized.replacements;
          return sanitized.block;
        }
        if (styledPrimaryText) {
          const text = stripPersonaAttributionMarkers(block.text);
          if (request.personaInfluenceLevel !== "professional") return { ...block, text };
          const sanitized = sanitizeProfessionalContentBlock({ ...block, text });
          professionalContentBlockReplacements += sanitized.replacements;
          return sanitized.block;
        }
        styledPrimaryText = true;
        return { ...block, text: responseText };
      }),
      metadata: {
        ...(llmOutput.metadata ?? {}),
        styleTransfer: styleTransferOutput,
        personaPhraseReplacements: {
          totalReplacements: phraseReplacementResult.totalReplacements,
          replacementsByRule: phraseReplacementResult.replacementsByRule
        },
        professionalLanguageReplacements:
          professionalLanguageResult.replacements + professionalContentBlockReplacements
      }
    });

    if (request.personaInfluenceLevel === "professional" && streamCallbacks && responseText) {
      streamCallbacks.onTextDelta(responseText);
    }

    const ownershipMetadata = {
      provider: llmOutput.provider,
      personaId: persona.id
    };
    const persistedMediaContent = await generatedMediaService.normalizeContentBlocks(styledLlmOutput.content, {
      ...(options.ownerId ? { ownerId: options.ownerId } : {}),
      conversationId: conversation.id,
      metadata: ownershipMetadata
    });
    const persistedArtifactContent = await openAIArtifactService.assignOwnershipToContentBlocks(persistedMediaContent, {
      ...(options.ownerId ? { ownerId: options.ownerId } : {}),
      conversationId: conversation.id,
      metadata: ownershipMetadata
    });
    const responseLlmOutput = llmOutputSchema.parse({
      ...styledLlmOutput,
      content: persistedArtifactContent
    });

    let ttsOutput: TTSOutput | undefined;
    const responseHasErrorContent = hasErrorLikeContent(responseLlmOutput.content, responseLlmOutput.rawText);
    let ttsDiagnostic: TTSDiagnostic | undefined = request.audio
      ? responseHasErrorContent
        ? { status: "skipped_no_text", reason: "Error responses are not narrated." }
        : { status: "skipped_no_text", reason: "No text content available for speech." }
      : { status: "not_requested" };
    let ttsScriptLog: { mode: "mechanical" | "openai_inline"; text: string; textCharacters: number } | undefined;
    if (request.audio && responseHasErrorContent) {
      logger.info("Skipping TTS generation because response is an error", {
        provider: request.provider,
        personaId: persona.id,
        conversationId: conversation.id
      });
    } else if (request.audio) {
      const textBlock = responseLlmOutput.content.find((block) => block.type === "text");
      const speechText = textBlock?.type === "text" ? textBlock.text.trim() : "";
      if (speechText) {
        const rawInlineTtsScript = typeof llmOutput.metadata?.ttsScript === "string"
          ? stripPersonaAttributionMarkers(llmOutput.metadata.ttsScript.trim())
          : "";
        const inlineTtsScript = rawInlineTtsScript
          ? buildTtsScript(
              request.personaInfluenceLevel === "professional"
                ? sanitizeProfessionalSpeech(rawInlineTtsScript).text
                : applyPersonaPhraseReplacements(rawInlineTtsScript, persona).text,
              persona,
              request.personaInfluenceLevel
            )
          : "";
        let ttsScript = "";
        let ttsScriptMode: "mechanical" | "openai_inline" = inlineTtsScript ? "openai_inline" : "mechanical";
        try {
          const ttsScriptResult = inlineTtsScript
            ? { script: inlineTtsScript, mode: "openai_inline" as const }
            : await buildTtsScriptForSpeech(speechText, persona, request.personaInfluenceLevel);
          ttsScriptMode = ttsScriptResult.mode;
          ttsScript = limitAudioResponseText(
            ttsScriptResult.script.trim(),
            request.conciseAudioResponse
          );
          if (ttsScript) {
            ttsScriptLog = {
              mode: ttsScriptMode,
              text: ttsScript,
              textCharacters: ttsScript.length
            };
          }
          if (!ttsScript) {
            ttsDiagnostic = {
              status: "skipped_no_text",
              reason: "TTS script was empty after cleanup.",
              scriptMode: ttsScriptMode
            };
            logger.info("Skipping TTS generation because speech script is empty", {
              provider: request.provider,
              personaId: persona.id,
              conversationId: conversation.id,
              scriptMode: ttsScriptMode
            });
          } else {
            ttsDiagnostic = {
              status: "failed",
              textCharacters: ttsScript.length,
              scriptMode: ttsScriptMode
            };
            const ttsProvider = createTTSProvider(request.provider);
            let liveAudioToken: string | undefined;
            const disableLiveAudio = (error: unknown) => {
              const token = liveAudioToken;
              liveAudioToken = undefined;
              if (token) liveAudioStreamService.fail(token);
              if (token) {
                try {
                  streamCallbacks?.onAudioError?.({ id: token });
                } catch {
                  // A disconnected SSE consumer must not prevent persisted TTS.
                }
              }
              logger.warn("Live audio delivery failed; continuing with persisted audio", {
                provider: request.provider,
                personaId: persona.id,
                conversationId: conversation.id,
                error: error instanceof Error ? error.message : String(error)
              });
            };
            try {
              ttsOutput = await measureOperation("provider.tts", { provider: request.provider }, () => ttsProvider.synthesize({
                text: ttsScript,
                persona,
                ...(options.ownerId ? { ownerId: options.ownerId } : {}),
                conversationId: conversation.id,
                messageId: assistantMessageId,
                audit: {
                  scriptMode: ttsScriptMode,
                  sourceProvider: request.provider,
                  visibleTextCharacters: speechText.length
                }
              }, signal, streamCallbacks ? {
                onStart: ({ mimeType }) => {
                  try {
                    const stream = liveAudioStreamService.create(mimeType);
                    liveAudioToken = stream.token;
                    streamCallbacks.onAudioStart?.({ id: stream.token, url: stream.url, mimeType });
                  } catch (error) {
                    disableLiveAudio(error);
                  }
                },
                onChunk: async (chunk) => {
                  if (!liveAudioToken) return;
                  try {
                    await liveAudioStreamService.write(liveAudioToken, chunk);
                  } catch (error) {
                    disableLiveAudio(error);
                  }
                }
              } : undefined));
              if (liveAudioToken) {
                const completedLiveAudioToken = liveAudioToken;
                liveAudioStreamService.complete(completedLiveAudioToken);
                liveAudioToken = undefined;
                try {
                  streamCallbacks?.onAudioComplete?.({ id: completedLiveAudioToken });
                } catch {
                  // The saved audio is complete even if the SSE consumer left.
                }
              }
            } catch (error) {
              if (liveAudioToken) {
                liveAudioStreamService.fail(liveAudioToken);
                try {
                  streamCallbacks?.onAudioError?.({ id: liveAudioToken });
                } catch {
                  // Preserve the provider error and persisted fallback behavior.
                }
              }
              throw error;
            }
            ttsDiagnostic = {
              status: "generated",
              provider: ttsOutput.provider,
              url: ttsOutput.url,
              mimeType: ttsOutput.mimeType,
              textCharacters: ttsOutput.billableCharacters ?? ttsScript.length,
              textUtf8Bytes: ttsOutput.billableUtf8Bytes ?? Buffer.byteLength(ttsScript, "utf8"),
              ...(ttsOutput.model ? { providerModel: ttsOutput.model } : {}),
              scriptMode: ttsScriptMode
            };
          }
        } catch (error) {
          if (signal?.aborted) throw error;
          ttsDiagnostic = {
            status: "failed",
            error: PUBLIC_TTS_FAILURE_MESSAGE,
            textCharacters: ttsScript.length,
            scriptMode: ttsScriptMode
          };
          logger.warn("TTS generation failed; returning chat response without audio", {
            provider: request.provider,
            personaId: persona.id,
            conversationId: conversation.id,
            error: error instanceof Error ? error.message : String(error)
          });
        }
      } else {
        logger.info("Skipping TTS generation because response has no text content", {
          provider: request.provider,
          personaId: persona.id,
          conversationId: conversation.id
        });
      }
    }

    const ttsLogPayload = ttsDiagnostic
      ? {
          ...ttsDiagnostic,
          ...(ttsScriptLog ? { script: ttsScriptLog } : {})
        }
      : undefined;
    const sanitizedTtsLogPayload = ttsDiagnostic
      ? {
          ...ttsDiagnostic,
          ...(ttsScriptLog ? { script: { mode: ttsScriptLog.mode, textCharacters: ttsScriptLog.textCharacters } } : {})
        }
      : undefined;
    const openAiDualTextPayload =
      llmOutput.metadata?.ttsScriptParseStatus === "parsed" && typeof llmOutput.metadata.ttsScript === "string"
        ? {
            visible_text: neutralText,
            tts_script: llmOutput.metadata.ttsScript
          }
        : undefined;

    logger.llmTurn(testMode
      ? {
          conversationId: conversation.id,
          personaId: persona.id,
          userMessage: request.message,
          provider: request.provider,
          testMode,
          usage: llmOutput.usage,
          neutralLlm: {
            requestMessages: llmInput.baseMessages ?? llmInput.messages,
            responseMetadata: neutralResponseMetadata,
            usage: llmOutput.usage,
            responseText: neutralText,
            conversationMediaContext: {
              imageCount: conversationMediaAttachments.attachments.length,
              candidateCount: conversationMediaAttachments.candidateCount,
              unavailableCount: conversationMediaAttachments.unavailableCount
            },
            ...(openAiDualTextPayload ? { responsePayload: openAiDualTextPayload } : {}),
            ...(typeof llmOutput.metadata?.ttsScriptParseStatus === "string" ? { responsePayloadStatus: llmOutput.metadata.ttsScriptParseStatus } : {}),
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
            responseMetadata: {
              ...(styleTransferOutput.metadata ?? {}),
              skipped: !useStyleTransfer
            }
          },
          tts: ttsLogPayload
        }
      : {
          conversationId: conversation.id,
          personaId: persona.id,
          provider: request.provider,
          testMode,
          usage: llmOutput.usage,
          messageCharacters: request.message.length,
          neutralLlm: {
            requestMessageCount: (llmInput.baseMessages ?? llmInput.messages).length,
            responseMetadata: {
              provider: llmOutput.provider,
              providerModel: llmOutput.metadata?.providerModel,
              personaId: persona.id,
              conversationId: conversation.id
            },
            usage: llmOutput.usage,
            responseCharacters: neutralText.length,
            responsePayloadStatus: typeof llmOutput.metadata?.ttsScriptParseStatus === "string"
              ? llmOutput.metadata.ttsScriptParseStatus
              : undefined,
            contentTypes: llmOutput.content.map((block) => block.type),
            conversationMediaContext: {
              imageCount: conversationMediaAttachments.attachments.length,
              candidateCount: conversationMediaAttachments.candidateCount,
              unavailableCount: conversationMediaAttachments.unavailableCount
            },
            toolContext: toolContext?.results.map((result) => ({
              name: result.name,
              status: result.status,
              summaryCharacters: result.summary.length
            })) ?? []
          },
          styleTransfer: {
            request: {
              neutralTextCharacters: styleTransferInput.neutralText.length,
              userMessageCharacters: styleTransferInput.userMessage.length,
              provider: styleTransferInput.provider,
              conversationHistoryCount: styleTransferInput.conversationHistory.length
            },
            responseCharacters: styleTransferOutput.styledText.length,
            responseMetadata: {
              ...(styleTransferOutput.metadata ?? {}),
              skipped: !useStyleTransfer
            }
          },
          tts: sanitizedTtsLogPayload
        },
    );

    const responseOutputWithTtsStatus = ttsDiagnostic?.status === "failed"
      ? llmOutputSchema.parse({
          ...responseLlmOutput,
          content: [
            ...responseLlmOutput.content,
            {
              type: "status",
              status: "failed",
              message: PUBLIC_TTS_FAILURE_MESSAGE
            }
          ]
        })
      : responseLlmOutput;
    const firstTextBlock = responseOutputWithTtsStatus.content.find((block) => block.type === "text");
    const assistantText = firstTextBlock?.type === "text" ? firstTextBlock.text : responseOutputWithTtsStatus.rawText;
    const persistedOutputs: ContentBlock[] = [...responseOutputWithTtsStatus.content];
    if (request.audio && ttsOutput) {
      persistedOutputs.push({
        type: "audio",
        url: ttsOutput.url,
        mimeType: ttsOutput.mimeType,
        transcript: firstTextBlock?.type === "text" ? firstTextBlock.text : responseLlmOutput.rawText
      });
    }
    const providerModel = typeof llmOutput.metadata?.providerModel === "string" ? llmOutput.metadata.providerModel : undefined;
    const responseId = typeof llmOutput.metadata?.responseId === "string" ? llmOutput.metadata.responseId : undefined;

    const assistantMessage = {
      id: assistantMessageId,
      role: "assistant" as const,
      content: assistantText,
      metadata: {
        personaId: persona.id,
        outputs: persistedOutputs,
        provider: responseLlmOutput.provider,
        ...(providerModel ? { providerModel } : {}),
        ...(responseId ? { responseId } : {}),
        ...(styleTransferOutput.provider ? { styleTransferProvider: styleTransferOutput.provider } : {}),
        ...(responseLlmOutput.usage ? { usage: responseLlmOutput.usage } : {})
      }
    };
    const updatedConversation = retryContext
      ? await this.conversationStore.replaceAssistantMessage(conversation, assistantMessageId, assistantMessage)
      : await this.conversationStore.appendTurn(conversation, [
        {
          id: userMessageId,
          role: "user",
          content: request.message,
          metadata: {
            provider: request.provider,
            userAssets
          }
        },
        {
        id: assistantMessageId,
        role: "assistant",
        content: assistantText,
        metadata: {
          personaId: persona.id,
          outputs: persistedOutputs,
          provider: responseLlmOutput.provider,
          ...(providerModel ? { providerModel } : {}),
          ...(responseId ? { responseId } : {}),
          ...(styleTransferOutput.provider ? { styleTransferProvider: styleTransferOutput.provider } : {}),
          ...(responseLlmOutput.usage ? { usage: responseLlmOutput.usage } : {})
        }
        }
      ]);

    // Generated audio is created before the assistant turn is persisted so it
    // can be included in that turn's outputs. Link the optional message foreign
    // key only after appendTurn has inserted the assistant message.
    if (ttsOutput) {
      await generatedAudioService.associateWithMessage(ttsOutput.url, assistantMessageId).catch((error) => {
        logger.warn("Generated audio message ownership update failed after chat persistence", {
          conversationId: updatedConversation.id,
          messageId: assistantMessageId,
          error: error instanceof Error ? error.message : String(error)
        });
      });
    }

    // `openai_artifacts.message_id` references `messages.id`. The assistant
    // message must exist before linking the artifact to it, otherwise a
    // generated file turns an otherwise-complete response into a database
    // foreign-key failure.
    await openAIArtifactService.assignOwnershipToContentBlocks(persistedArtifactContent, {
      ...(options.ownerId ? { ownerId: options.ownerId } : {}),
      conversationId: updatedConversation.id,
      messageId: assistantMessageId,
      metadata: ownershipMetadata
    }).catch((error) => {
      logger.warn("OpenAI artifact message ownership update failed after chat persistence", {
        conversationId: updatedConversation.id,
        messageId: assistantMessageId,
        error: error instanceof Error ? error.message : String(error)
      });
    });

    return this.responseFormatter.format({
      persona,
      llmOutput: responseOutputWithTtsStatus,
      conversationId: updatedConversation.id,
      userMessageId,
      assistantMessageId,
      history: updatedConversation.messages,
      includeAudio: request.audio,
      diagnostics: {
        testMode,
        ...(testMode ? { neutralResponse: neutralText } : {}),
        ...(typeof llmOutput.metadata?.responseId === "string" ? { responseId: llmOutput.metadata.responseId } : {}),
        ...(typeof llmOutput.metadata?.providerModel === "string" ? { providerModel: llmOutput.metadata.providerModel } : {}),
        ...(ttsDiagnostic ? { tts: ttsDiagnostic } : {})
      },
      ...(ttsOutput ? { ttsOutput } : {})
    });
  }
}
