import type { Request, Response } from "express";
import { dataImportRequestSchema, selectedConversationExportSchema } from "@persona/shared";
import { ConversationStore } from "../services/conversationStore.js";
import { DataTransferService } from "../services/dataTransferService.js";
import { HttpError } from "../utils/httpError.js";
import { contentDisposition } from "../utils/httpHeaders.js";
import { measureOperation } from "../utils/observability.js";

const dataTransferService = new DataTransferService(new ConversationStore());
function authenticatedUserId(request: Request): string {
  if (!request.auth?.userId) throw new HttpError("Authentication required.", 401);
  return request.auth.userId;
}

function sendArchive(response: Response, archive: unknown, fileName: string): void {
  response.status(200);
  response.setHeader("Content-Disposition", contentDisposition("attachment", fileName));
  response.type("application/json").send(JSON.stringify(archive, null, 2));
}

export async function getAccountDataExport(request: Request, response: Response): Promise<void> {
  const archive = await measureOperation("data_transfer.export", { scope: "account" }, () =>
    dataTransferService.exportAccount(authenticatedUserId(request))
  );
  sendArchive(response, archive, `for-the-baddiez-account-export-${new Date().toISOString().slice(0, 10)}.json`);
}

export async function postConversationDataExport(request: Request, response: Response): Promise<void> {
  const payload = selectedConversationExportSchema.parse(request.body);
  const archive = await measureOperation("data_transfer.export", {
    scope: "conversations",
    conversationCount: payload.conversationIds.length
  }, () => dataTransferService.exportConversations(authenticatedUserId(request), payload.conversationIds));
  sendArchive(response, archive, `for-the-baddiez-conversations-${new Date().toISOString().slice(0, 10)}.json`);
}

export async function postDataImport(request: Request, response: Response): Promise<void> {
  const payload = dataImportRequestSchema.parse(request.body);
  const result = await measureOperation("data_transfer.import", {}, () =>
    dataTransferService.importArchive(authenticatedUserId(request), payload.archive)
  );
  response.status(201).json(result);
}
