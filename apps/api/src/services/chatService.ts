import { randomUUID } from "node:crypto";
import { llmOutputSchema, MAX_CHAT_ATTACHMENTS, type ChatMessage, type ChatRequest, type ChatResponse, type ContentBlock, type UserPersonalizationProfile } from "@persona/shared";
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
import { ToolContextService, type ToolContext } from "./toolContextService.js";
import { buildTtsScriptForSpeech } from "./ttsScriptBuilder.js";
import { limitAudioResponseText } from "./audioResponsePolicy.js";
import { CONVERSATION_MEDIA_UNAVAILABLE_TEXT, resolveConversationMediaContext } from "./conversationMediaContext.js";
import { openAIArtifactService } from "./openAIArtifactService.js";
import { applyPersonaPhraseReplacements } from "./personaPhraseReplacementService.js";
import { getDatabase } from "../db/client.js";
import { users } from "../db/schema.js";
import { analyzeImageReferenceRequirement, missingImageReferenceMessage } from "./imageReferenceRequirement.js";

export type ChatStreamCallbacks = {
  onTextDelta: (delta: string) => void;
};

export type ChatProgressCallbacks = {
  onProviderResponse?: (event: { id: string; status?: string }) => void;
};

export type ChatServiceOptions = {
  ownerId?: string;
};

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
  return provider !== "openai_persona";
}

function isErrorLikeText(text: string): boolean {
  const normalized = text.trim();
  return /^request failed:/i.test(normalized) || /^failed\b/i.test(normalized);
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
}> {
  const db = getDatabase();
  if (!db || !ownerId) return { memoryEnabled: true };
  const [user] = await db.select({
    preferredName: users.preferredName,
    gender: users.gender,
    birthMonth: users.birthMonth,
    birthDay: users.birthDay,
    memoryEnabled: users.memoryEnabled
  }).from(users).where(eq(users.id, ownerId)).limit(1);
  if (!user) return { memoryEnabled: true };
  return {
    memoryEnabled: user.memoryEnabled,
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
    const persona = getPersonaById(request.personaId);
    if (!persona) {
      throw new HttpError(`Unknown persona: ${request.personaId}`, 404);
    }

    const userMessageId = `msg_${randomUUID()}`;
    const assistantMessageId = `msg_${randomUUID()}`;
    const testMode = request.testMode || env.APP_TEST_MODE;
    const userContext = await loadUserChatContext(options.ownerId);
    const conversation = await this.conversationStore.getOrCreate(request.conversationId, request.history, {
      ...(options.ownerId ? { userId: options.ownerId } : {}),
      personaId: request.personaId,
      titleSeed: request.message,
      memoryEnabled: userContext.memoryEnabled
    });
    const imageReferenceRequirement = analyzeImageReferenceRequirement(request.message);
    const currentImageCount = (request.attachments ?? []).filter((attachment) => attachment.kind === "image").length;
    const conversationMediaAttachments = await resolveConversationMediaContext(conversation, {
      message: request.message,
      ...(options.ownerId ? { ownerId: options.ownerId } : {}),
      maxImages: Math.max(MAX_CHAT_ATTACHMENTS - currentImageCount, 0),
      currentImageCount,
      minimumImages: imageReferenceRequirement.minimumImages,
      expectsNewUploads: imageReferenceRequirement.expectsNewUploads
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
      const updatedConversation = await this.conversationStore.appendTurn(conversation, [
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
      const updatedConversation = await this.conversationStore.appendTurn(conversation, [
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
      const updatedConversation = await this.conversationStore.appendTurn(conversation, [
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
      history: this.conversationStore.getPromptContext(conversation)
    }, userProfile);
    // The controller stamps the account preference onto the request before it
    // reserves usage. Keep that value stable for background jobs so generation
    // cannot exceed the reservation if the user changes the setting meanwhile.
    llmInput.conciseAudioResponse = request.conciseAudioResponse;
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
    const toolContext = await this.toolContextService.buildContext(request.message, request.clientContext);
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
    let llmOutput;
    try {
      llmOutput = llmOutputSchema.parse(await measureOperation("provider.llm", {
        provider: request.provider,
        mode: streamCallbacks && llmProvider.generateResponseStream ? "stream" : "standard",
        imageGeneration: Boolean(llmInput.toolOptions?.imageGeneration),
        codeInterpreter: Boolean(llmInput.toolOptions?.codeInterpreter),
        webSearch: Boolean(llmInput.toolOptions?.webSearch)
      }, () => streamCallbacks && llmProvider.generateResponseStream
        ? llmProvider.generateResponseStream(llmInput, streamCallbacks, signal, progressCallbacks)
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
    const neutralText =
      firstNeutralTextBlock?.type === "text" && firstNeutralTextBlock.text.trim().length > 0
        ? firstNeutralTextBlock.text
        : llmOutput.rawText;
    if (streamCallbacks && !llmProvider.generateResponseStream && neutralText) {
      streamCallbacks.onTextDelta(neutralText);
    }

    const neutralResponseMetadata = {
      provider: llmOutput.provider,
      providerModel: llmOutput.metadata?.providerModel,
      personaId: persona.id,
      conversationId: conversation.id,
      userMessage: request.message
    };

    const useStyleTransfer = shouldUseStyleTransfer(request.provider);
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
            skipped: "Provider uses OpenAI direct persona response.",
            mode: "openai_persona_direct"
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

    const styledTextBeforePhraseReplacements = styleTransferOutput.styledText || neutralText;
    const phraseReplacementResult = applyPersonaPhraseReplacements(styledTextBeforePhraseReplacements, persona);
    const responseText = request.audio
      ? limitAudioResponseText(phraseReplacementResult.text, request.conciseAudioResponse)
      : phraseReplacementResult.text;
    let styledPrimaryText = false;
    const styledLlmOutput = llmOutputSchema.parse({
      ...llmOutput,
      rawText: responseText || llmOutput.rawText,
      content: llmOutput.content.map((block) => {
        if (block.type !== "text" || styledPrimaryText) return block;
        styledPrimaryText = true;
        return { ...block, text: responseText };
      }),
      metadata: {
        ...(llmOutput.metadata ?? {}),
        styleTransfer: styleTransferOutput,
        personaPhraseReplacements: {
          totalReplacements: phraseReplacementResult.totalReplacements,
          replacementsByRule: phraseReplacementResult.replacementsByRule
        }
      }
    });

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
        const rawInlineTtsScript = typeof llmOutput.metadata?.ttsScript === "string" ? llmOutput.metadata.ttsScript.trim() : "";
        const inlineTtsScript = rawInlineTtsScript
          ? applyPersonaPhraseReplacements(rawInlineTtsScript, persona).text
          : "";
        let ttsScript = "";
        let ttsScriptMode: "mechanical" | "openai_inline" = inlineTtsScript ? "openai_inline" : "mechanical";
        try {
          const ttsScriptResult = inlineTtsScript
            ? { script: inlineTtsScript, mode: "openai_inline" as const }
            : await buildTtsScriptForSpeech(speechText, persona);
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
            ttsOutput = await measureOperation("provider.tts", { provider: request.provider }, () => ttsProvider.synthesize({
              text: ttsScript,
              persona,
              ...(options.ownerId ? { ownerId: options.ownerId } : {}),
              conversationId: conversation.id
            }));
            ttsDiagnostic = {
              status: "generated",
              provider: ttsOutput.provider,
              url: ttsOutput.url,
              mimeType: ttsOutput.mimeType,
              textCharacters: ttsScript.length,
              scriptMode: ttsScriptMode
            };
          }
        } catch (error) {
          ttsDiagnostic = {
            status: "failed",
            error: error instanceof Error ? error.message : String(error),
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

    const firstTextBlock = responseLlmOutput.content.find((block) => block.type === "text");
    const assistantText = firstTextBlock?.type === "text" ? firstTextBlock.text : responseLlmOutput.rawText;
    const persistedOutputs: ContentBlock[] = [...responseLlmOutput.content];
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

    const updatedConversation = await this.conversationStore.appendTurn(conversation, [
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
      llmOutput: responseLlmOutput,
      conversationId: updatedConversation.id,
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
