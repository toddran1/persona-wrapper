import { apiContract } from "@persona/shared";
import { initServer } from "@ts-rest/express";
import { getPersonaById, listPersonas } from "../personas/index.js";

const server = initServer();

export const personaContractRouter = server.router(apiContract.personas, {
  list: async () => ({
    status: 200,
    body: { personas: listPersonas() }
  }),
  get: async ({ params }) => {
    const persona = getPersonaById(params.id);
    if (!persona) {
      return { status: 404, body: { error: "Persona not found" } };
    }
    return { status: 200, body: { persona } };
  }
});
