import type { ChangeEvent } from "react";
import type { ProviderId } from "@persona/shared";
import { useId, useRef, useState } from "react";

type ChatComposerProps = {
  provider: ProviderId;
  audioEnabled: boolean;
  loading: boolean;
  onResetConversation: () => void;
  onProviderChange: (provider: ProviderId) => void;
  onAudioChange: (audio: boolean) => void;
  onSubmit: (message: string) => Promise<void>;
};

const samplePrompts = [
  "LaRae, introduce yourself like you just walked into the reunion special.",
  "Give me a chart breaking down the chaos level in this launch plan.",
  "Make me a flashy promo image concept and a CSV content plan.",
  "Search the web for current tea and tell me what tool you would call."
];

export function ChatComposer(props: ChatComposerProps) {
  const [message, setMessage] = useState("LaRae, introduce yourself like you just walked into the reunion special.");
  const [attachments, setAttachments] = useState<string[]>([]);
  const fileInputId = useId();
  const fileInputRef = useRef<HTMLInputElement | null>(null);

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

  return (
    <form
      className="composer-card"
      onSubmit={async (event) => {
        event.preventDefault();
        if (!message.trim()) {
          return;
        }

        await props.onSubmit(message);
      }}
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
      </div>
      <div className="prompt-shell">
        <textarea
          rows={4}
          value={message}
          onChange={(event) => setMessage(event.target.value)}
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
