import { randomUUID } from "node:crypto";
import type { UnsafeOutputReportRequest } from "@persona/shared";
import { and, eq } from "drizzle-orm";
import type { Request, Response } from "express";
import { getDatabase } from "../db/client.js";
import { conversations, unsafeOutputReports } from "../db/schema.js";
import { HttpError } from "../utils/httpError.js";
import { requestAuthenticatedOwnerId } from "../utils/requestIdentity.js";

export async function postUnsafeOutputReport(request: Request, response: Response): Promise<void> {
  const userId = requestAuthenticatedOwnerId(request);
  const body = request.body as UnsafeOutputReportRequest;
  const database = getDatabase();
  if (!database) throw new HttpError("Reporting is temporarily unavailable.", 503);

  const [conversation] = await database
    .select({ id: conversations.id })
    .from(conversations)
    .where(and(eq(conversations.id, body.conversationId), eq(conversations.userId, userId)))
    .limit(1);
  if (!conversation) throw new HttpError("Conversation not found.", 404);

  const id = `report_${randomUUID()}`;
  const createdAt = new Date();
  await database.insert(unsafeOutputReports).values({
    id,
    userId,
    conversationId: conversation.id,
    category: body.category,
    outputExcerpt: body.outputExcerpt,
    details: body.details?.trim() || null,
    metadata: {
      clientType: request.header("x-client-type")?.slice(0, 40) || "unknown",
      userAgent: request.header("user-agent")?.slice(0, 500) || undefined
    },
    createdAt
  });

  response.status(201).json({ report: { id, status: "received", createdAt: createdAt.toISOString() } });
}
