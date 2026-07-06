import type { Request, Response } from "express";
import { describe, expect, it } from "vitest";
import { postChat } from "../controllers/chat.controller.js";
import { getPersona, getPersonas } from "../controllers/persona.controller.js";

function createMockResponse() {
  const state: {
    statusCode: number;
    body: unknown;
  } = {
    statusCode: 200,
    body: undefined
  };

  const response = {
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
});
