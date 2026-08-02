import { describe, expect, it } from "vitest";
import type { PersonaDefinition } from "@persona/shared";
import { applyPersonaPhraseReplacements } from "../services/personaPhraseReplacementService.js";

const persona: Pick<PersonaDefinition, "responseStyle"> = {
  responseStyle: {
    maxPhraseReplacements: 24,
    phraseReplacements: [
      {
        id: "that-baddie",
        replaceWith: "that baddie",
        phrases: ["she", "her"],
        preserveCase: true,
        maxReplacements: 8
      },
      {
        id: "baddie",
        replaceWith: "baddie",
        phrases: ["girl", "woman", "lady", "chica"],
        preserveCase: true,
        maxReplacements: 16
      },
      {
        id: "my-bro",
        replaceWith: "my bro",
        phrases: ["the man", "this gentleman", "my buddy", "man", "guy"],
        preserveCase: true,
        maxReplacements: 16
      },
      {
        id: "baddies",
        replaceWith: "baddies",
        phrases: ["her homegirls", "women", "homegirls"],
        preserveCase: true,
        maxReplacements: 16
      },
      {
        id: "the-bros",
        replaceWith: "the bros",
        phrases: ["those guys", "those fellas", "men"],
        preserveCase: true,
        maxReplacements: 16
      }
    ]
  }
};

describe("applyPersonaPhraseReplacements", () => {
  it("applies configured singular and group slang using longest phrases first", () => {
    const result = applyPersonaPhraseReplacements(
      "That woman met the man and those women introduced her to those guys.",
      persona
    );

    expect(result.text).toBe("That baddie met my bro and those baddies introduced that baddie to the bros.");
    expect(result.totalReplacements).toBe(5);
  });

  it("preserves sentence and all-caps casing", () => {
    const result = applyPersonaPhraseReplacements("Women showed up. WOMEN won.", persona);

    expect(result.text).toBe("Baddies showed up. BADDIES won.");
  });

  it("covers expanded pronouns, regional slang, and reference prefixes", () => {
    const result = applyPersonaPhraseReplacements(
      "She introduced this gentleman, my buddy, those fellas, and her homegirls to a chica.",
      persona
    );

    expect(result.text).toBe("That baddie introduced my bro, my bro, the bros, and baddies to a baddie.");
  });

  it("does not change code, links, URLs, quotes, tables, possessives, or larger words", () => {
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

    const result = applyPersonaPhraseReplacements(input, persona);

    expect(result.text).toContain("A baddie spoke to a human about women's rights.");
    expect(result.text).toContain("`const woman = 'value'`");
    expect(result.text).toContain("[Women](https://example.com/women)");
    expect(result.text).toContain('"Little Women"');
    expect(result.text).toContain("| Women | 4 |");
    expect(result.text).toContain("const girls = ['A'];");
  });

  it("protects hyphenated compounds, unquoted proper names, titles, brands, and named entities", () => {
    const input = [
      "A man and a guy discussed Spider-Man and X-Men.",
      "Wonder Woman, Men in Black, and The Running Man stayed unchanged.",
      "The movie Leading Man opened beside the brand Modern Man.",
      "The character Guy joined Acme Woman Studios.",
      "A single 'woman and man' quotation stays verbatim.",
      "I'm sure a man knows he's talking to a woman."
    ].join("\n");

    const result = applyPersonaPhraseReplacements(input, persona);

    expect(result.text).toContain("A my bro and a my bro discussed Spider-Man and X-Men.");
    expect(result.text).toContain("Wonder Woman, Men in Black, and The Running Man stayed unchanged.");
    expect(result.text).toContain("The movie Leading Man opened beside the brand Modern Man.");
    expect(result.text).toContain("The character Guy joined Acme Woman Studios.");
    expect(result.text).toContain("'woman and man'");
    expect(result.text).toContain("I'm sure a my bro knows he's talking to a baddie.");
  });

  it("leaves structured JSON unchanged", () => {
    const input = '{"woman":"girl","group":"women"}';

    expect(applyPersonaPhraseReplacements(input, persona).text).toBe(input);
  });
});
