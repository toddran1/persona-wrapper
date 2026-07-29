import type { CustomerUsageMeter, ImageGenerationQuality, PlanId } from "@persona/shared";

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
  /** Effective provider value. Medium is the capped-auto policy for Bronze/Silver. */
  imageQuality: Extract<ImageGenerationQuality, "auto" | "medium">;
  personaIds: string[];
  allowances: Partial<Record<CustomerUsageMeter, number | null>>;
  monthlyProviderCostBudget: {
    targetMicroUsd: number;
    ceilingMicroUsd: number;
  };
};

const CURRENT_PLAN_VERSION = 1;
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
    imageQuality: "medium",
    personaIds: ["larae"],
    allowances: {
      total_usage_microusd: 3_000_000,
      credits: 24,
      audio_seconds: 10 * 60
    },
    monthlyProviderCostBudget: {
      targetMicroUsd: 1_250_000,
      ceilingMicroUsd: 3_000_000
    }
  },
  silver: {
    id: "silver",
    version: CURRENT_PLAN_VERSION,
    displayName: "Silver",
    description: "More media usage, most personas, and no ads.",
    monthlyPriceCents: 799,
    adsEnabled: false,
    priorityQueue: false,
    maxConcurrentMediaJobs: 2,
    imageQuality: "medium",
    personaIds: CURRENT_PERSONA_IDS,
    allowances: {
      total_usage_microusd: 5_000_000,
      credits: 90,
      audio_seconds: 45 * 60
    },
    monthlyProviderCostBudget: {
      targetMicroUsd: 2_750_000,
      ceilingMicroUsd: 5_000_000
    }
  },
  gold: {
    id: "gold",
    version: CURRENT_PLAN_VERSION,
    displayName: "Gold",
    description: "The full persona library and the most generous media limits.",
    monthlyPriceCents: 1199,
    adsEnabled: false,
    priorityQueue: true,
    maxConcurrentMediaJobs: 3,
    imageQuality: "auto",
    personaIds: CURRENT_PERSONA_IDS,
    allowances: {
      total_usage_microusd: 8_000_000,
      credits: 180,
      audio_seconds: 75 * 60
    },
    monthlyProviderCostBudget: {
      targetMicroUsd: 4_500_000,
      ceilingMicroUsd: 8_000_000
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
