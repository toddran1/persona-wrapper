import { randomUUID } from "node:crypto";
import type { Request, Response } from "express";
import { z } from "zod";
import { chatRequestSchema, type ChatRequest, type ChatResponse } from "@persona/shared";
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

const conversationStore = new ConversationStore();
const chatService = new ChatService(conversationStore);
const evalCaptureService = new EvalCaptureService();
const evalCaptureRequestSchema = z.object({
  conversationId: z.string().min(1),
  idealStyledText: z.string().min(1),
  notes: z.string().optional(),
  tags: z.array(z.string()).default([])
});
const reviewRecordUpdateSchema = z.object({
  kind: z.enum(["evals", "golden", "pairs", "rejections"]),
  id: z.string().min(1),
  updates: z.record(z.unknown())
});
const reviewRecordCreateSchema = z.object({
  kind: z.enum(["evals", "golden", "pairs", "rejections"]),
  record: z.record(z.unknown())
});
const reviewRecordDeleteSchema = z.object({
  kind: z.enum(["evals", "golden", "pairs", "rejections"]),
  id: z.string().min(1)
});
const promoteRejectedPairSchema = z.object({
  id: z.string().min(1)
});
const patchConversationSchema = z.object({
  title: z.string().trim().min(1).max(120).optional(),
  pinned: z.boolean().optional()
}).refine((payload) => payload.title !== undefined || payload.pinned !== undefined, {
  message: "At least one conversation field must be provided."
});

export async function postChat(request: Request, response: Response): Promise<void> {
  const identity = requestIdentity(request);
  usageControlService.check(identity);
  const payload = await selectTools(await resolveOwnedChatAssets(request));
  if (shouldRunInBackground(payload)) {
    const conversationId = payload.conversationId ?? `conv_${randomUUID()}`;
    const backgroundPayload: ChatRequest = {
      ...payload,
      conversationId,
      toolOptions: {
        webSearch: payload.toolOptions?.webSearch ?? false,
        fileSearch: payload.toolOptions?.fileSearch ?? false,
        codeInterpreter: payload.toolOptions?.codeInterpreter ?? false,
        imageGeneration: payload.toolOptions?.imageGeneration ?? false,
        appFunctions: payload.toolOptions?.appFunctions ?? true,
        background: true,
        vectorStoreIds: payload.toolOptions?.vectorStoreIds ?? []
      }
    };
    const job = await backgroundChatJobService.start({
      ownerId: identity,
      provider: backgroundPayload.provider,
      conversationId,
      request: backgroundPayload
    }, async (backgroundJob) => {
      const result = await chatService.handleChat(backgroundPayload, undefined, backgroundJob.abortController.signal, {
        onProviderResponse: (event) => {
          void backgroundChatJobService.trackProviderResponse(backgroundJob.id, event.id, event.status);
        }
      }, { ownerId: identity });
      usageControlService.recordUsage(identity, result.usage?.totalTokens, result.usage?.estimatedCostUsd);
      return result;
    });
    response.status(202).json(createPendingChatResponse(backgroundPayload, job.id));
    return;
  }
  const controller = requestAbortController(request);
  const result = await chatService.handleChat(payload, undefined, controller.signal, undefined, { ownerId: identity });
  usageControlService.recordUsage(identity, result.usage?.totalTokens, result.usage?.estimatedCostUsd);
  response.status(200).json(result);
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
  if (job.providerResponseId) {
    await openAIResponseLifecycleService.cancel(job.providerResponseId);
  }

  response.status(200).json(cancelledJob ?? await backgroundChatJobService.get(jobId, identity));
}

export async function postChatStream(request: Request, response: Response): Promise<void> {
  const identity = requestIdentity(request);
  usageControlService.check(identity);
  const payload = await selectTools(await resolveOwnedChatAssets(request));
  response.status(200);
  response.setHeader("Content-Type", "text/event-stream");
  response.setHeader("Cache-Control", "no-cache");
  response.setHeader("Connection", "keep-alive");
  response.flushHeaders();
  const controller = requestAbortController(request);
  try {
    const result = await chatService.handleChat(payload, {
      onTextDelta: (delta) => {
        if (!response.writableEnded) {
          response.write(`event: delta\ndata: ${JSON.stringify({ delta })}\n\n`);
        }
      }
    }, controller.signal, undefined, { ownerId: identity });
    usageControlService.recordUsage(identity, result.usage?.totalTokens, result.usage?.estimatedCostUsd);
    response.write(`event: response\ndata: ${JSON.stringify(result)}\n\n`);
    response.end();
  } catch (error) {
    if (!controller.signal.aborted && !response.writableEnded && !response.destroyed) {
      response.write(`event: error\ndata: ${JSON.stringify({
        message: error instanceof Error ? error.message : "Streaming request failed."
      })}\n\n`);
      response.end();
    }
  }
}

export async function listConversations(request: Request, response: Response): Promise<void> {
  const conversations = await conversationStore.list(requestIdentity(request));
  response.status(200).json({ conversations });
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

function shouldRunInBackground(payload: ChatRequest): boolean {
  if (payload.provider !== "openai" && payload.provider !== "openai_persona") return false;
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
      supportedProviders: persona.supportedProviders
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

function requestAbortController(request: Request): AbortController {
  const controller = new AbortController();
  if (typeof request.once === "function") {
    request.once("aborted", () => controller.abort(new Error("Client cancelled request.")));
    request.once("close", () => {
      if (!request.complete) controller.abort(new Error("Client disconnected."));
    });
  }
  return controller;
}

async function resolveOwnedChatAssets(request: Request) {
  const payload = chatRequestSchema.parse(request.body);
  const assetIds = payload.attachments?.map((attachment) => attachment.id) ?? [];
  const vectorStoreIds = payload.toolOptions?.vectorStoreIds ?? [];
  if (assetIds.length === 0 && vectorStoreIds.length === 0) return payload;

  const ownerId = request.header("x-owner-id");
  if (!ownerId) throw new HttpError("A valid x-owner-id header is required for files.", 400);
  await uploadService.validateVectorStores(ownerId, vectorStoreIds);
  return {
    ...payload,
    attachments: await uploadService.resolveAssets(ownerId, assetIds)
  };
}

export async function postStyleTransferEvalCapture(request: Request, response: Response): Promise<void> {
  const payload = evalCaptureRequestSchema.parse(request.body);
  const result = evalCaptureService.save(payload);
  response.status(201).json(result);
}

export async function getStyleTransferReview(_request: Request, response: Response): Promise<void> {
  const result = evalCaptureService.getReviewData();
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
