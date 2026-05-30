import type { ChangeEvent, FormEvent, KeyboardEvent } from "react";
import type { ProviderId } from "@persona/shared";
import { useId, useRef, useState } from "react";

type ChatComposerProps = {
  provider: ProviderId;
  audioEnabled: boolean;
  loading: boolean;
  locationEnabled: boolean;
  locationError: string | undefined;
  onResetConversation: () => void;
  onProviderChange: (provider: ProviderId) => void;
  onAudioChange: (audio: boolean) => void;
  onRequestLocation: () => void;
  onSubmit: (message: string) => Promise<void>;
};

const samplePrompts = [
  "Hi LaRae, please introduce yourself.",
  "Give me a chart breaking down the chaos level in this launch plan.",
  "Make me a flashy promo image concept and a CSV content plan.",
  "Search the web for current tea and tell me what tool you would call."
];

export function ChatComposer(props: ChatComposerProps) {
  const [message, setMessage] = useState("");
  const [attachments, setAttachments] = useState<string[]>([]);
  const [promptHistory, setPromptHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState<number | undefined>();
  const fileInputId = useId();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const draftBeforeHistoryRef = useRef("");

  function handleAttachmentChange(event: ChangeEvent<HTMLInputElement>): void {
    const files = Array.from(event.target.files ?? []);
    setAttachments(files.map((file) => file.name));
  }

  function handleRemoveAttachment(attachmentIndex: number): void {
    setAttachments((currentAttachments) => currentAttachments.filter((_, index) => index !== attachmentIndex));

    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  }

  async function submitCurrentMessage(): Promise<void> {
    const submittedMessage = message;
    if (!submittedMessage.trim()) {
      return;
    }

    await props.onSubmit(submittedMessage);
    setPromptHistory((currentHistory) => [...currentHistory, submittedMessage]);
    setMessage("");
    setHistoryIndex(undefined);
    draftBeforeHistoryRef.current = "";
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    await submitCurrentMessage();
  }

  function handlePromptKeyDown(event: KeyboardEvent<HTMLTextAreaElement>): void {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void submitCurrentMessage();
      return;
    }

    if (event.key !== "ArrowUp" && event.key !== "ArrowDown") {
      return;
    }

    if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey || promptHistory.length === 0) {
      return;
    }

    event.preventDefault();

    if (event.key === "ArrowUp") {
      const nextIndex = historyIndex === undefined ? promptHistory.length - 1 : Math.max(0, historyIndex - 1);
      if (historyIndex === undefined) {
        draftBeforeHistoryRef.current = message;
      }
      setHistoryIndex(nextIndex);
      setMessage(promptHistory[nextIndex] ?? message);
      return;
    }

    if (historyIndex === undefined) {
      return;
    }

    const nextIndex = historyIndex + 1;
    if (nextIndex >= promptHistory.length) {
      setHistoryIndex(undefined);
      setMessage(draftBeforeHistoryRef.current);
      draftBeforeHistoryRef.current = "";
      return;
    }

    setHistoryIndex(nextIndex);
    setMessage(promptHistory[nextIndex] ?? message);
  }

  return (
    <form
      className="composer-card"
      onSubmit={handleSubmit}
    >
      <div className="composer-header">
        <div>
          <div className="eyebrow">Composer</div>
          <h2>Message LaRae</h2>
        </div>
        <button type="button" className="ghost-button" onClick={props.onResetConversation} disabled={props.loading}>
          New conversation
        </button>
      </div>
      <div className="composer-meta-row">
        <label>
          Provider
          <select value={props.provider} onChange={(event) => props.onProviderChange(event.target.value as ProviderId)}>
            <option value="openai">OpenAI</option>
            <option value="claude">Claude</option>
            <option value="local">Local</option>
          </select>
        </label>
        <label className="toggle">
          <input
            type="checkbox"
            checked={props.audioEnabled}
            onChange={(event) => props.onAudioChange(event.target.checked)}
          />
          <span>Generate audio</span>
        </label>
        <button type="button" className="ghost-button context-button" onClick={props.onRequestLocation}>
          {props.locationEnabled ? "Location on" : "Share location"}
        </button>
      </div>
      {props.locationError ? <p className="composer-context-error">{props.locationError}</p> : null}
      <div className="prompt-shell">
        <textarea
          rows={4}
          value={message}
          onChange={(event) => {
            setMessage(event.target.value);
            setHistoryIndex(undefined);
          }}
          onKeyDown={handlePromptKeyDown}
          placeholder="Ask anything"
        />
        {attachments.length > 0 ? (
          <div className="attachment-row">
            {attachments.map((attachment, index) => (
              <span key={`${attachment}-${index}`} className="attachment-chip">
                <span className="attachment-chip-label">{attachment}</span>
                <button
                  type="button"
                  className="attachment-remove-button"
                  aria-label={`Remove ${attachment}`}
                  onClick={() => handleRemoveAttachment(index)}
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        ) : null}
        <div className="prompt-toolbar">
          <div className="prompt-toolbar-left">
            <input
              id={fileInputId}
              ref={fileInputRef}
              className="hidden-file-input"
              type="file"
              multiple
              onChange={handleAttachmentChange}
            />
            <label htmlFor={fileInputId} className="icon-button" aria-label="Upload files">
              +
            </label>
          </div>
          <button type="submit" className="send-button" disabled={props.loading} aria-label="Send message">
            {props.loading ? "…" : "Send"}
          </button>
        </div>
      </div>
      <div className="sample-prompt-row">
        {samplePrompts.map((prompt) => (
          <button
            key={prompt}
            type="button"
            className="sample-prompt"
            disabled={props.loading}
            onClick={() => setMessage(prompt)}
          >
            {prompt}
          </button>
        ))}
      </div>
    </form>
  );
}
