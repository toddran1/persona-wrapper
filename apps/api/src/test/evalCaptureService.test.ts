import { describe, expect, it } from "vitest";
import { EvalCaptureService } from "../services/evalCaptureService.js";

describe("EvalCaptureService persona review data", () => {
  it("returns a persona catalog and isolates the selected persona paths", () => {
    const result = new EvalCaptureService().getReviewData("bambam");

    expect(result.persona.id).toBe("bambam");
    expect(result.personas.map((persona) => persona.id)).toEqual(expect.arrayContaining(["larae", "bambam"]));
    expect(result.paths.syntheticPairs).toMatch(/ml\/style-transfer\/personas\/bambam\/processed\/style_transfer\.pairs\.jsonl$/);
    expect(result.paths.syntheticPairs).not.toContain("datasets/processed/style_transfer.pairs.jsonl");
  });

  it("falls back safely when a bookmarked persona no longer exists", () => {
    const result = new EvalCaptureService().getReviewData("removed-persona");

    expect(result.persona.id).toBe("larae");
  });
});
