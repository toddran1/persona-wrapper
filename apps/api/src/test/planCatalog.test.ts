import { describe, expect, it } from "vitest";
import { getPlanDefinition, planAllowsImageProvider, planAllowsModelProvider } from "../services/planCatalog.js";

describe("planCatalog model provider access", () => {
  it("restricts free (bronze) accounts to ChatGPT", () => {
    const bronze = getPlanDefinition("bronze");

    expect(planAllowsModelProvider(bronze, "openai")).toBe(true);
    expect(planAllowsModelProvider(bronze, "gemini")).toBe(false);
    expect(planAllowsModelProvider(bronze, "claude")).toBe(false);
    expect(planAllowsModelProvider(bronze, "local")).toBe(false);
  });

  it("allows paid plans to pick any provider", () => {
    for (const planId of ["silver", "gold"] as const) {
      const plan = getPlanDefinition(planId);

      expect(planAllowsModelProvider(plan, "openai")).toBe(true);
      expect(planAllowsModelProvider(plan, "gemini")).toBe(true);
    }
  });
});

describe("planCatalog image provider access", () => {
  it("restricts FLUX.2 Pro to the gold plan", () => {
    expect(planAllowsImageProvider(getPlanDefinition("bronze"), "openai")).toBe(true);
    expect(planAllowsImageProvider(getPlanDefinition("bronze"), "flux")).toBe(false);
    expect(planAllowsImageProvider(getPlanDefinition("silver"), "openai")).toBe(true);
    expect(planAllowsImageProvider(getPlanDefinition("silver"), "flux")).toBe(false);
    expect(planAllowsImageProvider(getPlanDefinition("gold"), "openai")).toBe(true);
    expect(planAllowsImageProvider(getPlanDefinition("gold"), "flux")).toBe(true);
  });
});
