import type { ChatResponse } from "@persona/shared";
import { useEffect, useMemo, useState } from "react";

const EVAL_CATEGORIES = [
  "formatting",
  "factual-drift",
  "too-much-profanity",
  "dialect-drift",
  "cutoff",
  "official-name-damage",
  "numbers-dates",
  "structure-loss"
];

export function EvalCapturePanel({
  response,
  saving,
  savedMessage,
  error,
  onSave
}: {
  response: ChatResponse | undefined;
  saving: boolean;
  savedMessage: string | undefined;
  error: string | undefined;
  onSave: (idealStyledText: string, notes: string, tags: string[]) => Promise<void>;
}) {
  const latestAssistantText = useMemo(() => {
    const latestAssistant = [...(response?.history ?? [])].reverse().find((message) => message.role === "assistant");
    return latestAssistant?.content ?? "";
  }, [response]);
  const [idealStyledText, setIdealStyledText] = useState("");
  const [notes, setNotes] = useState("");
  const [selectedTags, setSelectedTags] = useState<string[]>([]);

  useEffect(() => {
    setIdealStyledText(latestAssistantText);
    setNotes("");
    setSelectedTags([]);
  }, [latestAssistantText]);

  function toggleTag(tag: string): void {
    setSelectedTags((current) => (current.includes(tag) ? current.filter((value) => value !== tag) : [...current, tag]));
  }

  return (
    <details className="eval-card collapsible-panel">
      <summary className="collapsible-summary eval-panel-header">
        <div>
          <div className="eyebrow">Test mode</div>
          <h2>Style review</h2>
        </div>
      </summary>
      <div className="eval-body">
        <label>
          Ideal styled response
          <textarea
            value={idealStyledText}
            onChange={(event) => setIdealStyledText(event.target.value)}
            placeholder="Edit this into the response we wish the style model had produced."
          />
        </label>
        <label>
          Notes
          <textarea
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            placeholder="What went wrong? Example: corrupted name, too much profanity, lost formatting."
          />
        </label>
        <fieldset className="eval-category-group">
          <legend>Categories</legend>
          <div className="eval-category-grid">
            {EVAL_CATEGORIES.map((tag) => (
              <label className="category-checkbox" key={tag}>
                <input type="checkbox" checked={selectedTags.includes(tag)} onChange={() => toggleTag(tag)} />
                <span>{tag}</span>
              </label>
            ))}
          </div>
        </fieldset>
        <button
          type="button"
          className="ghost-button eval-save-button"
          disabled={!response?.conversationId || !idealStyledText.trim() || saving}
          onClick={() => void onSave(idealStyledText, notes, selectedTags)}
        >
          {saving ? "Saving..." : "Save eval example"}
        </button>
        {savedMessage ? <p className="eval-status">{savedMessage}</p> : null}
        {error ? <p className="eval-error">{error}</p> : null}
      </div>
    </details>
  );
}
