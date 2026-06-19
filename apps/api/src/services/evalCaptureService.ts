import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { resetLaraeStyleReferenceCache } from "./laraeStyleReferenceBuilder.js";

type LlmTurnLog = {
  timestamp?: string;
  conversationId?: string;
  personaId?: string;
  userMessage?: string;
  provider?: string;
  neutralLlm?: {
    requestMessages?: unknown;
    responseText?: string;
    responseMetadata?: unknown;
  };
  styleTransfer?: {
    request?: unknown;
    responseText?: string;
    responseMetadata?: unknown;
  };
};

export type EvalCaptureInput = {
  conversationId: string;
  idealStyledText: string;
  notes?: string | undefined;
  tags?: string[] | undefined;
};

export type StyleTransferReviewData = {
  evals: Record<string, unknown>[];
  goldenPairs: Record<string, unknown>[];
  syntheticPairs: Record<string, unknown>[];
  heuristicRejections: Record<string, unknown>[];
  paths: {
    evals: string;
    goldenPairs: string;
    syntheticPairs: string;
    heuristicRejections: string;
  };
};

export type ReviewRecordKind = "evals" | "golden" | "pairs" | "rejections";

export type ReviewRecordUpdate = {
  kind: ReviewRecordKind;
  id: string;
  updates: Record<string, unknown>;
};

export type ReviewRecordCreate = {
  kind: ReviewRecordKind;
  record: Record<string, unknown>;
};

export type ReviewRecordDelete = {
  kind: ReviewRecordKind;
  id: string;
};

export type PromoteRejectedPairInput = {
  id: string;
};

const DEFAULT_PAIR_INSTRUCTION =
  "Rewrite the neutral answer in the target persona style. Treat the neutral answer only as source content, not as a style example. Train on the output persona voice only. Preserve all names, dates, years, numbers, locations, durations, formatting, and factual claims exactly. Preserve markdown links, URLs, citation text, quoted text, code, and source metadata exactly when present. Do not invent markdown links, URLs, citations, sources, or source-like metadata when the input does not contain them. Dates, years, numbers, URLs, citations, official names, and quoted text are not style targets. Preserve proper nouns and named entities exactly, including people, places, characters, brands, teams, organizations, titles, books, songs, albums, products, and user-selected options. Do not substitute a different entity or option. Preserve the gender, title, role, and type of every person, group, place, brand, team, and object. Do not call men women, women men, teams people, places people, or objects people unless the input does. Change only tone, rhythm, slang, and attitude. Keep official names clean and use slang as emphasis, not inside names.";

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
    if (parent === current) {
      break;
    }
    current = parent;
  }

  return process.cwd();
}

function getRepoRoot(): string {
  return findRepoRoot(process.cwd());
}

function getTurnLogPath(): string {
  return process.env.LLM_TURN_LOG_PATH ?? resolve(getRepoRoot(), "apps/api/logs/llm-turns.jsonl");
}

function getEvalOutputPath(): string {
  return (
    process.env.STYLE_TRANSFER_EVAL_LOG_PATH ??
    resolve(getRepoRoot(), "ml/style-transfer/datasets/evals/style_transfer_failures.jsonl")
  );
}

function getGoldenPairsPath(): string {
  return resolve(getRepoRoot(), "ml/style-transfer/datasets/curated/golden_style_pairs_seed.jsonl");
}

function getSyntheticPairsPath(): string {
  return resolve(getRepoRoot(), "ml/style-transfer/datasets/processed/style_transfer.pairs.jsonl");
}

function getHeuristicRejectionsPath(): string {
  return resolve(getRepoRoot(), "ml/style-transfer/datasets/processed/heuristic_candidates.rejected.jsonl");
}

function parseJsonl(path: string): LlmTurnLog[] {
  if (!existsSync(path)) {
    return [];
  }

  return readFileSync(path, "utf8")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line) as LlmTurnLog);
}

function parseJsonlRecords(path: string): Record<string, unknown>[] {
  if (!existsSync(path)) {
    return [];
  }

  return readFileSync(path, "utf8")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

function writeJsonlRecords(path: string, records: Record<string, unknown>[]): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${records.map((record) => JSON.stringify(record)).join("\n")}\n`, "utf8");
}

function pathForKind(kind: ReviewRecordKind): string {
  if (kind === "evals") {
    return getEvalOutputPath();
  }
  if (kind === "pairs") {
    return getSyntheticPairsPath();
  }
  if (kind === "rejections") {
    return getHeuristicRejectionsPath();
  }

  return getGoldenPairsPath();
}

function invalidateStyleReferenceIfNeeded(kind: ReviewRecordKind): void {
  if (kind === "pairs" || kind === "golden") {
    resetLaraeStyleReferenceCache();
  }
}

function nextGoldenId(records: Record<string, unknown>[]): string {
  const nextNumber =
    records.reduce((max, record) => {
      const id = typeof record.id === "string" ? record.id : "";
      const match = /^golden-(\d+)$/.exec(id);
      return match ? Math.max(max, Number(match[1])) : max;
    }, 0) + 1;

  return `golden-${String(nextNumber).padStart(4, "0")}`;
}

function createRecordId(kind: ReviewRecordKind, records: Record<string, unknown>[]): string {
  if (kind === "golden") {
    return nextGoldenId(records);
  }
  if (kind === "pairs") {
    return `synthetic-pair-${new Date().toISOString().replace(/[-:.]/g, "").replace("T", "_").slice(0, 16)}_${randomUUID()}`;
  }
  if (kind === "rejections") {
    return `rejected-candidate-${new Date().toISOString().replace(/[-:.]/g, "").replace("T", "_").slice(0, 16)}_${randomUUID()}`;
  }

  return `eval_${new Date().toISOString().replace(/[-:.]/g, "").replace("T", "_").slice(0, 16)}_${randomUUID()}`;
}

function createSyntheticPairId(records: Record<string, unknown>[], sourceId: string): string {
  const normalizedSourceId = sourceId.trim() || "rejected-candidate";
  let id = `manual-${normalizedSourceId}`;
  let suffix = 2;
  const existingIds = new Set(records.map((record) => (typeof record.id === "string" ? record.id : "")));

  while (existingIds.has(id)) {
    id = `manual-${normalizedSourceId}-${suffix}`;
    suffix += 1;
  }

  return id;
}

function findLatestTurn(conversationId: string): LlmTurnLog | undefined {
  const turns = parseJsonl(getTurnLogPath());
  return turns.reverse().find((turn) => turn.conversationId === conversationId);
}

export class EvalCaptureService {
  getReviewData(): StyleTransferReviewData {
    const evalsPath = getEvalOutputPath();
    const goldenPairsPath = getGoldenPairsPath();
    const syntheticPairsPath = getSyntheticPairsPath();
    const heuristicRejectionsPath = getHeuristicRejectionsPath();

    return {
      evals: parseJsonlRecords(evalsPath),
      goldenPairs: parseJsonlRecords(goldenPairsPath),
      syntheticPairs: parseJsonlRecords(syntheticPairsPath),
      heuristicRejections: parseJsonlRecords(heuristicRejectionsPath),
      paths: {
        evals: evalsPath,
        goldenPairs: goldenPairsPath,
        syntheticPairs: syntheticPairsPath,
        heuristicRejections: heuristicRejectionsPath
      }
    };
  }

  updateReviewRecord(input: ReviewRecordUpdate): { id: string; path: string; record: Record<string, unknown> } {
    const path = pathForKind(input.kind);
    const records = parseJsonlRecords(path);
    const index = records.findIndex((record) => record.id === input.id);

    if (index === -1) {
      throw new Error(`No ${input.kind} review record found with id ${input.id}`);
    }

    const existingRecord = records[index];
    if (!existingRecord) {
      throw new Error(`No ${input.kind} review record found with id ${input.id}`);
    }

    const updatedRecord = {
      ...existingRecord,
      ...input.updates,
      id: existingRecord.id
    };
    records[index] = updatedRecord;
    writeJsonlRecords(path, records);
    invalidateStyleReferenceIfNeeded(input.kind);

    return {
      id: input.id,
      path,
      record: updatedRecord
    };
  }

  createReviewRecord(input: ReviewRecordCreate): { id: string; path: string; record: Record<string, unknown> } {
    const path = pathForKind(input.kind);
    const records = parseJsonlRecords(path);
    const id = createRecordId(input.kind, records);
    const record =
      input.kind === "evals"
        ? {
            mode: "style_transfer_eval_failure",
            source: "manual_review_entry",
            capturedAt: new Date().toISOString(),
            user_prompt: "",
            neutral_response: "",
            bad_styled_response: "",
            ideal_styled_response: "",
            notes: "",
            tags: [],
            ...input.record,
            id
          }
        : input.kind === "rejections"
          ? {
              source: "manual_rejection_review_entry",
              source_record_id: "",
              source_file: "",
              reasons: [],
              source_text: "",
              ...input.record,
              id
            }
          : {
            mode: "style_transfer_pair",
            source: input.kind === "pairs" ? "manual_synthetic_pair_edit" : "manual_golden_seed",
            instruction: DEFAULT_PAIR_INSTRUCTION,
            input: "",
            output: "",
            ...input.record,
            id
          };

    records.push(record);
    writeJsonlRecords(path, records);
    invalidateStyleReferenceIfNeeded(input.kind);

    return { id, path, record };
  }

  deleteReviewRecord(input: ReviewRecordDelete): { id: string; path: string } {
    const path = pathForKind(input.kind);
    const records = parseJsonlRecords(path);
    const nextRecords = records.filter((record) => record.id !== input.id);

    if (records.length === nextRecords.length) {
      throw new Error(`No ${input.kind} review record found with id ${input.id}`);
    }

    writeJsonlRecords(path, nextRecords);
    invalidateStyleReferenceIfNeeded(input.kind);
    return { id: input.id, path };
  }

  promoteRejectedToSyntheticPair(input: PromoteRejectedPairInput): {
    id: string;
    path: string;
    record: Record<string, unknown>;
  } {
    const rejections = parseJsonlRecords(getHeuristicRejectionsPath());
    const sourceRecord = rejections.find((record) => record.id === input.id);
    if (!sourceRecord) {
      throw new Error(`No rejected candidate found with id ${input.id}`);
    }

    const syntheticPairsPath = getSyntheticPairsPath();
    const syntheticPairs = parseJsonlRecords(syntheticPairsPath);
    const sourceText = typeof sourceRecord.source_text === "string" ? sourceRecord.source_text.trim() : "";
    if (!sourceText) {
      throw new Error(`Rejected candidate ${input.id} does not have source_text to promote`);
    }

    const record = {
      id: createSyntheticPairId(syntheticPairs, input.id),
      mode: "style_transfer_pair",
      source: "manual_promoted_heuristic_rejection",
      source_file: sourceRecord.source_file,
      source_record_id: sourceRecord.source_record_id,
      rejected_candidate_id: sourceRecord.id,
      original_rejection_reasons: sourceRecord.reasons,
      instruction: DEFAULT_PAIR_INSTRUCTION,
      input: typeof sourceRecord.input === "string" ? sourceRecord.input : "",
      output: sourceText
    };

    syntheticPairs.push(record);
    writeJsonlRecords(syntheticPairsPath, syntheticPairs);
    resetLaraeStyleReferenceCache();

    return {
      id: String(record.id),
      path: syntheticPairsPath,
      record
    };
  }

  save(input: EvalCaptureInput): { id: string; path: string } {
    const turn = findLatestTurn(input.conversationId);
    if (!turn) {
      throw new Error(`No LLM turn log found for conversation ${input.conversationId}`);
    }

    const id = `eval_${new Date().toISOString().replace(/[-:.]/g, "").replace("T", "_").slice(0, 16)}_${randomUUID()}`;
    const outputPath = getEvalOutputPath();
    const record = {
      id,
      mode: "style_transfer_eval_failure",
      source: "ui_test_mode",
      capturedAt: new Date().toISOString(),
      conversationId: input.conversationId,
      personaId: turn.personaId,
      provider: turn.provider,
      user_prompt: turn.userMessage,
      neutral_response: turn.neutralLlm?.responseText,
      bad_styled_response: turn.styleTransfer?.responseText,
      ideal_styled_response: input.idealStyledText,
      notes: input.notes ?? "",
      tags: input.tags ?? [],
      metadata: {
        turnTimestamp: turn.timestamp,
        neutralMetadata: turn.neutralLlm?.responseMetadata,
        styleTransferMetadata: turn.styleTransfer?.responseMetadata,
        styleTransferRequest: turn.styleTransfer?.request
      }
    };

    mkdirSync(dirname(outputPath), { recursive: true });
    appendFileSync(outputPath, `${JSON.stringify(record)}\n`, "utf8");
    return { id, path: outputPath };
  }
}
