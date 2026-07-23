import type { PersonaDefinition, PersonaPhraseReplacementRule } from "@persona/shared";

export type PersonaPhraseReplacementResult = {
  text: string;
  totalReplacements: number;
  replacementsByRule: Record<string, number>;
};

type PhraseCandidate = {
  normalizedPhrase: string;
  rule: PersonaPhraseReplacementRule;
};

const INLINE_PROTECTED_PATTERN = /(`+[^`\n]*`+|!?\[[^\]\n]*\]\([^\n)]+\)|<https?:\/\/[^>\n]+>|https?:\/\/[^\s<]+|www\.[^\s<]+|“[^”\n]*”|"[^"\n]*")/giu;
const MARKDOWN_TABLE_SEPARATOR_PATTERN = /^\s*\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)+\|?\s*$/;

function escapeRegularExpression(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizePhrase(value: string): string {
  return value.trim().replace(/[ \t]+/g, " ").toLocaleLowerCase("en-US");
}

function phrasePattern(value: string): string {
  return value
    .trim()
    .split(/[ \t]+/)
    .map(escapeRegularExpression)
    .join("[ \\t]+");
}

function preserveReplacementCase(replacement: string, matchedPhrase: string): string {
  const letters = matchedPhrase.match(/\p{L}/gu) ?? [];
  if (letters.length > 0 && letters.every((letter) => letter === letter.toLocaleUpperCase("en-US"))) {
    return replacement.toLocaleUpperCase("en-US");
  }

  const firstLetter = matchedPhrase.search(/\p{L}/u);
  if (firstLetter >= 0) {
    const letter = matchedPhrase[firstLetter] ?? "";
    if (letter === letter.toLocaleUpperCase("en-US")) {
      const replacementLetter = replacement.search(/\p{L}/u);
      if (replacementLetter >= 0) {
        return `${replacement.slice(0, replacementLetter)}${replacement[replacementLetter]?.toLocaleUpperCase("en-US") ?? ""}${replacement.slice(replacementLetter + 1)}`;
      }
    }
  }

  return replacement;
}

function markdownTableLines(lines: string[]): Set<number> {
  const protectedLines = new Set<number>();

  lines.forEach((line, index) => {
    if (!MARKDOWN_TABLE_SEPARATOR_PATTERN.test(line)) return;

    protectedLines.add(index);
    if (index > 0 && lines[index - 1]?.includes("|")) protectedLines.add(index - 1);
    for (let rowIndex = index + 1; rowIndex < lines.length; rowIndex += 1) {
      const row = lines[rowIndex] ?? "";
      if (!row.trim() || !row.includes("|")) break;
      protectedLines.add(rowIndex);
    }
  });

  return protectedLines;
}

function looksLikeStructuredJson(text: string): boolean {
  const trimmed = text.trim();
  if (!(trimmed.startsWith("{") || trimmed.startsWith("["))) return false;
  try {
    const parsed: unknown = JSON.parse(trimmed);
    return typeof parsed === "object" && parsed !== null;
  } catch {
    return false;
  }
}

export function applyPersonaPhraseReplacements(
  text: string,
  persona: Pick<PersonaDefinition, "responseStyle">
): PersonaPhraseReplacementResult {
  const style = persona.responseStyle;
  if (!style?.phraseReplacements.length || !text.trim() || looksLikeStructuredJson(text)) {
    return { text, totalReplacements: 0, replacementsByRule: {} };
  }

  const candidatesByPhrase = new Map<string, PhraseCandidate>();
  for (const rule of style.phraseReplacements) {
    for (const phrase of rule.phrases) {
      const normalizedPhrase = normalizePhrase(phrase);
      if (!normalizedPhrase || candidatesByPhrase.has(normalizedPhrase)) continue;
      candidatesByPhrase.set(normalizedPhrase, { normalizedPhrase, rule });
    }
  }

  const candidates = [...candidatesByPhrase.values()].sort(
    (left, right) => right.normalizedPhrase.length - left.normalizedPhrase.length
  );
  if (candidates.length === 0) {
    return { text, totalReplacements: 0, replacementsByRule: {} };
  }

  const replacementPattern = new RegExp(
    `(?<![\\p{L}\\p{N}_])(${candidates.map((candidate) => phrasePattern(candidate.normalizedPhrase)).join("|")})(?![\\p{L}\\p{N}_]|['’]s\\b)`,
    "giu"
  );
  const lines = text.split("\n");
  const tableLines = markdownTableLines(lines);
  const replacementsByRule: Record<string, number> = {};
  let totalReplacements = 0;
  let activeFence: { character: string; length: number } | undefined;

  const replaceProse = (value: string): string => value
    .split(INLINE_PROTECTED_PATTERN)
    .map((segment, index) => {
      if (index % 2 === 1) return segment;
      return segment.replace(replacementPattern, (matchedPhrase) => {
        if (totalReplacements >= style.maxPhraseReplacements) return matchedPhrase;
        const candidate = candidatesByPhrase.get(normalizePhrase(matchedPhrase));
        if (!candidate) return matchedPhrase;

        const ruleCount = replacementsByRule[candidate.rule.id] ?? 0;
        if (candidate.rule.maxReplacements !== undefined && ruleCount >= candidate.rule.maxReplacements) {
          return matchedPhrase;
        }

        replacementsByRule[candidate.rule.id] = ruleCount + 1;
        totalReplacements += 1;
        return candidate.rule.preserveCase === false
          ? candidate.rule.replaceWith
          : preserveReplacementCase(candidate.rule.replaceWith, matchedPhrase);
      });
    })
    .join("");

  const replacedLines = lines.map((line, index) => {
    const fence = line.match(/^\s{0,3}(`{3,}|~{3,})/);
    if (activeFence) {
      if (fence && fence[1]?.[0] === activeFence.character && fence[1].length >= activeFence.length) {
        activeFence = undefined;
      }
      return line;
    }
    if (fence) {
      activeFence = { character: fence[1]?.[0] ?? "`", length: fence[1]?.length ?? 3 };
      return line;
    }
    if (tableLines.has(index) || /^(?: {4}|\t|\s*>)/.test(line)) return line;
    return replaceProse(line);
  });

  return {
    text: replacedLines.join("\n"),
    totalReplacements,
    replacementsByRule
  };
}
