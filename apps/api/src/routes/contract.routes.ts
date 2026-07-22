import { apiContract, type UploadPresignRequest } from "@persona/shared";
import { initServer } from "@ts-rest/express";
import type { Request, Response } from "express";
import { deleteAccount, getOAuthProviders, restoreAccount } from "../controllers/account.controller.js";
import {
  cancelChatJob,
  deleteConversation,
  getConversation,
  getConversationTurns,
  getChatJob,
  listConversations,
  patchConversation,
  postChat
} from "../controllers/chat.controller.js";
import {
  deleteDataTransferJob,
  getDataTransferJob,
  getAccountDataExport,
  postDataExportJob,
  postDataImportComplete,
  postDataImportPresign,
  postConversationDataExport,
  postDataImport
} from "../controllers/dataTransfer.controller.js";
import {
  deleteUpload,
  deleteVectorStore,
  getUploads,
  postVectorStore
} from "../controllers/upload.controller.js";
import { getPersonaById, listPersonas } from "../personas/index.js";
import { postUnsafeOutputReport } from "../controllers/safety.controller.js";
import { uploadService } from "../services/uploadService.js";
import { requestOwnerId } from "../utils/requestIdentity.js";

const server = initServer();

type CapturedResponse = { status: number; body: unknown };

async function captureController(
  controller: (request: Request, response: Response) => void | Promise<void>,
  request: Request
): Promise<CapturedResponse> {
  let status = 200;
  let body: unknown;
  const response = {
    status(code: number) {
      status = code;
      return this;
    },
    json(value: unknown) {
      body = value;
      return this;
    },
    send(value?: unknown) {
      if (typeof value === "string") {
        try { body = JSON.parse(value); } catch { body = value; }
      } else {
        body = value;
      }
      return this;
    },
    end() {
      body = undefined;
      return this;
    },
    setHeader() { return this; },
    type() { return this; },
    locals: {}
  } as unknown as Response;
  await controller(request, response);
  return { status, body };
}

function captured(controller: (request: Request, response: Response) => void | Promise<void>): never {
  return (async (input: { req: Request }) => captureController(controller, input.req)) as never;
}

const presignUpload = (async (input: unknown) => {
  const { body, req } = input as { body: UploadPresignRequest; req: Request };
  return {
    status: 201 as const,
    body: await uploadService.createPresignedUpload(requestOwnerId(req), body)
  };
}) as never;

const completeUpload = (async (input: unknown) => {
  const { params, req } = input as { params: { id: string }; req: Request };
  return {
    status: 200 as const,
    body: { asset: await uploadService.completePresignedUpload(requestOwnerId(req), params.id) }
  };
}) as never;

export const apiContractRouter = server.router(apiContract, {
  personas: {
    list: async () => ({ status: 200, body: { personas: listPersonas() } }),
    get: async ({ params }) => {
      const persona = getPersonaById(params.id);
      return persona
        ? { status: 200 as const, body: { persona } }
        : { status: 404 as const, body: { error: "Persona not found" } };
    }
  },
  chat: {
    create: captured(postChat),
    getJob: captured(getChatJob),
    cancelJob: captured(cancelChatJob)
  },
  conversations: {
    list: captured(listConversations),
    turns: captured(getConversationTurns),
    get: captured(getConversation),
    update: captured(patchConversation),
    remove: captured(deleteConversation)
  },
  safety: {
    reportOutput: captured(postUnsafeOutputReport)
  },
  account: {
    restore: captured(restoreAccount),
    remove: captured(deleteAccount),
    oauthProviders: captured(getOAuthProviders)
  },
  uploads: {
    list: captured(getUploads),
    presign: presignUpload,
    complete: completeUpload,
    remove: captured(deleteUpload),
    createVectorStore: captured(postVectorStore),
    removeVectorStore: captured(deleteVectorStore)
  },
  data: {
    exportAccount: captured(getAccountDataExport),
    exportConversations: captured(postConversationDataExport),
    import: captured(postDataImport),
    startExportJob: captured(postDataExportJob),
    presignImportJob: captured(postDataImportPresign),
    completeImportJob: captured(postDataImportComplete),
    getJob: captured(getDataTransferJob),
    cancelJob: captured(deleteDataTransferJob)
  }
});
