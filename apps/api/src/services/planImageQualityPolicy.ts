import type { ChatRequest } from "@persona/shared";
import type { PlanDefinition } from "./planCatalog.js";

/**
 * Applies the server-owned image-quality entitlement. Client-provided quality
 * values are never trusted. OpenAI has no auto-with-a-medium-cap parameter, so
 * Bronze and Silver use medium while Gold can use unrestricted auto.
 */
export function applyPlanImageQuality(payload: ChatRequest, plan: PlanDefinition): ChatRequest {
  if (!payload.toolOptions) return payload;
  return {
    ...payload,
    toolOptions: {
      ...payload.toolOptions,
      imageQuality: plan.imageQuality
    }
  };
}
