import { describe, expect, it } from "vitest";
import type { ChatResponse } from "@persona/shared";
import {
  actualImageGenerationCredits,
  billableGeneratedImageCount,
  imageGenerationCredits
} from "../services/usageCreditPolicy.js";

function responseWithOutputs(outputs: ChatResponse["outputs"]): ChatResponse {
  return {
    conversationId: "conv_test",
    personaId: "larae",
    provider: "openai_persona",
    message: "",
    outputs,
    audio: null,
    history: [],
    diagnostics: {
      styleTransfer: "skipped",
      tts: { status: "skipped" }
    }
  };
}

describe("usage credit policy", () => {
  it("charges image credits by configured quality", () => {
    expect(imageGenerationCredits(1, "low")).toBe(1);
    expect(imageGenerationCredits(1, "auto")).toBe(2);
    expect(imageGenerationCredits(1, "medium")).toBe(2);
    expect(imageGenerationCredits(1, "high")).toBe(8);
    expect(imageGenerationCredits(3, "high")).toBe(24);
  });

  it("does not charge for an absent image output", () => {
    expect(imageGenerationCredits(0, "high")).toBe(0);
  });

  it("charges actual image-generation outputs even when routing changed during chat context resolution", () => {
    const response = responseWithOutputs([{
      type: "image",
      url: "data:image/png;base64,dGVzdA==",
      alt: "Generated result",
      metadata: { generationSource: "openai_image_generation" }
    }]);

    expect(billableGeneratedImageCount(response)).toBe(1);
    expect(actualImageGenerationCredits(response)).toBe(imageGenerationCredits(1));
  });

  it("does not charge image credits for Code Interpreter chart artifacts", () => {
    const response = responseWithOutputs([{
      type: "image",
      url: "https://example.test/chart.png",
      alt: "Generated chart",
      metadata: { containerId: "container_123" }
    }]);

    expect(billableGeneratedImageCount(response)).toBe(0);
    expect(actualImageGenerationCredits(response)).toBe(0);
  });

  it("recognizes direct-image outputs created before provenance markers were added", () => {
    const response = responseWithOutputs([{
      type: "image",
      url: "data:image/png;base64,dGVzdA==",
      alt: "Generated result",
      metadata: { route: "images_api_edit" }
    }]);

    expect(billableGeneratedImageCount(response)).toBe(1);
  });
});
