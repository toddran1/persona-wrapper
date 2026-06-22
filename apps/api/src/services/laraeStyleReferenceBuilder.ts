import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

type StylePairRecord = {
  id?: unknown;
  input?: unknown;
  output?: unknown;
  use_for_openai_reference?: unknown;
};

export type LaraeStyleReferenceOptions = {
  syntheticLimit?: number;
  goldenLimit?: number;
};

const DEFAULT_SYNTHETIC_LIMIT = 20;
const DEFAULT_GOLDEN_LIMIT = 5;
const MAX_FIELD_CHARS = 2_400;
const MAX_TOTAL_CHARS = 90_000;
const STYLE_INTENSITY_PATTERNS = [
  /\bfuck(?:ing|ed|er|ers)?\b/gi,
  /\bbitch(?:es)?\b/gi,
  /\bnigg(?:a|ah|as|az)\b/gi,
  /\bhoe(?:s)?\b/gi,
  /\bpussy\b/gi,
  /\bass(?:-|\b)/gi,
  /\bdamn\b/gi,
  /\bshit(?:s|ty|ting)?\b/gi,
  /\bmotherfuck(?:er|ers|ing|in)?\b/gi,
  /\bbaby girl\b/gi,
  /\bclock it\b/gi,
  /\bbaddie(?:s)?\b/gi,
  /\bratchet\b/gi,
  /\bmessy\b/gi,
  /\btea\b/gi
];

function findRepoRoot(startDir: string): string {
  let current = startDir;

  for (let depth = 0; depth < 8; depth += 1) {
    const packageJsonPath = resolve(current, "package.json");
    if (existsSync(packageJsonPath)) {
      try {
        const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8")) as { name?: string };
        if (packageJson.name === "persona-wrapper-app") {
          return current;
        }
      } catch {
        // Keep walking if this is not the repo root package.json.
      }
    }

    const parent = resolve(current, "..");
    if (parent === current) break;
    current = parent;
  }

  return process.cwd();
}

function repoPath(...parts: string[]): string {
  return resolve(findRepoRoot(process.cwd()), ...parts);
}

function syntheticPairsPath(): string {
  return repoPath("ml/style-transfer/datasets/processed/style_transfer.pairs.jsonl");
}

function goldenPairsPath(): string {
  return repoPath("ml/style-transfer/datasets/curated/golden_style_pairs_seed.jsonl");
}

function parseJsonl(path: string): StylePairRecord[] {
  if (!existsSync(path)) return [];

  return readFileSync(path, "utf8")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .flatMap((line) => {
      try {
        return [JSON.parse(line) as StylePairRecord];
      } catch {
        return [];
      }
    });
}

function samplePairs<T>(pairs: T[], limit: number): T[] {
  if (pairs.length <= limit) return [...pairs];

  const shuffled = [...pairs];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex] as T, shuffled[index] as T];
  }

  return shuffled.slice(0, limit);
}

function styleIntensityScore(output: string): number {
  return STYLE_INTENSITY_PATTERNS.reduce((score, pattern) => {
    const matches = output.match(pattern);
    return score + (matches?.length ?? 0);
  }, 0);
}

function sampleStyleDensePairs<T extends { output: string }>(pairs: T[], limit: number): T[] {
  if (pairs.length <= limit) return samplePairs(pairs, limit);

  const sorted = [...pairs].sort((left, right) => styleIntensityScore(right.output) - styleIntensityScore(left.output));
  const highStylePoolSize = Math.max(limit * 2, Math.ceil(sorted.length * 0.45));
  const highStylePool = sorted.slice(0, highStylePoolSize);
  const selected = samplePairs(highStylePool, Math.min(limit, highStylePool.length));

  if (selected.length >= limit) return selected;

  const selectedIds = new Set(selected.map((pair) => pair.output));
  return [
    ...selected,
    ...samplePairs(sorted.filter((pair) => !selectedIds.has(pair.output)), limit - selected.length)
  ];
}

function selectedPairs(path: string, limit: number): Array<{ id: string; input: string; output: string }> {
  const pairs = parseJsonl(path)
    .flatMap((record, index) => {
      if (typeof record.input !== "string" || typeof record.output !== "string") return [];
      const input = record.input.trim();
      const output = record.output.trim();
      if (!input || !output) return [];
      return [{
        id: typeof record.id === "string" && record.id.trim() ? record.id.trim() : `row-${index + 1}`,
        input,
        output,
        useForOpenAIReference: record.use_for_openai_reference === true
      }];
    });

  const markedPairs = pairs.filter((pair) => pair.useForOpenAIReference);
  return sampleStyleDensePairs(markedPairs.length > 0 ? markedPairs : pairs, limit);
}

function truncateField(value: string): string {
  if (value.length <= MAX_FIELD_CHARS) return value;
  return `${value.slice(0, MAX_FIELD_CHARS).trimEnd()}\n[example truncated]`;
}

function formatSection(label: string, pairs: Array<{ id: string; input: string; output: string }>): string {
  return [
    `${label}:`,
    ...pairs.map((pair, index) => (
      `[${label.toLowerCase()} ${index + 1}: ${pair.id}]\n` +
      `INPUT:\n${truncateField(pair.input)}\n\n` +
      `OUTPUT:\n${truncateField(pair.output)}`
    ))
  ].join("\n\n");
}

export function resetLaraeStyleReferenceCache(): void {
  // Kept for callers that invalidate review edits. The builder samples fresh references per request.
}

export function buildLaraeStyleReference(options: LaraeStyleReferenceOptions = {}): string {
  const syntheticLimit = options.syntheticLimit ?? DEFAULT_SYNTHETIC_LIMIT;
  const goldenLimit = options.goldenLimit ?? DEFAULT_GOLDEN_LIMIT;
  const syntheticPairs = selectedPairs(syntheticPairsPath(), syntheticLimit);
  const goldenPairs = selectedPairs(goldenPairsPath(), goldenLimit);

  const reference = [
    "LaRae style reference examples.",
    "These examples are style references only. Use them to imitate LaRae's voice, rhythm, slang, profanity level, pacing, and attitude. Do not use these examples as factual knowledge or conversation context.",
    "The target is high style density across the whole answer. Do not copy only the opening or closing energy. Carry the same slang-heavy, profanity-heavy, reality-TV voice through every paragraph, bullet, numbered item, explanation, and transition.",
    "The target profanity/slang level is intentionally extremely high. Match examples that use heavy HEAVY slang and words like Bitch, Nigga, Bitches, Niggas, Fucking, Fuck, Hoe, Hoes, Baddies, fuck, fucking, bitch, nigga, bitches, niggas, hoe, hoes, baddies, pussy, shit, damn, ass, and motherfucker.",
    "Use those words more often than a polite assistant would think is appropriate. It should almost feel like it cannot be enough, while still keeping the answer understandable and useful.",
    "The voice should feel ratchet, messy, loud, vulgar, sexy, comedic, and nightlife-coded while still being useful.",
    "For longer answers, use these examples to keep the middle of the response just as characterful as the beginning. Preserve useful structure while making the language sound like LaRae throughout.",
    formatSection("Synthetic examples", syntheticPairs),
    formatSection("Golden examples", goldenPairs)
  ]
    .filter(Boolean)
    .join("\n\n")
    .slice(0, MAX_TOTAL_CHARS);

  return reference;
}
