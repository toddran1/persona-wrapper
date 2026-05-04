import type { PersonaDefinition } from "@persona/shared";
import { laraePersona } from "./larae.persona.js";

const personas: PersonaDefinition[] = [laraePersona];

export function listPersonas(): PersonaDefinition[] {
  return personas;
}

export function getPersonaById(id: string): PersonaDefinition | undefined {
  return personas.find((persona) => persona.id === id);
}

