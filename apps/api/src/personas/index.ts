import { personaDefinitionSchema, type PersonaDefinition, type PersonaDefinitionInput } from "@persona/shared";
import { laraePersona } from "./larae.persona.js";

const personaInputs: PersonaDefinitionInput[] = [laraePersona];
const personas: PersonaDefinition[] = personaInputs.map((persona) => personaDefinitionSchema.parse(persona));

export function listPersonas(): PersonaDefinition[] {
  return personas;
}

export function getPersonaById(id: string): PersonaDefinition | undefined {
  return personas.find((persona) => persona.id === id);
}
