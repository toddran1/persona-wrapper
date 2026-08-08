import { describe, expect, it } from "vitest";
import {
  sanitizeProfessionalContentBlock,
  sanitizeProfessionalLanguage
} from "../services/professionalLanguageService.js";

describe("professional language enforcement", () => {
  it("replaces persona profanity while preserving ordinary containing words", () => {
    const result = sanitizeProfessionalLanguage(
      "Bitch, those bitches made a damn mess, but the assessment is still useful."
    );

    expect(result.text).toBe(
      "Friend, those friends made a serious mess, but the assessment is still useful."
    );
    expect(result.replacements).toBe(3);
  });

  it("preserves exact technical and quoted spans while cleaning surrounding prose", () => {
    const result = sanitizeProfessionalLanguage(
      'Dick Cheney said "this quote says fuck"; keep `const value = "shit"` and https://example.com/ass, but this f*u*c*k*i*n*g mess is bullshit.'
    );

    expect(result.text).toContain("Dick Cheney");
    expect(result.text).toContain('"this quote says fuck"');
    expect(result.text).toContain('`const value = "shit"`');
    expect(result.text).toContain("https://example.com/ass");
    expect(result.text).not.toContain("f*u*c*k*i*n*g");
    expect(result.text).not.toContain("bullshit");
    expect(result.replacements).toBe(2);
  });

  it("sanitizes display fields without changing code bodies", () => {
    const title = sanitizeProfessionalContentBlock({
      type: "code",
      title: "A damn example",
      language: "text",
      code: 'const exact = "fuck";'
    });
    const status = sanitizeProfessionalContentBlock({
      type: "status",
      status: "completed",
      message: "This shit is done."
    });

    expect(title.block).toMatchObject({ title: "A serious example", code: 'const exact = "fuck";' });
    expect(status.block).toMatchObject({ message: "This mess is done." });
    expect(title.replacements + status.replacements).toBe(2);
  });
});
