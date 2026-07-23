import { describe, expect, it } from "vitest";
import { getPersonaById } from "../personas/index.js";
import { applyPersonaPhraseReplacements } from "../services/personaPhraseReplacementService.js";

const persona = getPersonaById("larae");

describe("applyPersonaPhraseReplacements", () => {
  it("applies LaRae's singular and group slang using longest phrases first", () => {
    expect(persona).toBeDefined();

    const result = applyPersonaPhraseReplacements(
      "That woman met the man and those women introduced her to those guys.",
      persona!
    );

    expect(result.text).toBe("That baddie met my bro and those baddies introduced that baddie to the bros.");
    expect(result.totalReplacements).toBe(5);
  });

  it("preserves sentence and all-caps casing", () => {
    expect(persona).toBeDefined();

    const result = applyPersonaPhraseReplacements("Women showed up. WOMEN won.", persona!);

    expect(result.text).toBe("Baddies showed up. BADDIES won.");
  });

  it("covers expanded pronouns, regional slang, and reference prefixes", () => {
    expect(persona).toBeDefined();

    const result = applyPersonaPhraseReplacements(
      "She introduced this gentleman, my buddy, those fellas, and her homegirls to a chica.",
      persona!
    );

    expect(result.text).toBe("That baddie introduced my bro, my bro, the bros, and baddies to a baddie.");
  });

  it("does not change code, links, URLs, quotes, tables, possessives, or larger words", () => {
    expect(persona).toBeDefined();
    const input = [
      "A woman spoke to a human about women's rights.",
      "`const woman = 'value'` and [Women](https://example.com/women) plus https://example.com/girls",
      'The title is "Little Women".',
      "| Group | Count |",
      "| --- | --- |",
      "| Women | 4 |",
      "```ts",
      "const girls = ['A'];",
      "```"
    ].join("\n");

    const result = applyPersonaPhraseReplacements(input, persona!);

    expect(result.text).toContain("A baddie spoke to a human about women's rights.");
    expect(result.text).toContain("`const woman = 'value'`");
    expect(result.text).toContain("[Women](https://example.com/women)");
    expect(result.text).toContain('"Little Women"');
    expect(result.text).toContain("| Women | 4 |");
    expect(result.text).toContain("const girls = ['A'];");
  });

  it("leaves structured JSON unchanged", () => {
    expect(persona).toBeDefined();
    const input = '{"woman":"girl","group":"women"}';

    expect(applyPersonaPhraseReplacements(input, persona!).text).toBe(input);
  });
});
