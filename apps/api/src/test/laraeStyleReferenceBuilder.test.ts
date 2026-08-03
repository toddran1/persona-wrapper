import { describe, expect, it } from "vitest";
import { getPersonaById } from "../personas/index.js";
import {
  buildPersonaStyleReference,
  getPersonaStyleDatasetPaths,
  resetPersonaStyleReferenceCache
} from "../services/personaStyleReferenceBuilder.js";
import { estimateTextTokens } from "../utils/tokenBudget.js";

const larae = getPersonaById("larae")!;

describe("personaStyleReferenceBuilder", () => {
  it("builds a style-only reference from synthetic and golden pairs", () => {
    resetPersonaStyleReferenceCache("larae");

    const reference = buildPersonaStyleReference(larae);

    expect(reference).toContain("LaRae style reference examples.");
    expect(reference).toContain("style references only");
    expect(reference).toContain("Keep the target style present across the whole answer");
    expect(reference).toContain("every paragraph, bullet, numbered item, explanation, and transition");
    expect(reference).toContain("Speech style:");
    expect(reference).toContain("Catchphrases and vocabulary cues:");
    expect(reference).toContain("Synthetic examples:");
    expect(reference).toContain("Golden examples:");
    expect(reference.match(/INPUT:/g)).toHaveLength(12);
    expect(reference.match(/OUTPUT:/g)).toHaveLength(12);
    expect(reference).not.toContain("Preserve all names, dates, years, numbers");
    expect(reference).not.toContain("\"instruction\"");
  });

  it("can bound the reference examples by token budget", () => {
    resetPersonaStyleReferenceCache("larae");

    const reference = buildPersonaStyleReference(larae, {
      syntheticLimit: 20,
      goldenLimit: 5,
      maxTokens: 700
    });

    expect(estimateTextTokens(reference)).toBeLessThanOrEqual(710);
    expect(reference).toContain("LaRae style reference examples.");
  });

  it("supports a persona-scoped dataset that has not been populated yet", () => {
    const futurePersona = {
      ...larae,
      id: "future-persona",
      name: "Future Persona",
      shortName: "Future",
      styleReference: {
        enabled: true,
        datasetKey: "future-persona",
        syntheticLimit: 8,
        goldenLimit: 4
      }
    };

    const reference = buildPersonaStyleReference(futurePersona);
    expect(reference).toContain("Future style reference examples.");
    expect(reference).not.toContain("Synthetic examples:");
    expect(reference).not.toContain("Golden examples:");
  });

  it("keeps each non-legacy persona in an isolated dataset directory", () => {
    const paths = getPersonaStyleDatasetPaths("bambam");

    expect(paths.evals).toMatch(/ml\/style-transfer\/personas\/bambam\/evals\/style_transfer_failures\.jsonl$/);
    expect(paths.synthetic).toMatch(/ml\/style-transfer\/personas\/bambam\/processed\/style_transfer\.pairs\.jsonl$/);
    expect(paths.golden).toMatch(/ml\/style-transfer\/personas\/bambam\/curated\/golden_style_pairs_seed\.jsonl$/);
    expect(paths.heuristicRejections).toMatch(/ml\/style-transfer\/personas\/bambam\/processed\/heuristic_candidates\.rejected\.jsonl$/);
  });

  it("rejects dataset keys that could escape the persona dataset directory", () => {
    expect(() => getPersonaStyleDatasetPaths("../outside")).toThrow("Invalid persona style dataset key");
  });
});
