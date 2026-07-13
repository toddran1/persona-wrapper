import type { MouseEvent as ReactMouseEvent } from "react";
import type { ChatResponse, ContentBlock, UploadedAsset } from "@persona/shared";
import { useEffect, useId, useRef, useState } from "react";
import { MarkdownText } from "./MarkdownText.js";
import { OutputRenderer } from "./OutputRenderer.js";
import { api, resolveApiUrl } from "../lib/api.js";
import { downloadProtectedMedia, useProtectedMediaUrl } from "../hooks/useProtectedMediaUrl.js";
import { safeExternalUrl } from "../lib/security.js";

export type UserPromptAsset = {
  id: string;
  kind: UploadedAsset["kind"];
  fileName: string;
  mimeType: string;
  url?: string;
};

export type RenderedTurn = {
  userMessage: string;
  userAssets?: UserPromptAsset[];
  userFiles?: File[];
  assistantText: string;
  outputs: ContentBlock[];
  usage?: ChatResponse["usage"];
  backgroundJobId?: string;
};

function resolveAssetUrl(url: string): string {
  return resolveApiUrl(url);
}

function UserPromptAssetPreview({ asset }: { asset: UserPromptAsset }) {
  const directUrl = asset.url ? resolveAssetUrl(asset.url) : undefined;
  const [previewUrl, setPreviewUrl] = useState<string | undefined>(() => {
    if (!directUrl) return undefined;
    return asset.url?.startsWith("/") ? undefined : directUrl;
  });
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setFailed(false);
    if (!asset.url) {
      setPreviewUrl(undefined);
      return undefined;
    }

    if (!asset.url.startsWith("/")) {
      setPreviewUrl(resolveAssetUrl(asset.url));
      return undefined;
    }

    const controller = new AbortController();
    let objectUrl: string | undefined;

    void api.fetchUploadBlob(asset.url, controller.signal)
      .then((blob) => {
        objectUrl = URL.createObjectURL(blob);
        setPreviewUrl(objectUrl);
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setPreviewUrl(undefined);
          setFailed(true);
        }
      });

    return () => {
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [asset.url]);

  if (!previewUrl || failed) {
    return (
      <span className="user-prompt-asset-icon" aria-hidden="true">
        <Icon name={asset.kind === "image" ? "image" : "file"} />
      </span>
    );
  }

  return (
    <img
      src={previewUrl}
      alt={asset.fileName}
      className="user-prompt-asset-preview"
      onError={() => {
        setPreviewUrl(undefined);
        setFailed(true);
      }}
    />
  );
}

function audioFileExtension(mimeType: string): string {
  if (mimeType.includes("wav")) return "wav";
  if (mimeType.includes("ogg")) return "ogg";
  if (mimeType.includes("mpeg") || mimeType.includes("mp3")) return "mp3";
  return "audio";
}

function playAudioElement(audio: HTMLAudioElement): void {
  try {
    const playback = audio.play();
    if (playback && typeof playback.catch === "function") {
      void playback.catch(() => {
        // Browsers can block autoplay after async work; manual replay stays available.
      });
    }
  } catch {
    // Unsupported playback should never break message rendering.
  }
}

function Icon({ name }: { name: "audio" | "copy" | "check" | "download" | "more" | "sources" | "retry" | "edit" | "file" | "image" }) {
  if (name === "audio") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M11 5 6 9H3v6h3l5 4V5Z" />
        <path d="M15.5 8.5a5 5 0 0 1 0 7" />
        <path d="M18.5 5.5a9 9 0 0 1 0 13" />
      </svg>
    );
  }

  if (name === "copy") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <rect x="9" y="9" width="13" height="13" rx="2" />
        <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
      </svg>
    );
  }

  if (name === "check") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="m5 13 4 4L19 7" />
      </svg>
    );
  }

  if (name === "download") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M12 3v12" />
        <path d="m7 10 5 5 5-5" />
        <path d="M5 21h14" />
      </svg>
    );
  }

  if (name === "sources") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M4 19.5V5a2 2 0 0 1 2-2h12" />
        <path d="M6 22h12a2 2 0 0 0 2-2V6" />
        <path d="M8 7h8" />
        <path d="M8 11h8" />
        <path d="M8 15h5" />
      </svg>
    );
  }

  if (name === "retry") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M21 12a9 9 0 1 1-2.64-6.36" />
        <path d="M21 3v6h-6" />
      </svg>
    );
  }

  if (name === "edit") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="m12 20 8-8" />
        <path d="M16 4a2.83 2.83 0 1 1 4 4L8 20l-5 1 1-5Z" />
      </svg>
    );
  }

  if (name === "file") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M14 2H7a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7Z" />
        <path d="M14 2v5h5" />
      </svg>
    );
  }

  if (name === "image") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <rect x="3" y="3" width="18" height="18" rx="2" />
        <circle cx="9" cy="9" r="1.5" />
        <path d="m21 15-5-5L5 21" />
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 12h.01" />
      <path d="M19 12h.01" />
      <path d="M5 12h.01" />
    </svg>
  );
}

function UserPromptAssets({ assets }: { assets: UserPromptAsset[] }) {
  if (assets.length === 0) return null;

  return (
    <div className="user-prompt-assets" aria-label="Attached assets">
      {assets.map((asset) => {
        const isImage = asset.kind === "image" && asset.url;
        return (
          <div key={asset.id} className={`user-prompt-asset${isImage ? " user-prompt-asset-image" : ""}`}>
            {isImage ? (
              <UserPromptAssetPreview asset={asset} />
            ) : (
              <span className="user-prompt-asset-icon" aria-hidden="true">
                <Icon name={asset.kind === "image" ? "image" : "file"} />
              </span>
            )}
            <span className="user-prompt-asset-label">{asset.fileName}</span>
          </div>
        );
      })}
    </div>
  );
}

function UserMessageActions({
  message,
  files = [],
  onEdit
}: {
  message: string;
  files?: File[] | undefined;
  onEdit?: ((message: string, files: File[]) => void) | undefined;
}) {
  const [copied, setCopied] = useState(false);
  const copiedTimeoutRef = useRef<number | undefined>(undefined);

  useEffect(() => {
    return () => {
      if (copiedTimeoutRef.current !== undefined) {
        window.clearTimeout(copiedTimeoutRef.current);
      }
    };
  }, []);

  async function handleCopy(event: ReactMouseEvent<HTMLButtonElement>): Promise<void> {
    const button = event.currentTarget;
    if (!navigator.clipboard?.writeText) return;
    await navigator.clipboard.writeText(message);
    setCopied(true);
    if (copiedTimeoutRef.current !== undefined) {
      window.clearTimeout(copiedTimeoutRef.current);
    }
    copiedTimeoutRef.current = window.setTimeout(() => {
      setCopied(false);
      copiedTimeoutRef.current = undefined;
    }, 1200);
    button.blur();
  }

  return (
    <div className="user-message-actions" aria-hidden={false}>
      <button
        type="button"
        className="message-action-button"
        aria-label={copied ? "Copied prompt" : "Copy prompt"}
        title={copied ? "Copied" : "Copy"}
        onClick={(event) => void handleCopy(event)}
      >
        <Icon name={copied ? "check" : "copy"} />
      </button>
      {onEdit ? (
        <button
          type="button"
          className="message-action-button"
          aria-label="Edit prompt"
          title="Edit"
          onClick={(event) => {
            onEdit(message, files);
            event.currentTarget.blur();
          }}
        >
          <Icon name="edit" />
        </button>
      ) : null}
    </div>
  );
}

function AssistantActions({
  text,
  sources,
  audioBlocks,
  personaId,
  autoPlayAudio = false,
  onAudioPlaybackChange,
  onRetry
}: {
  text: string;
  sources: Extract<ContentBlock, { type: "source_list" }>[];
  audioBlocks: Extract<ContentBlock, { type: "audio" }>[];
  personaId: string;
  autoPlayAudio?: boolean;
  onAudioPlaybackChange?: ((playing: boolean) => void) | undefined;
  onRetry?: (() => void) | undefined;
}) {
  const [sourcesOpen, setSourcesOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [audioOpen, setAudioOpen] = useState(false);
  const sourcesId = useId();
  const menuId = useId();
  const audioId = useId();
  const wrapRef = useRef<HTMLDivElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const autoPlayedUrlRef = useRef<string | undefined>(undefined);
  const flatSources = sources
    .flatMap((sourceList) => sourceList.sources)
    .filter((source) => safeExternalUrl(source.url) !== undefined);
  const primaryAudio = audioBlocks[0];
  const resolvedAudioUrl = useProtectedMediaUrl(primaryAudio?.url ?? "");

  useEffect(() => {
    if (!sourcesOpen && !menuOpen && !audioOpen) return;
    const handlePointerDown = (event: PointerEvent) => {
      if (!wrapRef.current?.contains(event.target as Node)) {
        setSourcesOpen(false);
        setMenuOpen(false);
        setAudioOpen(false);
      }
    };
    window.addEventListener("pointerdown", handlePointerDown);

    return () => window.removeEventListener("pointerdown", handlePointerDown);
  }, [sourcesOpen, menuOpen, audioOpen]);

  useEffect(() => {
    if (!autoPlayAudio || !resolvedAudioUrl || autoPlayedUrlRef.current === resolvedAudioUrl) return;
    autoPlayedUrlRef.current = resolvedAudioUrl;
    if (!audioRef.current) return;
    audioRef.current.currentTime = 0;
    playAudioElement(audioRef.current);
  }, [autoPlayAudio, resolvedAudioUrl]);

  if (!text && flatSources.length === 0 && !primaryAudio) return null;

  const playAudio = () => {
    if (!audioRef.current) return;
    audioRef.current.currentTime = 0;
    playAudioElement(audioRef.current);
  };

  const downloadAudio = () => {
    if (!primaryAudio) return;
    setAudioOpen(false);
    void downloadProtectedMedia(primaryAudio.url, `${personaId}-response.${audioFileExtension(primaryAudio.mimeType)}`);
  };

  return (
    <div className="message-actions" ref={wrapRef}>
      {primaryAudio ? (
        <audio
          ref={audioRef}
          src={resolvedAudioUrl}
          preload="metadata"
          onPlay={() => onAudioPlaybackChange?.(true)}
          onPause={() => onAudioPlaybackChange?.(false)}
          onEnded={() => onAudioPlaybackChange?.(false)}
          onError={() => onAudioPlaybackChange?.(false)}
        />
      ) : null}
      {text ? (
        <button type="button" className="message-action-button" aria-label="Copy response" title="Copy" onClick={() => void navigator.clipboard?.writeText(text)}>
          <Icon name="copy" />
        </button>
      ) : null}
      {primaryAudio ? (
        <div className="message-action-wrap">
          <button
            type="button"
            className="message-action-button"
            aria-label="Audio settings"
            aria-haspopup="menu"
            aria-expanded={audioOpen}
            aria-controls={audioId}
            title="Audio"
            onClick={() => {
              setAudioOpen((current) => !current);
              setMenuOpen(false);
              setSourcesOpen(false);
            }}
          >
            <Icon name="audio" />
          </button>
          {audioOpen ? (
            <div id={audioId} className="message-action-menu" role="menu">
              <button type="button" role="menuitem" onClick={playAudio}>
                <Icon name="audio" />
                <span>Replay audio</span>
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={downloadAudio}
              >
                <Icon name="download" />
                <span>Download audio</span>
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
      <div className="message-action-wrap">
        <button
          type="button"
          className="message-action-button"
          aria-label="More response actions"
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          aria-controls={menuId}
          title="More"
          onClick={() => {
            setMenuOpen((current) => !current);
            setAudioOpen(false);
            setSourcesOpen(false);
          }}
        >
          <Icon name="more" />
        </button>
        {menuOpen ? (
          <div id={menuId} className="message-action-menu" role="menu">
            {flatSources.length > 0 ? (
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setMenuOpen(false);
                  setSourcesOpen(true);
                }}
              >
                <Icon name="sources" />
                <span>References</span>
              </button>
            ) : null}
            {onRetry ? (
              <button type="button" role="menuitem" onClick={() => {
                setMenuOpen(false);
                onRetry();
              }}>
                <Icon name="retry" />
                <span>Retry</span>
              </button>
            ) : null}
          </div>
        ) : null}
        {sourcesOpen ? (
          <div id={sourcesId} className="message-sources-popover" role="dialog" aria-label="References">
            <div className="message-sources-title">References</div>
            {flatSources.map((source, index) => {
              const safeUrl = safeExternalUrl(source.url);
              const content = (
                <>
                  <span>{source.title}</span>
                  {source.snippet ? <small>{source.snippet}</small> : null}
                </>
              );
              if (!safeUrl) return null;
              return (
                <a key={`${source.url}-${index}`} href={safeUrl} target="_blank" rel="noopener noreferrer" className="message-source-item">
                  {content}
                  <small className="message-source-url">{safeUrl}</small>
                </a>
              );
            })}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function shouldRenderInlineOutput(output: ContentBlock): boolean {
  if (
    output.type === "text" ||
    output.type === "json" ||
    output.type === "source_list" ||
    output.type === "audio" ||
    output.type === "tool_call" ||
    output.type === "tool_result"
  ) return false;
  return true;
}

function TokenUsageFooter({ usage }: { usage: ChatResponse["usage"] }) {
  if (!usage) return null;

  return (
    <div className="token-usage-footer" aria-label="Token usage">
      <span>Input tokens: {usage.inputTokens.toLocaleString()}</span>
      <span>Output tokens: {usage.outputTokens.toLocaleString()}</span>
      <span>Total tokens: {(usage.totalTokens ?? usage.inputTokens + usage.outputTokens).toLocaleString()}</span>
    </div>
  );
}

export function ConversationHistory({
  personaId = "persona",
  personaShortName = "Persona",
  turns,
  pendingPrompt,
  pendingAssets = [],
  pendingFiles = [],
  thinking,
  testMode = false,
  autoPlayAudioTurnIndex,
  onAudioPlaybackChange,
  onOutputAction,
  onEditUserPrompt,
  onRetryAssistantTurn,
  hasEarlierTurns = false,
  loadingEarlierTurns = false,
  onLoadEarlierTurns
}: {
  personaId?: string;
  personaShortName?: string;
  turns: RenderedTurn[];
  pendingPrompt?: string | undefined;
  pendingAssets?: UserPromptAsset[] | undefined;
  pendingFiles?: File[] | undefined;
  thinking?: boolean | undefined;
  testMode?: boolean | undefined;
  autoPlayAudioTurnIndex?: number | undefined;
  onAudioPlaybackChange?: ((playing: boolean) => void) | undefined;
  onOutputAction?: ((action: Extract<ContentBlock, { type: "action" }>) => void | Promise<void>) | undefined;
  onEditUserPrompt?: ((message: string, files: File[]) => void) | undefined;
  onRetryAssistantTurn?: ((turn: RenderedTurn) => void) | undefined;
  hasEarlierTurns?: boolean;
  loadingEarlierTurns?: boolean;
  onLoadEarlierTurns?: (() => void) | undefined;
}) {
  const messageCount = turns.length * 2 + (pendingPrompt ? 1 : 0) + (thinking ? 1 : 0);
  const historyRef = useRef<HTMLElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const shouldFollowRef = useRef(true);

  useEffect(() => {
    const updateFollowState = () => {
      const documentElement = document.documentElement;
      const distanceFromBottom = documentElement.scrollHeight - window.scrollY - window.innerHeight;
      shouldFollowRef.current = distanceFromBottom < 220;
    };

    window.addEventListener("scroll", updateFollowState, { passive: true });
    window.addEventListener("resize", updateFollowState);
    updateFollowState();

    return () => {
      window.removeEventListener("scroll", updateFollowState);
      window.removeEventListener("resize", updateFollowState);
    };
  }, []);

  useEffect(() => {
    if (pendingPrompt) {
      shouldFollowRef.current = true;
    }
  }, [pendingPrompt]);

  useEffect(() => {
    if (!shouldFollowRef.current || messageCount === 0) return;
    const frame = requestAnimationFrame(() => {
      bottomRef.current?.scrollIntoView({ block: "end", behavior: "smooth" });
    });

    return () => cancelAnimationFrame(frame);
  }, [messageCount, pendingPrompt, thinking, turns]);

  useEffect(() => {
    if (!historyRef.current || typeof ResizeObserver === "undefined") return;

    const observer = new ResizeObserver(() => {
      if (!shouldFollowRef.current || messageCount === 0) return;
      bottomRef.current?.scrollIntoView({ block: "end", behavior: "auto" });
    });
    observer.observe(historyRef.current);

    return () => observer.disconnect();
  }, [messageCount]);

  return (
    <section ref={historyRef} className={`history-card${messageCount === 0 ? " history-card-empty" : ""}`}>
      <div className="panel-header">
        <div>
          <div className="eyebrow">Conversation</div>
        </div>
        <span className="provider-pill">{messageCount} messages</span>
      </div>
      {messageCount === 0 ? (
        <p className="empty-state">No conversation state yet. Ask anything.</p>
      ) : (
        <div className="chat-thread">
          {hasEarlierTurns ? (
            <button type="button" className="conversation-load-earlier" onClick={onLoadEarlierTurns} disabled={loadingEarlierTurns}>
              {loadingEarlierTurns ? "Loading..." : "Load earlier messages"}
            </button>
          ) : null}
          {turns.map((turn, turnIndex) => {
            const inlineOutputs = turn.outputs.filter(shouldRenderInlineOutput);
            const sources = turn.outputs.filter((output): output is Extract<ContentBlock, { type: "source_list" }> => output.type === "source_list");
            const audioBlocks = turn.outputs.filter((output): output is Extract<ContentBlock, { type: "audio" }> => output.type === "audio");

            return (
              <div key={`turn-${turnIndex}`} className="chat-turn">
                <article className="chat-row chat-row-user">
                  <div className="chat-avatar chat-avatar-user">You</div>
                  <div className="chat-bubble chat-bubble-user">
                    <span className="history-role">Prompt</span>
                    {turn.userAssets?.length ? <UserPromptAssets assets={turn.userAssets} /> : null}
                    <p className="message-text">{turn.userMessage}</p>
                  </div>
                  <UserMessageActions message={turn.userMessage} files={turn.userFiles ?? []} onEdit={onEditUserPrompt} />
                </article>
                <article className="chat-row chat-row-assistant">
                  <div className="chat-avatar chat-avatar-assistant">{personaId}</div>
                  <div className="chat-bubble chat-bubble-assistant">
                    <span className="history-role">Reply</span>
                    {turn.assistantText ? <MarkdownText text={turn.assistantText} className="message-text markdown-text" /> : null}
                    {inlineOutputs.length > 0 ? (
                      <div className="inline-artifact-stack">
                        {inlineOutputs.map((output, outputIndex) => (
                          <div key={`${output.type}-${outputIndex}`} className="inline-artifact-card">
                            <OutputRenderer output={output} onAction={onOutputAction} />
                          </div>
                        ))}
                      </div>
                    ) : null}
                    {testMode ? <TokenUsageFooter usage={turn.usage} /> : null}
                  </div>
                  <AssistantActions
                    text={turn.assistantText}
                    sources={sources}
                    audioBlocks={audioBlocks}
                    personaId={personaId}
                    autoPlayAudio={turnIndex === autoPlayAudioTurnIndex}
                    onAudioPlaybackChange={onAudioPlaybackChange}
                    onRetry={onRetryAssistantTurn ? () => onRetryAssistantTurn(turn) : undefined}
                  />
                </article>
              </div>
            );
          })}
          {pendingPrompt ? (
            <article className="chat-row chat-row-user">
              <div className="chat-avatar chat-avatar-user">You</div>
              <div className="chat-bubble chat-bubble-user">
                <span className="history-role">Prompt</span>
                {pendingAssets.length ? <UserPromptAssets assets={pendingAssets} /> : null}
                <p className="message-text">{pendingPrompt}</p>
              </div>
              <UserMessageActions message={pendingPrompt} files={pendingFiles} onEdit={onEditUserPrompt} />
            </article>
          ) : null}
          {thinking ? (
            <article className="chat-row chat-row-assistant">
              <div className="chat-avatar chat-avatar-assistant">{personaShortName}</div>
              <div className="chat-bubble chat-bubble-assistant">
                <span className="history-role">Thinking</span>
                <div className="thinking-indicator" aria-live="polite" aria-label={`${personaShortName} is thinking`}>
                  <span />
                  <span />
                  <span />
                </div>
              </div>
            </article>
          ) : null}
          <div ref={bottomRef} className="chat-bottom-sentinel" aria-hidden="true" />
        </div>
      )}
    </section>
  );
}
