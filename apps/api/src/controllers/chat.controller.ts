import { randomUUID } from "node:crypto";
import type { Request, Response } from "express";
import { z } from "zod";
import { chatRequestSchema, type ChatRequest, type ChatResponse, type ImageProviderId, type PersonaDefinition } from "@persona/shared";
import { ChatService } from "../services/chatService.js";
import { ConversationStore } from "../services/conversationStore.js";
import { EvalCaptureService } from "../services/evalCaptureService.js";
import { backgroundChatJobService } from "../services/backgroundChatJobService.js";
import { getPersonaById } from "../personas/index.js";
import { uploadService } from "../services/uploadService.js";
import { HttpError } from "../utils/httpError.js";
import { selectTools } from "../services/toolSelectionService.js";
import { usageControlService } from "../services/usageControlService.js";
import { openAIResponseLifecycleService } from "../services/openAIResponseLifecycleService.js";
import { requestOwnerId } from "../utils/requestIdentity.js";
import { requestAbuseSignals } from "../utils/requestAbuseSignals.js";
import { logger } from "../utils/logger.js";
import { customerUsageService } from "../services/customerUsageService.js";
import { planAllowsImageProvider, planAllowsModelProvider, type PlanDefinition } from "../services/planCatalog.js";
import {
  actualImageGenerationCredits,
  billableGeneratedImageCount,
  reservedImageGenerationCredits
} from "../services/usageCreditPolicy.js";
import { estimateProviderCost } from "../services/providerCostEstimator.js";
import { env } from "../config/env.js";
import { shouldPlanHistoricalVisualTransformation, shouldUseConversationMediaContext } from "../services/conversationMediaContext.js";
import { shouldUseFluxImageApi } from "../providers/llm/OpenAIProvider.js";
import { applyPlanImageQuality } from "../services/planImageQualityPolicy.js";
import {
  audioUsageReservationCharacters,
  audioUsageReservationSeconds,
  estimatedAudioSecondsForCharacters,
  maxOutputTokensForRequest
} from "../services/audioResponsePolicy.js";
import { conciseAudioResponsesForUser, imageProviderForUser, modelProviderForUser, personaInfluenceLevelForUser } from "../services/accountPreferenceService.js";
import { remoteAttachmentImportService } from "../services/remoteAttachmentImportService.js";
import {
  configuredAudioBillingInput,
  estimateAudioProviderCost,
  PROVIDER_PRICE_CARD_VERSION,
  resolvedAudioBillingInput
} from "../services/providerPriceCatalog.js";

export const conversationStore = new ConversationStore();
const chatService = new ChatService(conversationStore);
const evalCaptureService = new EvalCaptureService();
const evalCaptureRequestSchema = z.object({
  conversationId: z.string().min(1),
  idealStyledText: z.string().min(1),
  notes: z.string().optional(),
  tags: z.array(z.string()).default([])
});
const reviewRecordUpdateSchema = z.object({
  personaId: z.string().min(1),
  kind: z.enum(["evals", "golden", "pairs", "rejections"]),
  id: z.string().min(1),
  updates: z.record(z.string(), z.unknown())
});
const reviewRecordCreateSchema = z.object({
  personaId: z.string().min(1),
  kind: z.enum(["evals", "golden", "pairs", "rejections"]),
  record: z.record(z.string(), z.unknown())
});
const reviewRecordDeleteSchema = z.object({
  personaId: z.string().min(1),
  kind: z.enum(["evals", "golden", "pairs", "rejections"]),
  id: z.string().min(1)
});
const promoteRejectedPairSchema = z.object({
  personaId: z.string().min(1),
  id: z.string().min(1)
});
const reviewQuerySchema = z.object({
  personaId: z.string().min(1).optional()
});
const patchConversationSchema = z.object({
  title: z.string().trim().min(1).max(120).optional(),
  pinned: z.boolean().optional()
}).refine((payload) => payload.title !== undefined || payload.pinned !== undefined, {
  message: "At least one conversation field must be provided."
});

backgroundChatJobService.setExecutor(async (payload, backgroundJob) => {
  if (!backgroundJob.ownerId) throw new Error("Background chat job is missing its owner.");
  const result = await chatService.handleChat(payload, undefined, backgroundJob.abortController.signal, {
    onProviderResponse: (event) => {
      void backgroundChatJobService.trackProviderResponse(backgroundJob.id, event.id, event.status);
    }
  }, { ownerId: backgroundJob.ownerId });
  await usageControlService.recordUsage(
    backgroundJob.ownerId,
    result.usage?.totalTokens,
    result.usage?.estimatedCostUsd,
    backgroundJob.usageReservationId
  );
  if (backgroundJob.customerUsageOperationId) {
    await settleCustomerUsage(backgroundJob.customerUsageOperationId, payload, result).catch((error) => {
      logger.warn("Could not settle customer usage after background chat completion", {
        jobId: backgroundJob.id,
        error: error instanceof Error ? error.message : String(error)
      });
    });
  }
  return result;
});

export async function postChat(request: Request, response: Response): Promise<void> {
  const identity = requestIdentity(request);
  const controller = requestAbortController(request, response);
  const reservationId = await usageControlService.check(identity, requestAbuseSignals(request));
  let customerUsageOperationId: string | undefined;
  let reservationReconciled = false;
  try {
    let payload = await applyPersonaInfluencePreference(
      await applyModelProviderPreference(await resolveOwnedChatAssets(request, controller.signal), identity),
      identity
    );
    payload = await selectToolsForRequest(payload, identity);
    const persona = getPersonaById(payload.personaId);
    if (!persona) {
      throw new HttpError(`Unknown persona: ${payload.personaId}`, 404);
    }
    payload = withoutNeutralPersonaAudio(payload, persona);
    const plan = await customerUsageService.assertPersonaAccess(identity, payload.personaId);
    payload = enforcePlanModelProvider(payload, plan);
    payload = applyPlanImageQuality(payload, plan);
    payload.conciseAudioResponse = await conciseAudioResponsesForUser(identity);
    // Stamp the resolved image provider onto the request so execution —
    // including background jobs — uses the same provider the reservation priced.
    payload.imageProvider = enforcePlanImageProvider(await imageProviderForUser(identity), plan);
    controller.signal.throwIfAborted();
    // Never derive the billing idempotency key from client input (requestId
    // can come from the x-request-id header) — a repeated client key would
    // defeat plan-quota reservation and settlement.
    customerUsageOperationId = await reserveCustomerUsage(
      identity,
      payload,
      `usage_op_${randomUUID()}`,
      payload.imageProvider
    );
    if (shouldRunInBackground(payload)) {
      controller.signal.throwIfAborted();
      const requestedConversationId = payload.conversationId ?? `conv_${randomUUID()}`;
      const conversation = await conversationStore.getOrCreate(requestedConversationId, payload.history, {
        userId: identity,
        personaId: payload.personaId,
        titleSeed: payload.message
      });
      const conversationId = conversation.id;
      const backgroundPayload: ChatRequest = {
        ...payload,
        conversationId,
        toolOptions: {
          webSearch: payload.toolOptions?.webSearch ?? false,
          fileSearch: payload.toolOptions?.fileSearch ?? false,
          codeInterpreter: payload.toolOptions?.codeInterpreter ?? false,
          imageGeneration: payload.toolOptions?.imageGeneration ?? false,
          videoAnalysis: payload.toolOptions?.videoAnalysis ?? false,
          ...(payload.toolOptions?.videoAnalysisMode ? { videoAnalysisMode: payload.toolOptions.videoAnalysisMode } : {}),
          ...(payload.toolOptions?.imageQuality ? { imageQuality: payload.toolOptions.imageQuality } : {}),
          appFunctions: payload.toolOptions?.appFunctions ?? true,
          background: true,
          vectorStoreIds: payload.toolOptions?.vectorStoreIds ?? []
        }
      };
      const job = await backgroundChatJobService.start({
        ownerId: identity,
        provider: backgroundPayload.provider,
        conversationId,
        request: backgroundPayload,
        usageReservationId: reservationId,
        customerUsageOperationId
      });
      response.status(202).json(createPendingChatResponse(backgroundPayload, job.id));
      return;
    }
    const result = await chatService.handleChat(payload, undefined, controller.signal, undefined, { ownerId: identity });
    await usageControlService.recordUsage(identity, result.usage?.totalTokens, result.usage?.estimatedCostUsd, reservationId);
    reservationReconciled = true;
    await settleCustomerUsage(customerUsageOperationId, payload, result).catch((error) => {
      logger.warn("Could not settle customer usage after chat completion", {
        requestId: response.locals.requestId,
        error: error instanceof Error ? error.message : String(error)
      });
    });
    response.status(200).json(result);
  } catch (error) {
    if (!reservationReconciled) {
      await releaseUsageReservation(identity, reservationId, response.locals.requestId);
      if (customerUsageOperationId) await releaseCustomerUsage(customerUsageOperationId, response.locals.requestId);
    }
    throw error;
  }
}

export async function getChatJob(request: Request, response: Response): Promise<void> {
  const job = await backgroundChatJobService.get(String(request.params.jobId ?? ""), requestIdentity(request));
  if (!job) {
    throw new HttpError("Chat job not found", 404);
  }
  response.status(200).json(job);
}

export async function cancelChatJob(request: Request, response: Response): Promise<void> {
  const jobId = String(request.params.jobId ?? "");
  const identity = requestIdentity(request);
  const job = await backgroundChatJobService.get(jobId, identity);
  if (!job) {
    throw new HttpError("Chat job not found", 404);
  }

  if (job.status === "completed" || job.status === "failed" || job.status === "cancelled") {
    response.status(200).json(job);
    return;
  }

  const cancelledJob = await backgroundChatJobService.cancel(jobId, undefined, identity);
  // The provider response may be attached while cancellation is racing with a
  // running worker, so prefer the post-cancellation snapshot.
  const providerResponseId = cancelledJob?.providerResponseId ?? job.providerResponseId;
  if (providerResponseId) {
    await openAIResponseLifecycleService.cancel(providerResponseId);
  }

  response.status(200).json(cancelledJob ?? await backgroundChatJobService.get(jobId, identity));
}

export async function postChatStream(request: Request, response: Response): Promise<void> {
  const identity = requestIdentity(request);
  const controller = requestAbortController(request, response);
  const reservationId = await usageControlService.check(identity, requestAbuseSignals(request));
  let customerUsageOperationId: string | undefined;
  let reservationReconciled = false;
  let payload: ChatRequest;
  try {
    payload = await applyPersonaInfluencePreference(
      await applyModelProviderPreference(await resolveOwnedChatAssets(request, controller.signal), identity),
      identity
    );
    payload = await selectToolsForRequest(payload, identity);
    const persona = getPersonaById(payload.personaId);
    if (!persona) {
      throw new HttpError(`Unknown persona: ${payload.personaId}`, 404);
    }
    payload = withoutNeutralPersonaAudio(payload, persona);
    const plan = await customerUsageService.assertPersonaAccess(identity, payload.personaId);
    payload = enforcePlanModelProvider(payload, plan);
    payload = applyPlanImageQuality(payload, plan);
    payload.conciseAudioResponse = await conciseAudioResponsesForUser(identity);
    payload.imageProvider = enforcePlanImageProvider(await imageProviderForUser(identity), plan);
    controller.signal.throwIfAborted();
    customerUsageOperationId = await reserveCustomerUsage(
      identity,
      payload,
      `usage_op_${randomUUID()}`,
      payload.imageProvider
    );
  } catch (error) {
    // Attachment ownership, request parsing, and tool routing all happen after
    // quota reservation. Release that reservation before the SSE headers are
    // committed so ordinary HTTP error handling can return the real error.
    await releaseUsageReservation(identity, reservationId, response.locals.requestId);
    if (customerUsageOperationId) await releaseCustomerUsage(customerUsageOperationId, response.locals.requestId);
    throw error;
  }
  response.status(200);
  response.setHeader("Content-Type", "text/event-stream");
  response.setHeader("Cache-Control", "no-cache, no-transform");
  response.setHeader("Connection", "keep-alive");
  response.setHeader("X-Accel-Buffering", "no");
  response.flushHeaders();
  try {
    const result = await chatService.handleChat(payload, {
      onTextDelta: (delta) => {
        if (!response.writableEnded) {
          response.write(`event: delta\ndata: ${JSON.stringify({ delta })}\n\n`);
        }
      }
    }, controller.signal, undefined, { ownerId: identity });
    await usageControlService.recordUsage(identity, result.usage?.totalTokens, result.usage?.estimatedCostUsd, reservationId);
    reservationReconciled = true;
    await settleCustomerUsage(customerUsageOperationId, payload, result).catch((error) => {
      logger.warn("Could not settle customer usage after streaming chat completion", {
        requestId: response.locals.requestId,
        error: error instanceof Error ? error.message : String(error)
      });
    });
    response.write(`event: response\ndata: ${JSON.stringify(result)}\n\n`);
    response.end();
  } catch (error) {
    if (!reservationReconciled) {
      await releaseUsageReservation(identity, reservationId, response.locals.requestId);
      if (customerUsageOperationId) await releaseCustomerUsage(customerUsageOperationId, response.locals.requestId);
    }
    logger.warn("Streaming chat request failed", {
      requestId: response.locals.requestId,
      error: error instanceof Error ? error.message : String(error)
    });
    if (!controller.signal.aborted && !response.writableEnded && !response.destroyed) {
      response.write(`event: error\ndata: ${JSON.stringify({
        // SSE headers are already committed, so this path cannot use the
        // global error boundary. Preserve intentional client errors while
        // keeping database/provider internals out of the response stream.
        message: error instanceof HttpError ? error.message : "The response could not be completed. Please try again."
      })}\n\n`);
      response.end();
    }
  }
}

export async function listConversations(request: Request, response: Response): Promise<void> {
  const query = typeof request.query.query === "string" ? request.query.query.trim() : undefined;
  if (query && query.length > 120) {
    throw new HttpError("Conversation search must be 120 characters or fewer.", 400);
  }
  const page = await conversationStore.listPage(
    requestIdentity(request),
    boundedPageLimit(request.query.limit),
    typeof request.query.cursor === "string" ? request.query.cursor : undefined,
    query || undefined
  );
  response.status(200).json(page);
}

export async function getConversationTurns(request: Request, response: Response): Promise<void> {
  const page = await conversationStore.getTurnsPage(
    String(request.params.conversationId ?? ""),
    requestIdentity(request),
    boundedPageLimit(request.query.limit),
    typeof request.query.cursor === "string" ? request.query.cursor : undefined
  );
  if (!page) throw new HttpError("Conversation not found", 404);
  response.status(200).json(page);
}

function boundedPageLimit(raw: unknown): number {
  const value = typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw) : 50;
  if (!Number.isInteger(value) || value < 1 || value > 100) {
    throw new HttpError("Page limit must be an integer from 1 to 100.", 400);
  }
  return value;
}

export async function getConversation(request: Request, response: Response): Promise<void> {
  const conversationId = String(request.params.conversationId ?? "");
  const conversation = await conversationStore.get(conversationId, requestIdentity(request));
  if (!conversation) {
    throw new HttpError("Conversation not found", 404);
  }
  response.status(200).json({ conversation });
}

export async function deleteConversation(request: Request, response: Response): Promise<void> {
  const conversationId = String(request.params.conversationId ?? "");
  const deleted = await conversationStore.delete(conversationId, requestIdentity(request));
  if (!deleted) {
    throw new HttpError("Conversation not found", 404);
  }
  response.status(204).send();
}

export async function clearConversationMemory(request: Request, response: Response): Promise<void> {
  const conversationId = String(request.params.conversationId ?? "");
  const cleared = await conversationStore.clearMemory(conversationId, requestIdentity(request));
  if (!cleared) throw new HttpError("Conversation not found", 404);
  response.status(204).end();
}

export async function patchConversation(request: Request, response: Response): Promise<void> {
  const conversationId = String(request.params.conversationId ?? "");
  const payload = patchConversationSchema.parse(request.body);
  let conversation = payload.title !== undefined
    ? await conversationStore.rename(conversationId, payload.title, requestIdentity(request))
    : await conversationStore.get(conversationId, requestIdentity(request));
  if (conversation && payload.pinned !== undefined) {
    conversation = await conversationStore.setPinned(conversationId, payload.pinned, requestIdentity(request));
  }
  if (!conversation) {
    throw new HttpError("Conversation not found", 404);
  }
  response.status(200).json({ conversation });
}

function requestIdentity(request: Request): string {
  return requestOwnerId(request);
}

async function selectToolsForRequest(payload: ChatRequest, identity: string): Promise<ChatRequest> {
  const selected = await selectTools(payload);
  if (selected.toolOptions?.imageGeneration || !selected.conversationId) return selected;
  const conversation = await conversationStore.get(selected.conversationId, identity);
  if (!conversation || !shouldPlanHistoricalVisualTransformation(
    conversation,
    selected.message,
    selected.attachments?.filter((attachment) => attachment.kind === "image").length ?? 0
  )) {
    return selected;
  }

  return {
    ...selected,
    toolOptions: {
      webSearch: selected.toolOptions?.webSearch ?? false,
      fileSearch: selected.toolOptions?.fileSearch ?? false,
      codeInterpreter: selected.toolOptions?.codeInterpreter ?? false,
      imageGeneration: true,
      videoAnalysis: selected.toolOptions?.videoAnalysis ?? false,
      ...(selected.toolOptions?.videoAnalysisMode ? { videoAnalysisMode: selected.toolOptions.videoAnalysisMode } : {}),
      ...(selected.toolOptions?.imageQuality ? { imageQuality: selected.toolOptions.imageQuality } : {}),
      appFunctions: selected.toolOptions?.appFunctions ?? true,
      background: selected.toolOptions?.background ?? false,
      vectorStoreIds: selected.toolOptions?.vectorStoreIds ?? []
    }
  };
}

async function applyModelProviderPreference(payload: ChatRequest, identity: string): Promise<ChatRequest> {
  const storedProvider = await modelProviderForUser(identity);
  return {
    ...payload,
    provider: storedProvider ?? payload.provider
  };
}

async function applyPersonaInfluencePreference(payload: ChatRequest, identity: string): Promise<ChatRequest> {
  return {
    ...payload,
    personaInfluenceLevel: await personaInfluenceLevelForUser(identity)
  };
}

// Neutral-style personas never produce audio. Normalize before usage
// reservation so no audio seconds are reserved or billed; ChatService enforces
// the same for every other entry point. The client's audio toggle itself is
// left untouched so audio resumes when the user switches back to a persona.
function withoutNeutralPersonaAudio(payload: ChatRequest, persona: PersonaDefinition): ChatRequest {
  return persona.neutralStyle && payload.audio ? { ...payload, audio: false } : payload;
}

// Free (bronze) accounts are ChatGPT-only: clamp any stored or requested
// non-OpenAI provider so a stale preference can't route around the plan.
function enforcePlanModelProvider(payload: ChatRequest, plan: PlanDefinition): ChatRequest {
  return planAllowsModelProvider(plan, payload.provider) ? payload : { ...payload, provider: "openai" };
}

// FLUX.2 Pro is Gold-only: clamp any stored image provider so a stale
// preference (e.g. after a downgrade) can't route around the plan.
function enforcePlanImageProvider(imageProvider: ImageProviderId | undefined, plan: PlanDefinition): ImageProviderId | undefined {
  if (imageProvider === undefined || planAllowsImageProvider(plan, imageProvider)) return imageProvider;
  return "openai";
}

async function releaseUsageReservation(identity: string, reservationId: string, requestId?: string): Promise<void> {
  await usageControlService.recordUsage(identity, undefined, undefined, reservationId).catch((error) => {
    // Reconciliation is cleanup for a request that already failed. Keep the
    // original error actionable and let stale-reservation cleanup retry later.
    logger.warn("Could not release usage reservation after chat failure", {
      requestId,
      error: error instanceof Error ? error.message : String(error)
    });
  });
}

async function reserveCustomerUsage(identity: string, payload: ChatRequest, idempotencyKey: string, imageProvider?: ImageProviderId): Promise<string> {
  const persona = getPersonaById(payload.personaId);
  if (!persona) throw new HttpError(`Unknown persona: ${payload.personaId}`, 404);
  const fluxPath = imageProvider === "flux" && shouldUseFluxImageApi({
    imageProvider,
    toolOptions: payload.toolOptions,
    attachments: payload.attachments,
    userMessage: payload.message
  });
  const conciseAudioResponse = payload.conciseAudioResponse ?? true;
  const reservedAudioSeconds = payload.audio
    ? audioUsageReservationSeconds(conciseAudioResponse, payload.toolOptions?.codeInterpreter)
    : 0;
  const reservedAudioCharacters = payload.audio
    ? audioUsageReservationCharacters(conciseAudioResponse, payload.toolOptions?.codeInterpreter)
    : 0;
  // A JavaScript character can occupy up to four UTF-8 bytes. Reserving the
  // maximum prevents multibyte scripts or emoji from bypassing the total-cost
  // quota; settlement replaces this with the exact provider payload size.
  const reservedAudioBilling = estimateAudioProviderCost(configuredAudioBillingInput(
    persona,
    reservedAudioCharacters,
    reservedAudioSeconds,
    reservedAudioCharacters * 4
  ));
  const providerCost = estimateProviderCost({
    provider: payload.provider,
    // Reserve against the provider the execution gate will actually select:
    // the FLUX branch only serves image-only requests, so a flux preference
    // with mixed attachments/tools still executes (and prices) as OpenAI.
    ...(fluxPath ? {
      imageProvider: "flux" as const,
      // Follow-up edits resolve prior images after reservation; treat a
      // detected visual-transform follow-up as an edit for pricing.
      imageEdit: Boolean(payload.attachments?.some((attachment) => attachment.kind === "image"))
        || shouldUseConversationMediaContext(payload.message)
        || payload.mediaReferenceHint === "transform"
    } : {}),
    reportedModelCostUsd: (
      env.OPENAI_MAX_CONTEXT_TOKENS * (payload.provider === "gemini"
        ? env.GEMINI_INPUT_COST_PER_MILLION
        : env.OPENAI_INPUT_COST_PER_MILLION)
      + maxOutputTokensForRequest(payload.audio, payload.conciseAudioResponse, payload.toolOptions?.codeInterpreter) * (payload.provider === "gemini"
        ? env.GEMINI_OUTPUT_COST_PER_MILLION
        : env.OPENAI_OUTPUT_COST_PER_MILLION)
    ) / 1_000_000,
    generatedImageCount: payload.toolOptions?.imageGeneration ? 1 : 0,
    imageQuality: payload.toolOptions?.imageQuality ?? env.OPENAI_IMAGE_QUALITY,
    imageSize: env.OPENAI_IMAGE_SIZE,
    // FLUX edit pricing already includes input megapixels — only OpenAI image
    // requests pay the per-image input meter.
    imageInputCount: fluxPath ? 0 : payload.attachments?.filter((attachment) => attachment.kind === "image").length ?? 0,
    imageInputCostUsd: env.CUSTOMER_USAGE_IMAGE_INPUT_COST_USD,
    audioCost: reservedAudioBilling.estimatedCostUsd,
    styleTransferCalls: (payload.provider === "claude" || payload.provider === "local") && env.STYLE_TRANSFER_PROVIDER !== "stub" ? 1 : 0,
    styleTransferCostPerCallUsd: env.CUSTOMER_USAGE_STYLE_TRANSFER_COST_PER_CALL_USD,
    webSearchCalls: payload.toolOptions?.webSearch ? 1 : 0,
    fileSearchCalls: payload.toolOptions?.fileSearch ? 1 : 0,
    codeInterpreterSessions: payload.toolOptions?.codeInterpreter ? 1 : 0
  });
  warnOnUnpricedCustomerUsage(providerCost.unpricedComponents, {
    phase: "reservation",
    provider: payload.provider,
    requestId: idempotencyKey
  });
  return customerUsageService.reserve(identity, {
    total_usage_microusd: Math.max(1, Math.ceil(providerCost.estimatedCostUsd * 1_000_000)),
    // Detailed operational meters remain useful for provider reconciliation
    // even though total usage is the cross-capability customer quota.
    text_input_tokens: 1,
    text_output_tokens: 1,
    ...(payload.toolOptions?.imageGeneration ? {
      // Keep output count as an internal operational meter for concurrency and
      // audit trails. The customer-facing allowance is the quality-aware credit
      // meter below.
      image_outputs: 1,
      credits: reservedImageGenerationCredits(payload.toolOptions?.imageQuality)
    } : {}),
    ...(payload.audio ? { audio_seconds: reservedAudioSeconds } : {})
  }, {
    idempotencyKey,
    provider: payload.provider,
    metadata: {
      priceCardVersion: PROVIDER_PRICE_CARD_VERSION,
      audioBilling: reservedAudioBilling.metadata
    }
  });
}

async function settleCustomerUsage(
  operationId: string | undefined,
  payload: ChatRequest,
  result: ChatResponse
): Promise<void> {
  if (!operationId) return;
  const audioCharacters = result.diagnostics.tts?.status === "generated"
    ? result.diagnostics.tts.textCharacters ?? 0
    : 0;
  const audioUtf8Bytes = result.diagnostics.tts?.status === "generated"
    ? result.diagnostics.tts.textUtf8Bytes ?? audioCharacters
    : 0;
  const audioSeconds = estimatedAudioSecondsForCharacters(audioCharacters);
  const persona = getPersonaById(payload.personaId);
  if (!persona) throw new HttpError(`Unknown persona: ${payload.personaId}`, 404);
  const audioBilling = estimateAudioProviderCost(resolvedAudioBillingInput(persona, {
    ...(result.diagnostics.tts?.provider ? { provider: result.diagnostics.tts.provider } : {}),
    ...(result.diagnostics.tts?.providerModel ? { model: result.diagnostics.tts.providerModel } : {}),
    textCharacters: audioCharacters,
    textUtf8Bytes: audioUtf8Bytes,
    estimatedAudioSeconds: audioSeconds
  }));
  const generatedImageCount = billableGeneratedImageCount(result);
  // FLUX blocks carry their provenance in block metadata; settle at FLUX
  // prices (edit when reference images were used) instead of OpenAI's tiers.
  const fluxImageGenerated = result.outputs.some((output) => output.type === "image" && output.metadata?.generationSource === "flux_image_generation");
  const fluxImageEdit = result.outputs.some((output) => output.type === "image" && output.metadata?.route === "flux_api_edit");
  const providerCost = estimateProviderCost({
    provider: result.provider,
    ...(result.usage?.estimatedCostUsd !== undefined
      ? { reportedModelCostUsd: result.usage.estimatedCostUsd }
      : {}),
    // ChatService may enable image generation after resolving a historical
    // visual follow-up even when the incoming tool selection was false.
    // Settle from the actual output provenance so those requests cannot bypass
    // image credits, while Code Interpreter chart images remain excluded.
    generatedImageCount,
    ...(fluxImageGenerated ? { imageProvider: "flux", imageEdit: fluxImageEdit } : {}),
    imageQuality: payload.toolOptions?.imageQuality ?? env.OPENAI_IMAGE_QUALITY,
    imageSize: env.OPENAI_IMAGE_SIZE,
    imageInputCount: fluxImageGenerated ? 0 : payload.attachments?.filter((attachment) => attachment.kind === "image").length ?? 0,
    imageInputCostUsd: env.CUSTOMER_USAGE_IMAGE_INPUT_COST_USD,
    audioCost: audioBilling.estimatedCostUsd,
    styleTransferCalls: (payload.provider === "claude" || payload.provider === "local")
      && env.STYLE_TRANSFER_PROVIDER !== "stub"
      && result.outputs.some((output) => output.type === "text" && output.text.trim())
      ? 1
      : 0,
    styleTransferCostPerCallUsd: env.CUSTOMER_USAGE_STYLE_TRANSFER_COST_PER_CALL_USD,
    webSearchCalls: payload.toolOptions?.webSearch ? 1 : 0,
    fileSearchCalls: payload.toolOptions?.fileSearch ? 1 : 0,
    codeInterpreterSessions: payload.toolOptions?.codeInterpreter ? 1 : 0
  });
  warnOnUnpricedCustomerUsage(providerCost.unpricedComponents, {
    phase: "settlement",
    provider: result.provider,
    conversationId: result.conversationId,
    operationId
  });
  await customerUsageService.settleWithRetry(operationId, {
    total_usage_microusd: Math.max(1, Math.ceil(providerCost.estimatedCostUsd * 1_000_000)),
    text_input_tokens: result.usage?.inputTokens ?? 0,
    text_output_tokens: result.usage?.outputTokens ?? 0,
    image_outputs: generatedImageCount,
    credits: actualImageGenerationCredits(result, payload.toolOptions?.imageQuality),
    audio_seconds: audioSeconds,
    web_search_calls: payload.toolOptions?.webSearch ? 1 : 0,
    file_analysis_operations: payload.toolOptions?.fileSearch ? 1 : 0
  }, {
    provider: result.provider,
    ...(result.diagnostics.providerModel ? { model: result.diagnostics.providerModel } : {}),
    conversationId: result.conversationId,
    ...(providerCost.estimatedCostUsd > 0 ? { estimatedCostUsd: providerCost.estimatedCostUsd } : {}),
    metadata: {
      priceCardVersion: PROVIDER_PRICE_CARD_VERSION,
      audioBilling: audioBilling.metadata
    }
  });
}

function warnOnUnpricedCustomerUsage(
  components: string[],
  context: {
    phase: "reservation" | "settlement";
    provider: string;
    requestId?: string;
    conversationId?: string;
    operationId?: string;
  }
): void {
  if (components.length === 0) return;
  logger.warn("Customer usage estimate has unpriced provider components", {
    ...context,
    components
  });
}

async function releaseCustomerUsage(operationId: string, requestId?: string): Promise<void> {
  await customerUsageService.release(operationId).catch((error) => {
    logger.warn("Could not release customer usage reservation after chat failure", {
      requestId,
      error: error instanceof Error ? error.message : String(error)
    });
  });
}

function shouldRunInBackground(payload: ChatRequest): boolean {
  if (payload.provider !== "openai" && payload.provider !== "gemini") return false;
  return payload.toolOptions?.background === true ||
    payload.toolOptions?.imageGeneration === true ||
    payload.toolOptions?.codeInterpreter === true;
}

function createPendingChatResponse(payload: ChatRequest, jobId: string): ChatResponse {
  const persona = getPersonaById(payload.personaId);
  if (!persona) {
    throw new HttpError(`Unknown persona: ${payload.personaId}`, 404);
  }

  const history = [
    ...(payload.history ?? []),
    {
      role: "user" as const,
      content: payload.message
    }
  ];

  return {
    persona: {
      id: persona.id,
      name: persona.name,
      shortName: persona.shortName,
      legalName: persona.legalName,
      age: persona.age,
      height: persona.height,
      weight: persona.weight,
      tagline: persona.tagline,
      description: persona.description,
      avatarColor: persona.avatarColor,
      avatarUrl: persona.avatarUrl,
      theme: persona.theme,
      documentTitle: persona.documentTitle,
      promptPlaceholder: persona.promptPlaceholder,
      suggestedPrompts: persona.suggestedPrompts,
      supportedProviders: persona.supportedProviders,
      minimumPlan: persona.minimumPlan,
      available: persona.available
    },
    provider: payload.provider,
    conversationId: payload.conversationId ?? `conv_${randomUUID()}`,
    history,
    outputs: [
      {
        type: "status",
        status: "in_progress",
        message: "Still working on that request."
      }
    ],
    generatedAt: new Date().toISOString(),
    diagnostics: {
      requestedAudio: payload.audio,
      toolsAvailable: persona.defaultTools,
      messageCount: history.length,
      ...(payload.testMode ? { testMode: payload.testMode } : {}),
      backgroundJob: {
        id: jobId,
        status: "running",
        pollUrl: `/api/chat/jobs/${jobId}`
      }
    }
  };
}

function requestAbortController(request: Request, response: Response): AbortController {
  const controller = new AbortController();
  if (typeof request.once === "function") {
    request.once("aborted", () => controller.abort(new Error("Client cancelled request.")));
  }
  // By the time a controller runs, express.json() has fully consumed the
  // request body, so a client disconnect mid-generation only surfaces as a
  // close on the response (a request close is guarded by request.complete and
  // never fires). Abort unless the response finished normally.
  if (typeof response.once === "function") {
    response.once("close", () => {
      if (!response.writableEnded) controller.abort(new Error("Client disconnected."));
    });
  }
  return controller;
}

async function resolveOwnedChatAssets(request: Request, signal?: AbortSignal) {
  const payload = chatRequestSchema.parse(request.body);
  const assetIds = payload.attachments?.map((attachment) => attachment.id) ?? [];
  const vectorStoreIds = payload.toolOptions?.vectorStoreIds ?? [];
  const ownerId = requestOwnerId(request);
  await uploadService.validateVectorStores(ownerId, vectorStoreIds);
  const resolvedAssets = assetIds.length > 0
    ? await uploadService.resolveAssets(ownerId, assetIds, payload.provider)
    : [];
  const importedAssets = await remoteAttachmentImportService.importFromMessage(
    ownerId,
    payload.message,
    resolvedAssets,
    signal
  );
  if (resolvedAssets.length === 0 && importedAssets.length === 0) return payload;
  const combinedIds = [...new Set([...resolvedAssets, ...importedAssets].map((asset) => asset.id))];
  return {
    ...payload,
    attachments: await uploadService.resolveAssets(ownerId, combinedIds, payload.provider)
  };
}

export async function postStyleTransferEvalCapture(request: Request, response: Response): Promise<void> {
  const payload = evalCaptureRequestSchema.parse(request.body);
  const result = evalCaptureService.save(payload);
  response.status(201).json(result);
}

export async function getStyleTransferReview(request: Request, response: Response): Promise<void> {
  const query = reviewQuerySchema.parse(request.query);
  const result = evalCaptureService.getReviewData(query.personaId);
  response.status(200).json(result);
}

export async function patchStyleTransferReviewRecord(request: Request, response: Response): Promise<void> {
  const payload = reviewRecordUpdateSchema.parse(request.body);
  const result = evalCaptureService.updateReviewRecord(payload);
  response.status(200).json(result);
}

export async function postStyleTransferReviewRecord(request: Request, response: Response): Promise<void> {
  const payload = reviewRecordCreateSchema.parse(request.body);
  const result = evalCaptureService.createReviewRecord(payload);
  response.status(201).json(result);
}

export async function deleteStyleTransferReviewRecord(request: Request, response: Response): Promise<void> {
  const payload = reviewRecordDeleteSchema.parse(request.body);
  const result = evalCaptureService.deleteReviewRecord(payload);
  response.status(200).json(result);
}

export async function postPromoteRejectedStylePair(request: Request, response: Response): Promise<void> {
  const payload = promoteRejectedPairSchema.parse(request.body);
  const result = evalCaptureService.promoteRejectedToSyntheticPair(payload);
  response.status(201).json(result);
}
