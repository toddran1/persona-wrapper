import type { ChangeEvent, FormEvent, KeyboardEvent } from "react";
import type { ProviderId, ToolOptions } from "@persona/shared";
import { useEffect, useId, useRef, useState } from "react";

type ChatComposerProps = {
  provider: ProviderId;
  audioEnabled: boolean;
  loading: boolean;
  disabled?: boolean;
  personaCardHidden?: boolean;
  draftMessage?: string;
  draftAttachments?: File[];
  promptPlaceholder: string;
  suggestedPrompts: string[];
  onResetConversation: () => void;
  onShowPersonaCard?: () => void;
  onProviderChange: (provider: ProviderId) => void;
  onAudioChange: (audio: boolean) => void;
  onCancel: () => void;
  onSubmit: (
    message: string,
    files: File[],
    toolOptions: ToolOptions,
  ) => Promise<void>;
};

function ComposerIcon({ name }: { name: "send" | "stop" | "showPersona" }) {
  if (name === "stop") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <rect x="7" y="7" width="10" height="10" rx="2" />
      </svg>
    );
  }

  if (name === "showPersona") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path d="m6 15 6-6 6 6" />
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
    vectorStoreIds: [],
  });
  const [promptHistory, setPromptHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState<number | undefined>();
  const fileInputId = useId();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const draftBeforeHistoryRef = useRef("");

  useEffect(() => {
    if (props.draftMessage === undefined) return;
    setMessage(props.draftMessage);
    setHistoryIndex(undefined);
    draftBeforeHistoryRef.current = "";
    textareaRef.current?.focus();
  }, [props.draftMessage]);

  useEffect(() => {
    if (props.draftAttachments === undefined) return;
    setAttachments(props.draftAttachments);
    if (!fileInputRef.current) return;

    try {
      const transfer = new DataTransfer();
      for (const file of props.draftAttachments) {
        transfer.items.add(file);
      }
      fileInputRef.current.files = transfer.files;
    } catch {
      // Some test environments do not support assigning a synthetic FileList.
    }
  }, [props.draftAttachments]);

  function handleAttachmentChange(event: ChangeEvent<HTMLInputElement>): void {
    const files = Array.from(event.target.files ?? []);
    setAttachments(files);
  }

  function handleRemoveAttachment(attachmentIndex: number): void {
    setAttachments((currentAttachments) =>
      currentAttachments.filter((_, index) => index !== attachmentIndex),
    );

    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  }

  async function submitCurrentMessage(): Promise<void> {
    if (props.disabled) return;
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

  async function handleSubmit(
    event: FormEvent<HTMLFormElement>,
  ): Promise<void> {
    event.preventDefault();
    await submitCurrentMessage();
  }

  function handlePromptKeyDown(
    event: KeyboardEvent<HTMLTextAreaElement>,
  ): void {
    if (props.disabled) return;
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void submitCurrentMessage();
      return;
    }

    if (event.key !== "ArrowUp" && event.key !== "ArrowDown") {
      return;
    }

    if (
      event.metaKey ||
      event.ctrlKey ||
      event.altKey ||
      event.shiftKey ||
      promptHistory.length === 0
    ) {
      return;
    }

    event.preventDefault();

    if (event.key === "ArrowUp") {
      const nextIndex =
        historyIndex === undefined
          ? promptHistory.length - 1
          : Math.max(0, historyIndex - 1);
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
    <form className={`composer-card${props.disabled ? " composer-card-disabled" : ""}`} onSubmit={handleSubmit} aria-disabled={props.disabled}>
      <div className="composer-header">
        <div className="composer-header-left">
          <div className="eyebrow">Composer</div>
          <div className="composer-panel-row">
            <details className="composer-settings-panel">
              <summary>Settings</summary>
              <div className="composer-settings-body">
                <div className="composer-meta-row">
                  {/* <label>
                    Provider
                    <select
                      // value={props.provider}
                      defaultValue="openai_persona"
                      disabled
                      onChange={(event) =>
                        props.onProviderChange(event.target.value as ProviderId)
                      }
                    >
                      <option value="openai">OpenAI + Style Model</option>
                      <option value="openai_persona">
                        OpenAI Persona Direct
                      </option>
                      <option value="claude">Claude</option>
                      <option value="local">Local</option>
                    </select>
                  </label> */}
                  <label style={{ height: "100%" }}>
                    <div>
                      <span>Audio</span>
                      <div className="audio-toggle">
                        <input
                          type="checkbox"
                          checked={props.audioEnabled}
                          disabled={props.disabled}
                          onChange={(event) =>
                            props.onAudioChange(event.target.checked)
                          }
                        />
                        <span>Generate audio</span>
                      </div>
                    </div>
                  </label>
                  {props.provider === "openai" ||
                  props.provider === "openai_persona" ? (
                    <fieldset className="tool-options">
                      <legend>OpenAI tools</legend>
                      {(
                        [
                          ["webSearch", "Web"],
                          ["fileSearch", "File search"],
                          ["codeInterpreter", "Analysis"],
                          ["imageGeneration", "Images"],
                        ] as const
                      ).map(([key, label]) => (
                        <label key={key} className="toggle">
                          <input
                            type="checkbox"
                            checked={toolOptions[key]}
                            disabled={props.disabled}
                            onChange={(event) =>
                              setToolOptions((current) => ({
                                ...current,
                                [key]: event.target.checked,
                              }))
                            }
                          />
                          <span>{label}</span>
                        </label>
                      ))}
                    </fieldset>
                  ) : null}
                </div>
              </div>
            </details>
            {props.suggestedPrompts.length > 0 ? (
              <details className="suggested-prompts-panel">
                <summary>Suggested prompts</summary>
                <div className="sample-prompt-row">
                  {props.suggestedPrompts.map((prompt) => (
                    <button
                      key={prompt}
                      type="button"
                      className="sample-prompt"
                      disabled={props.loading || props.disabled}
                      onClick={() => setMessage(prompt)}
                    >
                      {prompt}
                    </button>
                  ))}
                </div>
              </details>
            ) : null}
          </div>
        </div>
        {props.personaCardHidden && props.onShowPersonaCard ? (
          <button
            type="button"
            className="provider-pill provider-pill-icon persona-card-restore-toggle"
            onClick={props.onShowPersonaCard}
            aria-label="Show persona card"
            title="Show persona card"
            disabled={props.loading}
          >
            <ComposerIcon name="showPersona" />
          </button>
        ) : null}
      </div>
      <div className="prompt-shell">
        <textarea
          ref={textareaRef}
          rows={2}
          value={message}
          disabled={props.disabled}
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
              <span
                key={`${attachment.name}-${index}`}
                className="attachment-chip"
              >
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
              disabled={props.disabled}
              onChange={handleAttachmentChange}
            />
            <label
              htmlFor={fileInputId}
              className={`icon-button${props.disabled ? " icon-button-disabled" : ""}`}
              aria-label="Upload files"
              aria-disabled={props.disabled}
            >
              +
            </label>
          </div>
          {props.loading ? (
            <button
              type="button"
              className="send-button stop-button"
              onClick={props.onCancel}
              aria-label="Stop response"
              title="Stop"
            >
              <ComposerIcon name="stop" />
            </button>
          ) : (
            <button
              type="submit"
              className="send-button"
              aria-label="Send message"
              title="Send"
              disabled={props.disabled}
            >
              <ComposerIcon name="send" />
            </button>
          )}
        </div>
      </div>
    </form>
  );
}
