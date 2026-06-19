import { describe, expect, it } from "vitest";
import { buildLaraeStyleReference, resetLaraeStyleReferenceCache } from "../services/laraeStyleReferenceBuilder.js";

describe("laraeStyleReferenceBuilder", () => {
  it("builds a style-only reference from synthetic and golden pairs", () => {
    resetLaraeStyleReferenceCache();

    const reference = buildLaraeStyleReference();

    expect(reference).toContain("LaRae style reference examples.");
    expect(reference).toContain("style references only");
    expect(reference).toContain("high style density across the whole answer");
    expect(reference).toContain("every paragraph, bullet, numbered item, explanation, and transition");
    expect(reference).toContain("fuck, fucking, bitch, nigga, hoe, pussy");
    expect(reference).toContain("ratchet, messy, loud, vulgar, sexy");
    expect(reference).toContain("Synthetic examples:");
    expect(reference).toContain("Golden examples:");
    expect(reference.match(/INPUT:/g)).toHaveLength(25);
    expect(reference.match(/OUTPUT:/g)).toHaveLength(25);
    expect(reference).not.toContain("Preserve all names, dates, years, numbers");
    expect(reference).not.toContain("\"instruction\"");
  });
});
