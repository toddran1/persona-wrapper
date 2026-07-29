import type { Request, Response } from "express";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cancelChatJob, postChat, postChatStream } from "../controllers/chat.controller.js";
import { getPersona, getPersonas } from "../controllers/persona.controller.js";
import { acceptPolicies, getCurrentPolicies } from "../controllers/account.controller.js";
import { backgroundChatJobService } from "../services/backgroundChatJobService.js";
import { openAIResponseLifecycleService } from "../services/openAIResponseLifecycleService.js";
import { usageControlService } from "../services/usageControlService.js";
import { requireCurrentPolicyConsent } from "../middleware/authMiddleware.js";

afterEach(() => {
  vi.restoreAllMocks();
});

function createMockResponse() {
  const state: {
    statusCode: number;
    body: unknown;
  } = {
    statusCode: 200,
    body: undefined
  };

  const response = {
    locals: {
      requestId: "controller-test-request"
    },
    status(code: number) {
      state.statusCode = code;
      return response;
    },
    json(payload: unknown) {
      state.body = payload;
      return response;
    }
  };

  return {
    response: response as unknown as Response,
    state
  };
}

describe("controllers", () => {
  it("blocks authenticated API use until current policy consent is recorded", () => {
    const next = vi.fn();
    requireCurrentPolicyConsent({
      path: "/api/chat",
      auth: {
        userId: "user_policy",
        sessionId: "session_policy",
        clientType: "web",
        policyConsentRequired: true
      }
    } as Request, {} as Response, next);
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 428 }));

    next.mockClear();
    requireCurrentPolicyConsent({
      path: "/api/account/policies/accept",
      auth: {
        userId: "user_policy",
        sessionId: "session_policy",
        clientType: "web",
        policyConsentRequired: true
      }
    } as Request, {} as Response, next);
    expect(next).toHaveBeenCalledWith();

    next.mockClear();
    requireCurrentPolicyConsent({
      path: "/api/personas/larae",
      auth: {
        userId: "user_policy",
        sessionId: "session_policy",
        clientType: "web",
        policyConsentRequired: true
      }
    } as Request, {} as Response, next);
    expect(next).toHaveBeenCalledWith();
  });

  it("returns personas from the persona controller", () => {
    const { response, state } = createMockResponse();

    getPersonas({} as Request, response);

    const personas = (state.body as { personas: Array<{ id: string }> }).personas;

    expect(state.statusCode).toBe(200);
    expect(personas[0]).toBeDefined();
    expect(personas[0]?.id).toBe("larae");
  });

  it("returns a single persona by id", () => {
    const { response, state } = createMockResponse();

    getPersona({ params: { id: "larae" } } as unknown as Request, response);

    expect(state.statusCode).toBe(200);
    expect((state.body as { persona: { id: string } }).persona.id).toBe("larae");
  });

  it("exposes the deployed policy versions and rejects stale acceptance", async () => {
    const current = createMockResponse();
    getCurrentPolicies({} as Request, current.response);
    expect(current.state.statusCode).toBe(200);
    expect(current.state.body).toMatchObject({
      termsVersion: expect.any(String),
      privacyVersion: expect.any(String),
      termsPath: "/terms",
      privacyPath: "/privacy"
    });

    await expect(acceptPolicies({
      auth: {
        userId: "user_policy",
        sessionId: "session_policy",
        clientType: "web",
        policyConsentRequired: true
      },
      body: { termsVersion: "stale", privacyVersion: "stale" }
    } as Request, createMockResponse().response)).rejects.toMatchObject({
      statusCode: 409
    });
  });

  it("returns structured chat output from the chat controller", async () => {
    const { response, state } = createMockResponse();

    await postChat(
      {
        header: (name: string) => name.toLowerCase() === "x-owner-id" ? "test-owner" : undefined,
        body: {
          personaId: "larae",
          provider: "openai",
          message: "Search the web and give me an image and file.",
          audio: false
        }
      } as Request,
      response
    );

    const payload = state.body as {
      conversationId: string;
      history: Array<{ role: string }>;
      outputs: Array<{ type: string }>;
      diagnostics: { backgroundJob?: { id: string; status: string } };
    };

    expect(state.statusCode).toBe(202);
    expect(payload.conversationId).toMatch(/^conv_/);
    expect(payload.history).toHaveLength(1);
    expect(payload.outputs.some((output) => output.type === "status")).toBe(true);
    expect(payload.diagnostics.backgroundJob?.id).toMatch(/^chat_job_/);
    expect(payload.diagnostics.backgroundJob?.status).toBe("running");
  });

  it("rejects an unknown persona before creating background work", async () => {
    const { response } = createMockResponse();

    await expect(postChat(
      {
        header: (name: string) => name.toLowerCase() === "x-owner-id" ? "unknown-persona-owner" : undefined,
        body: {
          personaId: "missing-persona",
          provider: "openai",
          message: "Generate an image.",
          audio: false,
          toolOptions: { imageGeneration: true, background: true }
        }
      } as Request,
      response
    )).rejects.toMatchObject({
      statusCode: 404
    });
  });

  it("releases a streaming usage reservation when request preflight fails", async () => {
    const check = vi.spyOn(usageControlService, "check").mockResolvedValue("reservation_stream_test");
    const recordUsage = vi.spyOn(usageControlService, "recordUsage").mockResolvedValue();

    await expect(postChatStream(
      {
        header: (name: string) => name.toLowerCase() === "x-owner-id" ? "stream-preflight-owner" : undefined,
        body: {}
      } as Request,
      {
        locals: { requestId: "request-stream-preflight" }
      } as unknown as Response
    )).rejects.toBeDefined();

    expect(check).toHaveBeenCalledWith("stream-preflight-owner", {
      deviceKey: expect.stringMatching(/^device:[a-f0-9]{64}$/)
    });
    expect(recordUsage).toHaveBeenCalledWith(
      "stream-preflight-owner",
      undefined,
      undefined,
      "reservation_stream_test"
    );
  });

  it("cancels a provider response attached while a background job is being cancelled", async () => {
    const initialJob = {
      id: "chat_job_cancel_race",
      status: "running" as const,
      updatedAt: new Date().toISOString()
    };
    const cancelledJob = {
      ...initialJob,
      status: "cancelled" as const,
      providerResponseId: "resp_attached_during_cancel"
    };
    vi.spyOn(backgroundChatJobService, "get").mockResolvedValue(initialJob);
    vi.spyOn(backgroundChatJobService, "cancel").mockResolvedValue(cancelledJob);
    const cancelProviderResponse = vi
      .spyOn(openAIResponseLifecycleService, "cancel")
      .mockResolvedValue();
    const { response, state } = createMockResponse();

    await cancelChatJob(
      {
        params: { jobId: initialJob.id },
        header: (name: string) => name.toLowerCase() === "x-owner-id" ? "cancel-race-owner" : undefined
      } as unknown as Request,
      response
    );

    expect(cancelProviderResponse).toHaveBeenCalledWith("resp_attached_during_cancel");
    expect(state.statusCode).toBe(200);
    expect(state.body).toEqual(cancelledJob);
  });
});
