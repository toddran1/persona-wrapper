import type { CustomerUsageMeter, ImageGenerationQuality, PlanId } from "@persona/shared";
import { getPersonaById } from "../personas/index.js";

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
  /** "minimum_plan" derives access from each persona profile; "all" includes future personas. */
  personaAccess: "listed" | "minimum_plan" | "all";
  personaIds: string[];
  allowances: Partial<Record<CustomerUsageMeter, number | null>>;
  monthlyProviderCostBudget: {
    targetMicroUsd: number;
    ceilingMicroUsd: number;
  };
};

const CURRENT_PLAN_VERSION = 1;
const PLAN_RANK: Record<PlanId, number> = {
  bronze: 0,
  silver: 1,
  gold: 2
};

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
    personaAccess: "minimum_plan",
    personaIds: [],
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
    personaAccess: "minimum_plan",
    personaIds: [],
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
    personaAccess: "all",
    personaIds: [],
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

/**
 * Keep every released catalog version here. Assignment rows retain their
 * version so grandfathered access continues to resolve against the terms that
 * were granted rather than silently adopting a future catalog revision.
 */
const planCatalogVersions: Record<number, Record<PlanId, PlanDefinition>> = {
  [CURRENT_PLAN_VERSION]: planCatalog
};

export function getPlanDefinition(planId: string | undefined, version?: number): PlanDefinition {
  const catalog = version === undefined
    ? planCatalog
    : planCatalogVersions[version] ?? planCatalog;
  if (planId === "silver" || planId === "gold") return catalog[planId];
  return catalog.bronze;
}

export function planIncludesPersona(plan: PlanDefinition, personaId: string): boolean {
  if (plan.personaAccess === "all") return true;
  if (plan.personaAccess === "listed") return plan.personaIds.includes(personaId);
  const persona = getPersonaById(personaId);
  return Boolean(persona && PLAN_RANK[plan.id] >= PLAN_RANK[persona.minimumPlan]);
}

/** Free (bronze) accounts are ChatGPT-only; paid plans may pick any provider. */
export function planAllowsModelProvider(plan: PlanDefinition, provider: string): boolean {
  return plan.id !== "bronze" || provider === "openai";
}

export function personaIdsForPlan(plan: PlanDefinition, catalogPersonaIds: readonly string[]): string[] {
  return catalogPersonaIds.filter((personaId) => planIncludesPersona(plan, personaId));
}
