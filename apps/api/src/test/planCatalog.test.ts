import { describe, expect, it } from "vitest";
import { getPlanDefinition, planAllowsModelProvider } from "../services/planCatalog.js";

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
