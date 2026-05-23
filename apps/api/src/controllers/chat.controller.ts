import type { Request, Response } from "express";
import { z } from "zod";
import { chatRequestSchema } from "@persona/shared";
import { ChatService } from "../services/chatService.js";
import { EvalCaptureService } from "../services/evalCaptureService.js";

const chatService = new ChatService();
const evalCaptureService = new EvalCaptureService();
const evalCaptureRequestSchema = z.object({
  conversationId: z.string().min(1),
  idealStyledText: z.string().min(1),
  notes: z.string().optional(),
  tags: z.array(z.string()).default([])
});
const reviewRecordUpdateSchema = z.object({
  kind: z.enum(["evals", "golden"]),
  id: z.string().min(1),
  updates: z.record(z.unknown())
});
const reviewRecordCreateSchema = z.object({
  kind: z.enum(["evals", "golden"]),
  record: z.record(z.unknown())
});
const reviewRecordDeleteSchema = z.object({
  kind: z.enum(["evals", "golden"]),
  id: z.string().min(1)
});

export async function postChat(request: Request, response: Response): Promise<void> {
  const payload = chatRequestSchema.parse(request.body);
  const result = await chatService.handleChat(payload);
  response.status(200).json(result);
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
