export type ProviderCostComponent =
  | "reported_model_usage"
  | "image_generation"
  | "image_input"
  | "audio_generation"
  | "style_transfer"
  | "web_search"
  | "file_search"
  | "code_interpreter";

export type ProviderCostEstimateInput = {
  provider: string;
  reportedModelCostUsd?: number;
  generatedImageCount?: number;
  imageQuality?: "auto" | "low" | "medium" | "high";
  imageSize?: string;
  imageInputCount?: number;
  imageInputCostUsd?: number;
  audioCost?: number;
  styleTransferCalls?: number;
  styleTransferCostPerCallUsd?: number;
  webSearchCalls?: number;
  fileSearchCalls?: number;
  codeInterpreterSessions?: number;
};

export type ProviderCostEstimate = {
  estimatedCostUsd: number;
  components: Partial<Record<ProviderCostComponent, number>>;
  unpricedComponents: string[];
};

type ProviderPricingAdapter = {
  estimate(input: ProviderCostEstimateInput): ProviderCostEstimate;
};

const OPENAI_IMAGE_OUTPUT_COST_USD = {
  low: { square: 0.006, nonSquare: 0.005 },
  medium: { square: 0.053, nonSquare: 0.041 },
  high: { square: 0.211, nonSquare: 0.165 }
} as const;

function positive(value: number | undefined): number {
  return value && Number.isFinite(value) && value > 0 ? value : 0;
}

function roundedUsd(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function openAIImageOutputCost(
  count: number,
  quality: ProviderCostEstimateInput["imageQuality"],
  size: string | undefined
): number {
  if (count <= 0) return 0;
  // Product treats auto as medium-equivalent. For auto/arbitrary sizes, use
  // the documented square reference as a conservative planning estimate.
  const normalizedQuality = quality === "low" || quality === "high" ? quality : "medium";
  const shape = size === "1024x1536" || size === "1536x1024" ? "nonSquare" : "square";
  return count * OPENAI_IMAGE_OUTPUT_COST_USD[normalizedQuality][shape];
}

function addSharedProviderCosts(
  input: ProviderCostEstimateInput,
  components: ProviderCostEstimate["components"]
): void {
  const imageInputCost = positive(input.imageInputCount) * positive(input.imageInputCostUsd);
  if (imageInputCost > 0) components.image_input = roundedUsd(imageInputCost);

  const audioCost = positive(input.audioCost);
  if (audioCost > 0) components.audio_generation = roundedUsd(audioCost);

  const styleTransferCost = positive(input.styleTransferCalls) * positive(input.styleTransferCostPerCallUsd);
  if (styleTransferCost > 0) components.style_transfer = roundedUsd(styleTransferCost);
}

const openAIPricingAdapter: ProviderPricingAdapter = {
  estimate(input) {
    const components: ProviderCostEstimate["components"] = {};
    const reportedModelCost = positive(input.reportedModelCostUsd);
    if (reportedModelCost > 0) components.reported_model_usage = reportedModelCost;

    const imageCost = openAIImageOutputCost(
      Math.ceil(positive(input.generatedImageCount)),
      input.imageQuality,
      input.imageSize
    );
    if (imageCost > 0) components.image_generation = imageCost;

    const webSearchCost = positive(input.webSearchCalls) * 0.01;
    if (webSearchCost > 0) components.web_search = webSearchCost;

    const fileSearchCost = positive(input.fileSearchCalls) * 0.0025;
    if (fileSearchCost > 0) components.file_search = fileSearchCost;

    const codeInterpreterCost = positive(input.codeInterpreterSessions) * 0.03;
    if (codeInterpreterCost > 0) components.code_interpreter = codeInterpreterCost;
    addSharedProviderCosts(input, components);

    return {
      estimatedCostUsd: roundedUsd(Object.values(components).reduce((sum, value) => sum + (value ?? 0), 0)),
      components,
      unpricedComponents: []
    };
  }
};

const geminiPricingAdapter: ProviderPricingAdapter = {
  estimate(input) {
    // Gemini text usage is reported by the provider. Image generation and
    // OpenAI vector-store searches are explicitly delegated and retain their
    // underlying capability price, while native Gemini code execution is
    // token-priced rather than billed as an OpenAI container session.
    const components: ProviderCostEstimate["components"] = {};
    const reportedModelCost = positive(input.reportedModelCostUsd);
    if (reportedModelCost > 0) components.reported_model_usage = reportedModelCost;
    const imageCost = openAIImageOutputCost(
      Math.ceil(positive(input.generatedImageCount)),
      input.imageQuality,
      input.imageSize
    );
    if (imageCost > 0) components.image_generation = imageCost;
    const webSearchCost = positive(input.webSearchCalls) * 0.014;
    if (webSearchCost > 0) components.web_search = webSearchCost;
    const fileSearchCost = positive(input.fileSearchCalls) * 0.0025;
    if (fileSearchCost > 0) components.file_search = fileSearchCost;
    addSharedProviderCosts(input, components);
    return {
      estimatedCostUsd: roundedUsd(Object.values(components).reduce((sum, value) => sum + (value ?? 0), 0)),
      components,
      unpricedComponents: []
    };
  }
};

const adapters = new Map<string, ProviderPricingAdapter>([
  ["openai", openAIPricingAdapter],
  ["gemini", geminiPricingAdapter]
]);

/**
 * Provider-neutral COGS entry point. Future providers add an adapter instead
 * of changing plan definitions or request controllers.
 */
export function estimateProviderCost(input: ProviderCostEstimateInput): ProviderCostEstimate {
  const adapter = adapters.get(input.provider);
  if (adapter) return adapter.estimate(input);
  const reportedModelCost = positive(input.reportedModelCostUsd);
  const components: ProviderCostEstimate["components"] = reportedModelCost > 0
    ? { reported_model_usage: reportedModelCost }
    : {};
  addSharedProviderCosts(input, components);
  return {
    estimatedCostUsd: roundedUsd(Object.values(components).reduce((sum, value) => sum + (value ?? 0), 0)),
    components,
    unpricedComponents: [
      ...(positive(input.generatedImageCount) > 0 ? ["image_generation"] : []),
      ...(positive(input.imageInputCount) > 0 && positive(input.imageInputCostUsd) === 0 ? ["image_input"] : []),
      ...(positive(input.styleTransferCalls) > 0 && positive(input.styleTransferCostPerCallUsd) === 0 ? ["style_transfer"] : []),
      ...(positive(input.webSearchCalls) > 0 ? ["web_search"] : []),
      ...(positive(input.fileSearchCalls) > 0 ? ["file_search"] : []),
      ...(positive(input.codeInterpreterSessions) > 0 ? ["code_interpreter"] : [])
    ]
  };
}
