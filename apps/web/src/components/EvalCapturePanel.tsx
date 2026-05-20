import type { ChatResponse } from "@persona/shared";
import { useEffect, useMemo, useState } from "react";

export function EvalCapturePanel({
  enabled,
  response,
  saving,
  savedMessage,
  error,
  onEnabledChange,
  onSave
}: {
  enabled: boolean;
  response: ChatResponse | undefined;
  saving: boolean;
  savedMessage: string | undefined;
  error: string | undefined;
  onEnabledChange: (enabled: boolean) => void;
  onSave: (idealStyledText: string, notes: string) => Promise<void>;
}) {
  const latestAssistantText = useMemo(() => {
    const latestAssistant = [...(response?.history ?? [])].reverse().find((message) => message.role === "assistant");
    return latestAssistant?.content ?? "";
  }, [response]);
  const [idealStyledText, setIdealStyledText] = useState("");
  const [notes, setNotes] = useState("");

  useEffect(() => {
    setIdealStyledText(latestAssistantText);
    setNotes("");
  }, [latestAssistantText]);

  return (
    <section className="eval-card">
      <div className="panel-header eval-panel-header">
        <div>
          <div className="eyebrow">Test mode</div>
          <h2>Style review</h2>
        </div>
        <label className="switch-label">
          <input type="checkbox" checked={enabled} onChange={(event) => onEnabledChange(event.target.checked)} />
          <span>Save evals</span>
        </label>
      </div>
      {enabled ? (
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
          <button
            type="button"
            className="ghost-button eval-save-button"
            disabled={!response?.conversationId || !idealStyledText.trim() || saving}
            onClick={() => void onSave(idealStyledText, notes)}
          >
            {saving ? "Saving..." : "Save eval example"}
          </button>
          {savedMessage ? <p className="eval-status">{savedMessage}</p> : null}
          {error ? <p className="eval-error">{error}</p> : null}
        </div>
      ) : (
        <p className="empty-state">Turn this on when a response is close but needs a corrected ideal version for retraining.</p>
      )}
    </section>
  );
}
