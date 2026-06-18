import type { ChangeEvent, FormEvent, KeyboardEvent } from "react";
import type { ProviderId, ToolOptions } from "@persona/shared";
import { useId, useRef, useState } from "react";

type ChatComposerProps = {
  provider: ProviderId;
  audioEnabled: boolean;
  loading: boolean;
  promptPlaceholder: string;
  suggestedPrompts: string[];
  onResetConversation: () => void;
  onProviderChange: (provider: ProviderId) => void;
  onAudioChange: (audio: boolean) => void;
  onCancel: () => void;
  onSubmit: (message: string, files: File[], toolOptions: ToolOptions) => Promise<void>;
};

function ComposerIcon({ name }: { name: "send" | "stop" }) {
  if (name === "stop") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <rect x="7" y="7" width="10" height="10" rx="2" />
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M12 19V5" />
      <path d="m6 11 6-6 6 6" />
    </svg>
  );
}

export function ChatComposer(props: ChatComposerProps) {
  const [message, setMessage] = useState("");
  const [attachments, setAttachments] = useState<File[]>([]);
  const [toolOptions, setToolOptions] = useState<ToolOptions>({
    webSearch: false,
    fileSearch: false,
    codeInterpreter: false,
    imageGeneration: false,
    appFunctions: true,
    background: false,
    vectorStoreIds: []
  });
  const [promptHistory, setPromptHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState<number | undefined>();
  const fileInputId = useId();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const draftBeforeHistoryRef = useRef("");

  function handleAttachmentChange(event: ChangeEvent<HTMLInputElement>): void {
    const files = Array.from(event.target.files ?? []);
    setAttachments(files);
  }

  function handleRemoveAttachment(attachmentIndex: number): void {
    setAttachments((currentAttachments) => currentAttachments.filter((_, index) => index !== attachmentIndex));

    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  }

  async function submitCurrentMessage(): Promise<void> {
    const submittedMessage = message;
    const submittedAttachments = attachments;
    if (!submittedMessage.trim()) {
      return;
    }

    setPromptHistory((currentHistory) => [...currentHistory, submittedMessage]);
    setMessage("");
    setAttachments([]);
    if (fileInputRef.current) fileInputRef.current.value = "";
    setHistoryIndex(undefined);
    draftBeforeHistoryRef.current = "";
    await props.onSubmit(submittedMessage, submittedAttachments, toolOptions);
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
      {props.provider === "openai" ? (
        <fieldset className="tool-options">
          <legend>OpenAI tools</legend>
          {([
            ["webSearch", "Web"],
            ["fileSearch", "File search"],
            ["codeInterpreter", "Analysis"],
            ["imageGeneration", "Images"]
          ] as const).map(([key, label]) => (
            <label key={key} className="toggle">
              <input
                type="checkbox"
                checked={toolOptions[key]}
                onChange={(event) => setToolOptions((current) => ({ ...current, [key]: event.target.checked }))}
              />
              <span>{label}</span>
            </label>
          ))}
        </fieldset>
      ) : null}
      <div className="prompt-shell">
        <textarea
          rows={2}
          value={message}
          onChange={(event) => {
            setMessage(event.target.value);
            setHistoryIndex(undefined);
          }}
          onKeyDown={handlePromptKeyDown}
          placeholder={props.promptPlaceholder}
        />
        {attachments.length > 0 ? (
          <div className="attachment-row">
            {attachments.map((attachment, index) => (
              <span key={`${attachment.name}-${index}`} className="attachment-chip">
                <span className="attachment-chip-label">{attachment.name}</span>
                <button
                  type="button"
                  className="attachment-remove-button"
                  aria-label={`Remove ${attachment.name}`}
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
          {props.loading ? (
            <button type="button" className="send-button stop-button" onClick={props.onCancel} aria-label="Stop response" title="Stop">
              <ComposerIcon name="stop" />
            </button>
          ) : (
            <button type="submit" className="send-button" aria-label="Send message" title="Send">
              <ComposerIcon name="send" />
            </button>
          )}
        </div>
      </div>
      {props.suggestedPrompts.length > 0 ? (
        <details className="suggested-prompts-panel">
          <summary>Suggested prompts</summary>
          <div className="sample-prompt-row">
            {props.suggestedPrompts.map((prompt) => (
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
        </details>
      ) : null}
    </form>
  );
}
