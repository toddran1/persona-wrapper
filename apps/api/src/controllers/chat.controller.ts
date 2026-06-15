import type { Request, Response } from "express";
import { z } from "zod";
import { chatRequestSchema } from "@persona/shared";
import { ChatService } from "../services/chatService.js";
import { EvalCaptureService } from "../services/evalCaptureService.js";
import { uploadService } from "../services/uploadService.js";
import { HttpError } from "../utils/httpError.js";
import { selectTools } from "../services/toolSelectionService.js";
import { usageControlService } from "../services/usageControlService.js";

const chatService = new ChatService();
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

export async function postChat(request: Request, response: Response): Promise<void> {
  const identity = requestIdentity(request);
  usageControlService.check(identity);
  const payload = selectTools(resolveOwnedChatAssets(request));
  const controller = requestAbortController(request);
  const result = await chatService.handleChat(payload, undefined, controller.signal);
  usageControlService.recordUsage(identity, result.usage?.totalTokens, result.usage?.estimatedCostUsd);
  response.status(200).json(result);
}

export async function postChatStream(request: Request, response: Response): Promise<void> {
  const identity = requestIdentity(request);
  usageControlService.check(identity);
  const payload = selectTools(resolveOwnedChatAssets(request));
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
    }, controller.signal);
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

function requestIdentity(request: Request): string {
  const ownerId = typeof request.header === "function" ? request.header("x-owner-id") : undefined;
  return ownerId?.slice(0, 200) || request.ip || "anonymous";
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

function resolveOwnedChatAssets(request: Request) {
  const payload = chatRequestSchema.parse(request.body);
  const assetIds = payload.attachments?.map((attachment) => attachment.id) ?? [];
  const vectorStoreIds = payload.toolOptions?.vectorStoreIds ?? [];
  if (assetIds.length === 0 && vectorStoreIds.length === 0) return payload;

  const ownerId = request.header("x-owner-id");
  if (!ownerId) throw new HttpError("A valid x-owner-id header is required for files.", 400);
  uploadService.validateVectorStores(ownerId, vectorStoreIds);
  return {
    ...payload,
    attachments: uploadService.resolveAssets(ownerId, assetIds)
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
