import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, appendFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

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

function findLatestTurn(conversationId: string): LlmTurnLog | undefined {
  const turns = parseJsonl(getTurnLogPath());
  return turns.reverse().find((turn) => turn.conversationId === conversationId);
}

export class EvalCaptureService {
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
