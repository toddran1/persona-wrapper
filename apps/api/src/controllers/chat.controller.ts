import type { Request, Response } from "express";
import { chatRequestSchema } from "@persona/shared";
import { ChatService } from "../services/chatService.js";

const chatService = new ChatService();

export async function postChat(request: Request, response: Response): Promise<void> {
  const payload = chatRequestSchema.parse(request.body);
  const result = await chatService.handleChat(payload);
  response.status(200).json(result);
}

