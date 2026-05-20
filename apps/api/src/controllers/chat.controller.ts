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
