import { describe, expect, it } from "vitest";
import type { ChatRequest } from "@persona/shared";
import { getPlanDefinition } from "../services/planCatalog.js";
import { applyPlanImageQuality } from "../services/planImageQualityPolicy.js";

function imageRequest(imageQuality: "auto" | "low" | "medium" | "high"): ChatRequest {
  return {
    personaId: "larae",
    message: "Generate an image.",
    provider: "openai",
    audio: false,
    testMode: false,
    history: [],
    toolOptions: {
      webSearch: false,
      fileSearch: false,
      codeInterpreter: false,
      imageGeneration: true,
      imageQuality,
      appFunctions: true,
      background: false,
      vectorStoreIds: []
    }
  };
}

describe("plan image-quality policy", () => {
  it.each(["bronze", "silver"] as const)(
    "caps %s image requests at medium even when the client asks for high",
    (planId) => {
      const request = applyPlanImageQuality(imageRequest("high"), getPlanDefinition(planId));
      expect(request.toolOptions?.imageQuality).toBe("medium");
    }
  );

  it("uses unrestricted auto image quality for Gold", () => {
    const request = applyPlanImageQuality(imageRequest("high"), getPlanDefinition("gold"));
    expect(request.toolOptions?.imageQuality).toBe("auto");
  });
});
