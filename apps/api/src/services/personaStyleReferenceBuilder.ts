import type { PersonaDefinition } from "@persona/shared";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { env } from "../config/env.js";
import { trimTextToTokenBudget } from "../utils/tokenBudget.js";

type StylePairRecord = {
  id?: unknown;
  input?: unknown;
  output?: unknown;
  use_for_openai_reference?: unknown;
};

export type PersonaStyleReferenceOptions = {
  syntheticLimit?: number;
  goldenLimit?: number;
  maxTokens?: number;
};

const MAX_FIELD_CHARS = 2_400;
const MAX_TOTAL_CHARS = 90_000;

function findRepoRoot(startDir: string): string {
  let current = startDir;

  for (let depth = 0; depth < 8; depth += 1) {
    const packageJsonPath = resolve(current, "package.json");
    if (existsSync(packageJsonPath)) {
      try {
        const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8")) as { name?: string };
        if (packageJson.name === "persona-wrapper-app") return current;
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

export type PersonaStyleDatasetPaths = {
  evals: string;
  synthetic: string;
  golden: string;
  heuristicRejections: string;
};

export function getPersonaStyleDatasetPaths(datasetKey: string): PersonaStyleDatasetPaths {
  if (!/^[a-z0-9][a-z0-9_-]*$/.test(datasetKey)) {
    throw new Error(`Invalid persona style dataset key "${datasetKey}".`);
  }

  if (datasetKey === "larae") {
    return {
      evals: repoPath("ml/style-transfer/datasets/evals/style_transfer_failures.jsonl"),
      synthetic: repoPath("ml/style-transfer/datasets/processed/style_transfer.pairs.jsonl"),
      golden: repoPath("ml/style-transfer/datasets/curated/golden_style_pairs_seed.jsonl"),
      heuristicRejections: repoPath("ml/style-transfer/datasets/processed/heuristic_candidates.rejected.jsonl")
    };
  }

  const root = ["ml", "style-transfer", "personas", datasetKey];
  return {
    evals: repoPath(...root, "evals", "style_transfer_failures.jsonl"),
    synthetic: repoPath(...root, "processed", "style_transfer.pairs.jsonl"),
    golden: repoPath(...root, "curated", "golden_style_pairs_seed.jsonl"),
    heuristicRejections: repoPath(...root, "processed", "heuristic_candidates.rejected.jsonl")
  };
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
  if (limit <= 0) return [];
  if (pairs.length <= limit) return [...pairs];

  const shuffled = [...pairs];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex] as T, shuffled[index] as T];
  }
  return shuffled.slice(0, limit);
}

function selectedPairs(path: string, limit: number): Array<{ id: string; input: string; output: string }> {
  const pairs = parseJsonl(path).flatMap((record, index) => {
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
  return samplePairs(markedPairs.length > 0 ? markedPairs : pairs, limit);
}

function truncateField(value: string): string {
  if (value.length <= MAX_FIELD_CHARS) return value;
  return `${value.slice(0, MAX_FIELD_CHARS).trimEnd()}\n[example truncated]`;
}

function formatSection(label: string, pairs: Array<{ id: string; input: string; output: string }>): string {
  if (pairs.length === 0) return "";
  return [
    `${label}:`,
    ...pairs.map((pair, index) => (
      `[${label.toLowerCase()} ${index + 1}: ${pair.id}]\n` +
      `INPUT:\n${truncateField(pair.input)}\n\n` +
      `OUTPUT:\n${truncateField(pair.output)}`
    ))
  ].join("\n\n");
}

export function resetPersonaStyleReferenceCache(_datasetKey?: string): void {
  // References are sampled fresh for every request. This is retained for review-editor invalidation.
}

export function buildPersonaStyleReference(
  persona: PersonaDefinition,
  options: PersonaStyleReferenceOptions = {}
): string {
  const config = persona.styleReference;
  if (!config?.enabled) return "";

  const paths = getPersonaStyleDatasetPaths(config.datasetKey);
  const syntheticLimit = options.syntheticLimit ?? config.syntheticLimit ?? env.OPENAI_STYLE_REFERENCE_SYNTHETIC_LIMIT;
  const goldenLimit = options.goldenLimit ?? config.goldenLimit ?? env.OPENAI_STYLE_REFERENCE_GOLDEN_LIMIT;
  const maxTokens = options.maxTokens ?? config.maxTokens ?? env.OPENAI_STYLE_REFERENCE_MAX_TOKENS;
  const syntheticPairs = selectedPairs(paths.synthetic, syntheticLimit);
  const goldenPairs = selectedPairs(paths.golden, goldenLimit);

  return trimTextToTokenBudget([
    `${persona.shortName ?? persona.name} style reference examples.`,
    `These examples are style references only. Use them to imitate ${persona.shortName ?? persona.name}'s voice, rhythm, vocabulary, pacing, attitude, and formatting. Do not use them as factual knowledge or conversation context.`,
    "Keep the target style present across the whole answer. Preserve useful structure while carrying the persona voice through every paragraph, bullet, numbered item, explanation, and transition.",
    persona.speechStyle.length > 0 ? `Speech style: ${persona.speechStyle.join("; ")}.` : "",
    persona.catchphrases.length > 0 ? `Catchphrases and vocabulary cues: ${persona.catchphrases.join("; ")}. Vary these naturally and do not force the same phrase into every response.` : "",
    formatSection("Synthetic examples", syntheticPairs),
    formatSection("Golden examples", goldenPairs)
  ].filter(Boolean).join("\n\n").slice(0, MAX_TOTAL_CHARS), maxTokens);
}
