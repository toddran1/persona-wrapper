import {
  apiContract,
  personaSummarySchema,
  type PersonaSummary,
  type UploadPresignRequest
} from "@persona/shared";
import { initServer } from "@ts-rest/express";
import type { Request, Response } from "express";
import { acceptPolicies, clearAccountMemory, deleteAccount, getAccountUsage, getCurrentPolicies, getMemorySettings, getOAuthProviders, restoreAccount, updateMemorySettings, updateProfile } from "../controllers/account.controller.js";
import { grantPlanOverride, listPlanOverrides, listReviewSubmissions, revokePlanOverride } from "../controllers/admin.controller.js";
import { getAccountBillingCatalog, postAccountBillingManagement } from "../controllers/billing.controller.js";
import {
  cancelChatJob,
  clearConversationMemory,
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
import { postResponseFeedback, postUnsafeOutputReport } from "../controllers/safety.controller.js";
import { uploadService } from "../services/uploadService.js";
import { requestOwnerId } from "../utils/requestIdentity.js";
import { customerUsageService } from "../services/customerUsageService.js";
import { getPlanDefinition, planIncludesPersona, type PlanDefinition } from "../services/planCatalog.js";
import { getMobileUpdatePolicy } from "../services/mobileUpdatePolicyService.js";

const server = initServer();

/**
 * The persona catalog is intentionally visible before sign-in so visitors can
 * enter the app and see the personas they may use. Entitlements still control
 * which personas are selectable and every protected API operation verifies
 * access again server-side.
 */
export function personaSummariesForAccess(
  plan: PlanDefinition = getPlanDefinition("bronze"),
  isAdmin = false
): PersonaSummary[] {
  return listPersonas().map((persona) => personaSummarySchema.parse({
    ...persona,
    available: isAdmin || planIncludesPersona(plan, persona.id)
  }));
}

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
  mobile: {
    updatePolicy: async ({ query }) => ({
      status: 200,
      body: getMobileUpdatePolicy(query.platform, query.build)
    })
  },
  admin: {
    planOverrides: captured(listPlanOverrides),
    grantPlanOverride: captured(grantPlanOverride),
    revokePlanOverride: captured(revokePlanOverride),
    reviewSubmissions: captured(listReviewSubmissions)
  },
  personas: {
    list: async ({ req }) => {
      const ownerId = req.auth?.userId;
      const access = ownerId ? await customerUsageService.getAccess(ownerId) : undefined;
      return {
        status: 200,
        body: {
          personas: personaSummariesForAccess(access?.plan, access?.isAdmin)
        }
      };
    },
    get: async ({ params, req }) => {
      const persona = getPersonaById(params.id);
      if (persona) await customerUsageService.assertPersonaAccess(requestOwnerId(req), persona.id);
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
    remove: captured(deleteConversation),
    clearMemory: captured(clearConversationMemory)
  },
  safety: {
    reportOutput: captured(postUnsafeOutputReport),
    submitResponseFeedback: captured(postResponseFeedback)
  },
  account: {
    billingCatalog: captured(getAccountBillingCatalog),
    billingManagement: captured(postAccountBillingManagement),
    usage: captured(getAccountUsage),
    currentPolicies: captured(getCurrentPolicies),
    acceptPolicies: captured(acceptPolicies),
    getMemorySettings: captured(getMemorySettings),
    updateMemorySettings: captured(updateMemorySettings),
    clearMemory: captured(clearAccountMemory),
    updateProfile: captured(updateProfile),
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
