import type { Request, Response } from "express";
import { getPersonaById, listPersonas } from "../personas/index.js";

export function getPersonas(_request: Request, response: Response): void {
  const personas = listPersonas().map((persona) => ({
    id: persona.id,
    name: persona.name,
    legalName: persona.legalName,
    age: persona.age,
    height: persona.height,
    weight: persona.weight,
    tagline: persona.tagline,
    description: persona.description,
    avatarColor: persona.avatarColor,
    avatarUrl: persona.avatarUrl,
    visualStage: persona.visualStage,
    theme: persona.theme,
    documentTitle: persona.documentTitle,
    promptPlaceholder: persona.promptPlaceholder,
    suggestedPrompts: persona.suggestedPrompts,
    supportedProviders: persona.supportedProviders
  }));

  response.status(200).json({ personas });
}

export function getPersona(request: Request, response: Response): void {
  const id = typeof request.params.id === "string" ? request.params.id : undefined;
  if (!id) {
    response.status(400).json({ error: "Persona id is required" });
    return;
  }

  const persona = getPersonaById(id);
  if (!persona) {
    response.status(404).json({ error: "Persona not found" });
    return;
  }

  response.status(200).json({ persona });
}
