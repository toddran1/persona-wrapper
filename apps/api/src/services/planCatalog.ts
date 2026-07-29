import type { CustomerUsageMeter, PlanId } from "@persona/shared";

export type PlanDefinition = {
  id: PlanId;
  version: number;
  displayName: string;
  description: string;
  /** Catalog metadata only until a billing entitlement adapter is connected. */
  monthlyPriceCents: number | null;
  adsEnabled: boolean;
  priorityQueue: boolean;
  maxConcurrentMediaJobs: number;
  personaIds: string[];
  allowances: Partial<Record<CustomerUsageMeter, number | null>>;
  monthlyProviderCostBudget: {
    targetMicroUsd: number;
    ceilingMicroUsd: number;
  };
};

const CURRENT_PLAN_VERSION = 5;
const CURRENT_PERSONA_IDS = ["larae"];

export const planCatalog: Record<PlanId, PlanDefinition> = {
  bronze: {
    id: "bronze",
    version: CURRENT_PLAN_VERSION,
    displayName: "Bronze",
    description: "Core chat access with a small monthly media allowance.",
    monthlyPriceCents: null,
    adsEnabled: true,
    priorityQueue: false,
    maxConcurrentMediaJobs: 1,
    personaIds: ["larae"],
    allowances: {
      total_usage_microusd: 1_000_000,
      credits: 12,
      audio_seconds: 5 * 60
    },
    monthlyProviderCostBudget: {
      targetMicroUsd: 500_000,
      ceilingMicroUsd: 1_000_000
    }
  },
  silver: {
    id: "silver",
    version: CURRENT_PLAN_VERSION,
    displayName: "Silver",
    description: "More media usage, most personas, and no ads.",
    monthlyPriceCents: 599,
    adsEnabled: false,
    priorityQueue: false,
    maxConcurrentMediaJobs: 2,
    personaIds: CURRENT_PERSONA_IDS,
    allowances: {
      total_usage_microusd: 3_000_000,
      credits: 60,
      audio_seconds: 30 * 60
    },
    monthlyProviderCostBudget: {
      targetMicroUsd: 1_750_000,
      ceilingMicroUsd: 3_000_000
    }
  },
  gold: {
    id: "gold",
    version: CURRENT_PLAN_VERSION,
    displayName: "Gold",
    description: "The full persona library and the most generous media limits.",
    monthlyPriceCents: 999,
    adsEnabled: false,
    priorityQueue: true,
    maxConcurrentMediaJobs: 3,
    personaIds: CURRENT_PERSONA_IDS,
    allowances: {
      total_usage_microusd: 5_750_000,
      credits: 120,
      audio_seconds: 60 * 60
    },
    monthlyProviderCostBudget: {
      targetMicroUsd: 3_250_000,
      ceilingMicroUsd: 5_750_000
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
