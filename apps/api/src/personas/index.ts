import { personaDefinitionSchema, type PersonaDefinition, type PersonaDefinitionInput } from "@persona/shared";
import { laraePersona } from "./larae.persona.js";
import { bamBamPersona } from "./bambam.persona.js";
import { neutralPersona } from "./neutral.persona.js";

// Keep the neutral persona last: clients treat the first listed persona as the default.
const personaInputs: PersonaDefinitionInput[] = [laraePersona, bamBamPersona, neutralPersona];

export function validatePersonaRegistry(inputs: readonly PersonaDefinitionInput[]): PersonaDefinition[] {
  const parsed = inputs.map((persona) => personaDefinitionSchema.parse(persona));
  const seenIds = new Set<string>();
  for (const persona of parsed) {
    if (seenIds.has(persona.id)) {
      throw new Error(`Duplicate persona ID "${persona.id}". Persona IDs must be unique and stable.`);
    }
    seenIds.add(persona.id);
  }
  return parsed;
}

const personas: PersonaDefinition[] = validatePersonaRegistry(personaInputs);

export function listPersonas(): PersonaDefinition[] {
  return [...personas];
}

export function getPersonaById(id: string): PersonaDefinition | undefined {
  return personas.find((persona) => persona.id === id);
}
