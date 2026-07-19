import type { Request, Response } from "express";
import { pipeline } from "node:stream/promises";
import { dataExportJobRequestSchema, dataImportPresignRequestSchema, dataImportRequestSchema, selectedConversationExportSchema } from "@persona/shared";
import { ConversationStore } from "../services/conversationStore.js";
import { DataTransferService } from "../services/dataTransferService.js";
import { dataTransferJobService } from "../services/dataTransferJobService.js";
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

export async function postDataExportJob(request: Request, response: Response): Promise<void> {
  const payload = dataExportJobRequestSchema.parse(request.body);
  response.status(202).json(await dataTransferJobService.startExport(authenticatedUserId(request), payload));
}

export async function postDataImportPresign(request: Request, response: Response): Promise<void> {
  const payload = dataImportPresignRequestSchema.parse(request.body);
  response.status(201).json(await dataTransferJobService.presignImport(authenticatedUserId(request), payload));
}

export async function postDataImportUpload(request: Request, response: Response): Promise<void> {
  if (!request.file) throw new HttpError("Select a ZIP or JSON archive to import.", 400);
  response.status(202).json(await dataTransferJobService.startImportBuffer(authenticatedUserId(request), {
    fileName: request.file.originalname,
    mimeType: request.file.mimetype,
    buffer: request.file.buffer
  }));
}

export async function postDataImportComplete(request: Request, response: Response): Promise<void> {
  response.status(202).json(await dataTransferJobService.completeImport(authenticatedUserId(request), String(request.params.jobId)));
}

export async function getDataTransferJob(request: Request, response: Response): Promise<void> {
  const job = await dataTransferJobService.get(String(request.params.jobId), authenticatedUserId(request));
  if (!job) throw new HttpError("Data transfer job not found.", 404);
  response.status(200).json(job);
}

export async function deleteDataTransferJob(request: Request, response: Response): Promise<void> {
  const job = await dataTransferJobService.cancel(String(request.params.jobId), authenticatedUserId(request));
  if (!job) throw new HttpError("Data transfer job not found.", 404);
  response.status(200).json(job);
}

export async function downloadDataExport(request: Request, response: Response): Promise<void> {
  const archive = await dataTransferJobService.download(String(request.params.jobId), authenticatedUserId(request));
  response.setHeader("Content-Disposition", contentDisposition("attachment", archive.fileName));
  response.setHeader("Cache-Control", "private, no-store");
  response.setHeader("Pragma", "no-cache");
  if (archive.sizeBytes !== undefined) response.setHeader("Content-Length", String(archive.sizeBytes));
  response.type(archive.mimeType);
  await pipeline(archive.stream, response);
}
