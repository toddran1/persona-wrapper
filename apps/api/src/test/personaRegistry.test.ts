import { describe, expect, it } from "vitest";
import type { PersonaDefinitionInput } from "@persona/shared";
import { getPersonaById, listPersonas, validatePersonaRegistry } from "../personas/index.js";

describe("persona registry", () => {
  it("returns a defensive catalog copy", () => {
    const catalog = listPersonas();
    catalog.length = 0;

    expect(listPersonas().length).toBeGreaterThan(0);
    expect(getPersonaById("larae")?.id).toBe("larae");
  });

  it("rejects duplicate stable persona IDs during startup validation", () => {
    const persona = getPersonaById("larae");
    expect(persona).toBeDefined();

    expect(() => validatePersonaRegistry([
      persona as PersonaDefinitionInput,
      persona as PersonaDefinitionInput
    ])).toThrow('Duplicate persona ID "larae"');
  });
});
