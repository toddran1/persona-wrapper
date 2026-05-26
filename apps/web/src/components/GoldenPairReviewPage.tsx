import { useEffect, useMemo, useState } from "react";
import { api, type ReviewRecordKind, type StyleTransferReviewData } from "../lib/api.js";
import { JsonBlock } from "./output/JsonBlock.js";

const REVIEW_TAG_OPTIONS = [
  "ui-review",
  "formatting",
  "factual-drift",
  "too-much-profanity",
  "dialect-drift",
  "cutoff",
  "official-name-damage",
  "numbers-dates",
  "structure-loss",
  "semantic-preservation",
  "tool-context",
  "golden-candidate",
  "eval-only"
];
const REVIEW_PAIR_INSTRUCTION =
  "Rewrite the neutral answer in the target persona style. Treat the neutral answer only as source content, not as a style example. Train on the output persona voice only. Preserve all names, dates, years, numbers, locations, durations, formatting, and factual claims exactly. Change only tone, rhythm, slang, and attitude. Keep official names clean and use slang as emphasis, not inside names.";

type EditableReviewCardProps = {
  kind: ReviewRecordKind;
  record: Record<string, unknown>;
  index: number;
  onSave: (kind: ReviewRecordKind, id: string, updates: Record<string, unknown>) => Promise<void>;
  onDelete: (kind: ReviewRecordKind, id: string) => Promise<void>;
};

type AddReviewRecordProps = {
  kind: ReviewRecordKind;
  onAdd: (kind: ReviewRecordKind, record: Record<string, unknown>) => Promise<void>;
};

function getString(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  return typeof value === "string" ? value : "";
}

function getTags(record: Record<string, unknown>): string[] {
  const value = record.tags;
  return Array.isArray(value) ? value.filter((tag): tag is string => typeof tag === "string") : [];
}

function getRecordId(record: Record<string, unknown>, index: number): string {
  return getString(record, "id") || `record-${index + 1}`;
}

function tagsFromText(value: string): string[] {
  return value
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean);
}

function TagEditor({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const tags = tagsFromText(value);

  function setTags(nextTags: string[]): void {
    onChange([...new Set(nextTags)].join(", "));
  }

  function addTag(tag: string): void {
    if (tag) {
      setTags([...tags, tag]);
    }
  }

  function removeTag(tag: string): void {
    setTags(tags.filter((current) => current !== tag));
  }

  return (
    <div className="review-edit-field">
      Tags
      <select value="" onChange={(event) => addTag(event.target.value)}>
        <option value="">Add category...</option>
        {REVIEW_TAG_OPTIONS.filter((tag) => !tags.includes(tag)).map((tag) => (
          <option value={tag} key={tag}>
            {tag}
          </option>
        ))}
      </select>
      <div className="tag-row">
        {tags.map((tag) => (
          <button type="button" className="tag-chip tag-chip-button" key={tag} onClick={() => removeTag(tag)}>
            {tag}
          </button>
        ))}
      </div>
      <input value={value} onChange={(event) => onChange(event.target.value)} />
    </div>
  );
}

function EditableReviewCard({ kind, record, index, onSave, onDelete }: EditableReviewCardProps) {
  const id = getRecordId(record, index);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [draft, setDraft] = useState<Record<string, string>>({});

  function startEditing(): void {
    setError(undefined);
    setDraft(
      kind === "evals"
        ? {
            neutral_response: getString(record, "neutral_response"),
            bad_styled_response: getString(record, "bad_styled_response"),
            ideal_styled_response: getString(record, "ideal_styled_response"),
            notes: getString(record, "notes"),
            tags: getTags(record).join(", ")
          }
        : {
            instruction: getString(record, "instruction"),
            input: getString(record, "input"),
            output: getString(record, "output")
          }
    );
    setEditing(true);
  }

  function updateDraft(key: string, value: string): void {
    setDraft((current) => ({
      ...current,
      [key]: value
    }));
  }

  async function saveDraft(): Promise<void> {
    setSaving(true);
    setError(undefined);

    try {
      const updates =
        kind === "evals"
          ? {
              neutral_response: draft.neutral_response ?? "",
              bad_styled_response: draft.bad_styled_response ?? "",
              ideal_styled_response: draft.ideal_styled_response ?? "",
              notes: draft.notes ?? "",
              tags: tagsFromText(draft.tags ?? "")
            }
          : {
              instruction: draft.instruction ?? "",
              input: draft.input ?? "",
              output: draft.output ?? ""
            };

      await onSave(kind, id, updates);
      setEditing(false);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Failed to save review row");
    } finally {
      setSaving(false);
    }
  }

  async function deleteRecord(): Promise<void> {
    const confirmed = window.confirm(`Delete ${id}? This will remove the row from the local JSONL file.`);
    if (!confirmed) {
      return;
    }

    setSaving(true);
    setError(undefined);

    try {
      await onDelete(kind, id);
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "Failed to delete review row");
      setSaving(false);
    }
  }

  const title = getString(record, "user_prompt") || getString(record, "input") || "Training pair";

  return (
    <article className="review-item">
      <div className="review-item-header">
        <div>
          <span className="eyebrow">{id}</span>
          <h2>{title}</h2>
        </div>
        {kind === "evals" ? (
          <div className="tag-row">
            {getTags(record).map((tag) => (
              <span className="tag-chip" key={tag}>
                {tag}
              </span>
            ))}
          </div>
        ) : null}
      </div>

      {kind === "evals" ? (
        <div className="review-columns">
          <label>
            Neutral
            {editing ? (
              <textarea value={draft.neutral_response ?? ""} onChange={(event) => updateDraft("neutral_response", event.target.value)} />
            ) : (
              <pre>{getString(record, "neutral_response")}</pre>
            )}
          </label>
          <label>
            Bad styled
            {editing ? (
              <textarea
                value={draft.bad_styled_response ?? ""}
                onChange={(event) => updateDraft("bad_styled_response", event.target.value)}
              />
            ) : (
              <pre>{getString(record, "bad_styled_response")}</pre>
            )}
          </label>
          <label>
            Ideal styled
            {editing ? (
              <textarea
                value={draft.ideal_styled_response ?? ""}
                onChange={(event) => updateDraft("ideal_styled_response", event.target.value)}
              />
            ) : (
              <pre>{getString(record, "ideal_styled_response")}</pre>
            )}
          </label>
        </div>
      ) : (
        <div className="review-columns two-column">
          <label>
            Input
            {editing ? <textarea value={draft.input ?? ""} onChange={(event) => updateDraft("input", event.target.value)} /> : <pre>{getString(record, "input")}</pre>}
          </label>
          <label>
            Output
            {editing ? (
              <textarea value={draft.output ?? ""} onChange={(event) => updateDraft("output", event.target.value)} />
            ) : (
              <pre>{getString(record, "output")}</pre>
            )}
          </label>
        </div>
      )}

      {editing && kind === "golden" ? (
        <label className="review-edit-field">
          Instruction
          <textarea value={draft.instruction ?? ""} onChange={(event) => updateDraft("instruction", event.target.value)} />
        </label>
      ) : null}

      {editing && kind === "evals" ? (
        <div className="review-edit-grid">
          <label className="review-edit-field">
            Notes
            <textarea value={draft.notes ?? ""} onChange={(event) => updateDraft("notes", event.target.value)} />
          </label>
          <TagEditor value={draft.tags ?? ""} onChange={(value) => updateDraft("tags", value)} />
        </div>
      ) : getString(record, "notes") ? (
        <p className="review-notes">{getString(record, "notes")}</p>
      ) : null}

      {error ? <p className="eval-error">{error}</p> : null}

      <div className="review-card-actions">
        {editing ? (
          <>
            <button type="button" className="ghost-button" disabled={saving} onClick={() => setEditing(false)}>
              Cancel
            </button>
            <button type="button" className="ghost-button review-save-button" disabled={saving} onClick={() => void saveDraft()}>
              {saving ? "Saving..." : "Save"}
            </button>
          </>
        ) : (
          <>
            <button type="button" className="ghost-button review-delete-button" disabled={saving} onClick={() => void deleteRecord()}>
              Delete
            </button>
            <button type="button" className="ghost-button review-save-button" onClick={startEditing}>
              Edit
            </button>
          </>
        )}
      </div>

      <details>
        <summary>Raw JSON</summary>
        <JsonBlock data={record} />
      </details>
    </article>
  );
}

function AddReviewRecord({ kind, onAdd }: AddReviewRecordProps) {
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | undefined>();

  function updateDraft(key: string, value: string): void {
    setDraft((current) => ({
      ...current,
      [key]: value
    }));
  }

  function resetDraft(): void {
    setDraft({});
  }

  async function addRecord(): Promise<void> {
    setSaving(true);
    setError(undefined);

    try {
      const record =
        kind === "evals"
          ? {
              user_prompt: draft.user_prompt ?? "",
              neutral_response: draft.neutral_response ?? "",
              bad_styled_response: draft.bad_styled_response ?? "",
              ideal_styled_response: draft.ideal_styled_response ?? "",
              notes: draft.notes ?? "",
              tags: tagsFromText(draft.tags ?? "")
            }
          : {
              instruction: draft.instruction || REVIEW_PAIR_INSTRUCTION,
              input: draft.input ?? "",
              output: draft.output ?? ""
            };

      await onAdd(kind, record);
      resetDraft();
    } catch (addError) {
      setError(addError instanceof Error ? addError.message : "Failed to add review row");
    } finally {
      setSaving(false);
    }
  }

  const canSave =
    kind === "evals"
      ? Boolean((draft.neutral_response ?? "").trim() && (draft.ideal_styled_response ?? "").trim())
      : Boolean((draft.input ?? "").trim() && (draft.output ?? "").trim());

  return (
    <section className="review-item review-add-section">
      <div className="review-item-header">
        <div>
          <span className="eyebrow">Add new</span>
          <h2>{kind === "evals" ? "New Eval Row" : "New Golden Pair"}</h2>
        </div>
      </div>

      {kind === "evals" ? (
        <>
          <label className="review-edit-field">
            User prompt
            <input value={draft.user_prompt ?? ""} onChange={(event) => updateDraft("user_prompt", event.target.value)} />
          </label>
          <div className="review-columns">
            <label>
              Neutral
              <textarea value={draft.neutral_response ?? ""} onChange={(event) => updateDraft("neutral_response", event.target.value)} />
            </label>
            <label>
              Bad styled
              <textarea value={draft.bad_styled_response ?? ""} onChange={(event) => updateDraft("bad_styled_response", event.target.value)} />
            </label>
            <label>
              Ideal styled
              <textarea value={draft.ideal_styled_response ?? ""} onChange={(event) => updateDraft("ideal_styled_response", event.target.value)} />
            </label>
          </div>
          <div className="review-edit-grid">
            <label className="review-edit-field">
              Notes
              <textarea value={draft.notes ?? ""} onChange={(event) => updateDraft("notes", event.target.value)} />
            </label>
            <TagEditor value={draft.tags ?? ""} onChange={(value) => updateDraft("tags", value)} />
          </div>
        </>
      ) : (
        <>
          <label className="review-edit-field">
            Instruction
            <textarea value={draft.instruction ?? REVIEW_PAIR_INSTRUCTION} onChange={(event) => updateDraft("instruction", event.target.value)} />
          </label>
          <div className="review-columns two-column">
            <label>
              Input
              <textarea value={draft.input ?? ""} onChange={(event) => updateDraft("input", event.target.value)} />
            </label>
            <label>
              Output
              <textarea value={draft.output ?? ""} onChange={(event) => updateDraft("output", event.target.value)} />
            </label>
          </div>
        </>
      )}

      {error ? <p className="eval-error">{error}</p> : null}

      <div className="review-card-actions">
        <button type="button" className="ghost-button" disabled={saving} onClick={resetDraft}>
          Clear
        </button>
        <button type="button" className="ghost-button review-save-button" disabled={saving || !canSave} onClick={() => void addRecord()}>
          {saving ? "Adding..." : "Add row"}
        </button>
      </div>
    </section>
  );
}

export function GoldenPairReviewPage() {
  const [data, setData] = useState<StyleTransferReviewData | undefined>();
  const [error, setError] = useState<string | undefined>();
  const [activeTab, setActiveTab] = useState<ReviewRecordKind>("evals");

  useEffect(() => {
    void api
      .getStyleTransferReview()
      .then(setData)
      .catch((reviewError) =>
        setError(reviewError instanceof Error ? reviewError.message : "Failed to load review data")
      );
  }, []);

  async function saveRecord(kind: ReviewRecordKind, id: string, updates: Record<string, unknown>): Promise<void> {
    const result = await api.updateStyleTransferReviewRecord({ kind, id, updates });

    setData((current) => {
      if (!current) {
        return current;
      }

      return {
        ...current,
        ...(kind === "evals"
          ? { evals: current.evals.map((record) => (record.id === id ? result.record : record)) }
          : { goldenPairs: current.goldenPairs.map((record) => (record.id === id ? result.record : record)) })
      };
    });
  }

  async function addRecord(kind: ReviewRecordKind, record: Record<string, unknown>): Promise<void> {
    const result = await api.createStyleTransferReviewRecord({ kind, record });

    setData((current) => {
      if (!current) {
        return current;
      }

      return {
        ...current,
        ...(kind === "evals"
          ? { evals: [...current.evals, result.record] }
          : { goldenPairs: [...current.goldenPairs, result.record] })
      };
    });
  }

  async function deleteRecord(kind: ReviewRecordKind, id: string): Promise<void> {
    await api.deleteStyleTransferReviewRecord({ kind, id });

    setData((current) => {
      if (!current) {
        return current;
      }

      return {
        ...current,
        ...(kind === "evals"
          ? { evals: current.evals.filter((record) => record.id !== id) }
          : { goldenPairs: current.goldenPairs.filter((record) => record.id !== id) })
      };
    });
  }

  const records = activeTab === "evals" ? data?.evals ?? [] : data?.goldenPairs ?? [];
  const title = activeTab === "evals" ? "Eval Failures" : "Golden Pairs";
  const sourcePath = activeTab === "evals" ? data?.paths.evals : data?.paths.goldenPairs;
  const tagCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const record of data?.evals ?? []) {
      for (const tag of getTags(record)) {
        counts.set(tag, (counts.get(tag) ?? 0) + 1);
      }
    }
    return [...counts.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [data]);

  return (
    <main className="review-page">
      <header className="review-header">
        <div>
          <div className="eyebrow">Test mode</div>
          <h1>Golden Pair Review</h1>
          <p>Review local eval failures and curated training pairs before the next LoRA run.</p>
        </div>
        <nav className="review-tabs" aria-label="Review views">
          <button type="button" className={activeTab === "evals" ? "active" : ""} onClick={() => setActiveTab("evals")}>
            Evals ({data?.evals.length ?? 0})
          </button>
          <button type="button" className={activeTab === "golden" ? "active" : ""} onClick={() => setActiveTab("golden")}>
            Golden ({data?.goldenPairs.length ?? 0})
          </button>
        </nav>
      </header>

      {error ? <p className="error-banner inline-error">{error}</p> : null}

      <section className="review-summary">
        <div>
          <span className="eyebrow">Current view</span>
          <strong>{title}</strong>
          <p>{sourcePath ?? "Loading..."}</p>
        </div>
        <div>
          <span className="eyebrow">Eval categories</span>
          <p>{tagCounts.length ? tagCounts.map(([tag, count]) => `${tag}: ${count}`).join(" | ") : "No tags yet."}</p>
        </div>
      </section>

      <section className="review-list">
        {records.map((record, index) => (
          <EditableReviewCard
            kind={activeTab}
            record={record}
            index={index}
            key={getString(record, "id") || index}
            onSave={saveRecord}
            onDelete={deleteRecord}
          />
        ))}
        <AddReviewRecord kind={activeTab} onAdd={addRecord} />
      </section>
    </main>
  );
}
