import type { CustomerUsageMeter, PlanId } from "@persona/shared";

export type PlanDefinition = {
  id: PlanId;
  version: number;
  displayName: string;
  description: string;
  adsEnabled: boolean;
  priorityQueue: boolean;
  maxConcurrentMediaJobs: number;
  personaIds: string[];
  allowances: Partial<Record<CustomerUsageMeter, number | null>>;
};

const CURRENT_PLAN_VERSION = 1;
const CURRENT_PERSONA_IDS = ["larae"];

export const planCatalog: Record<PlanId, PlanDefinition> = {
  bronze: {
    id: "bronze",
    version: CURRENT_PLAN_VERSION,
    displayName: "Bronze",
    description: "Core chat access with a small monthly media allowance.",
    adsEnabled: true,
    priorityQueue: false,
    maxConcurrentMediaJobs: 1,
    personaIds: ["larae"],
    allowances: {
      image_outputs: 20,
      audio_seconds: 5 * 60
    }
  },
  silver: {
    id: "silver",
    version: CURRENT_PLAN_VERSION,
    displayName: "Silver",
    description: "More media usage, most personas, and no ads.",
    adsEnabled: false,
    priorityQueue: false,
    maxConcurrentMediaJobs: 2,
    personaIds: CURRENT_PERSONA_IDS,
    allowances: {
      image_outputs: 100,
      audio_seconds: 30 * 60
    }
  },
  gold: {
    id: "gold",
    version: CURRENT_PLAN_VERSION,
    displayName: "Gold",
    description: "The full persona library and the most generous media limits.",
    adsEnabled: false,
    priorityQueue: true,
    maxConcurrentMediaJobs: 3,
    personaIds: CURRENT_PERSONA_IDS,
    allowances: {
      image_outputs: 200,
      audio_seconds: 90 * 60
    }
  }
};

export function getPlanDefinition(planId: string | undefined): PlanDefinition {
  if (planId === "silver" || planId === "gold") return planCatalog[planId];
  return planCatalog.bronze;
}

export function planIncludesPersona(plan: PlanDefinition, personaId: string): boolean {
  return plan.personaIds.includes(personaId);
}
