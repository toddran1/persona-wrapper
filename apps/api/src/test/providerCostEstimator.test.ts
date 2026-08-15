import { describe, expect, it } from "vitest";
import { estimateProviderCost } from "../services/providerCostEstimator.js";

describe("provider cost estimator", () => {
  it("combines OpenAI model, image, and hosted-tool estimates", () => {
    const estimate = estimateProviderCost({
      provider: "openai",
      reportedModelCostUsd: 0.02,
      generatedImageCount: 1,
      imageQuality: "medium",
      imageSize: "1024x1024",
      webSearchCalls: 1,
      fileSearchCalls: 1,
      codeInterpreterSessions: 1
    });

    expect(estimate.estimatedCostUsd).toBe(0.1155);
    expect(estimate.components).toMatchObject({
      reported_model_usage: 0.02,
      image_generation: 0.053,
      web_search: 0.01,
      file_search: 0.0025,
      code_interpreter: 0.03
    });
    expect(estimate.unpricedComponents).toEqual([]);
  });

  it("prices FLUX image generation and editing separately from OpenAI tiers", () => {
    const generation = estimateProviderCost({
      provider: "openai",
      generatedImageCount: 1,
      imageProvider: "flux",
      imageQuality: "high",
      imageSize: "1024x1024"
    });
    expect(generation.components.image_generation).toBe(0.03);

    const edit = estimateProviderCost({
      provider: "openai",
      generatedImageCount: 1,
      imageProvider: "flux",
      imageEdit: true
    });
    expect(edit.components.image_generation).toBe(0.045);
  });

  it("keeps unknown providers usable while flagging unpriced components", () => {
    const estimate = estimateProviderCost({
      provider: "future_provider",
      reportedModelCostUsd: 0.04,
      generatedImageCount: 1,
      webSearchCalls: 1
    });

    expect(estimate.estimatedCostUsd).toBe(0.04);
    expect(estimate.unpricedComponents).toEqual(["image_generation", "web_search"]);
  });

  it("prices automatic GPT Image 2 quality conservatively for the total-usage guardrail", () => {
    const estimate = estimateProviderCost({
      provider: "openai",
      generatedImageCount: 1,
      imageQuality: "auto",
      imageSize: "1024x1024"
    });

    expect(estimate.components.image_generation).toBe(0.211);
    expect(estimate.estimatedCostUsd).toBe(0.211);
  });

  it("accounts for Gemini-native search and OpenAI-delegated image generation", () => {
    const estimate = estimateProviderCost({
      provider: "gemini",
      reportedModelCostUsd: 0.01,
      generatedImageCount: 1,
      imageQuality: "medium",
      imageSize: "1024x1024",
      webSearchCalls: 1,
      codeInterpreterSessions: 1
    });

    expect(estimate.estimatedCostUsd).toBe(0.077);
    expect(estimate.components).toMatchObject({
      reported_model_usage: 0.01,
      image_generation: 0.053,
      web_search: 0.014
    });
    expect(estimate.components).not.toHaveProperty("code_interpreter");
    expect(estimate.unpricedComponents).toEqual([]);
  });

  it("includes configured cross-provider media and style costs in total usage", () => {
    const estimate = estimateProviderCost({
      provider: "openai",
      reportedModelCostUsd: 0.01,
      imageInputCount: 2,
      imageInputCostUsd: 0.005,
      audioCost: 0.15,
      styleTransferCalls: 1,
      styleTransferCostPerCallUsd: 0.02
    });

    expect(estimate.estimatedCostUsd).toBe(0.19);
    expect(estimate.components).toMatchObject({
      reported_model_usage: 0.01,
      image_input: 0.01,
      audio_generation: 0.15,
      style_transfer: 0.02
    });
  });
});
