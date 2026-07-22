import type { MouseEvent as ReactMouseEvent } from "react";
import { stripGeneratedFileDownloadPrompt, type ChatResponse, type ContentBlock, type UnsafeOutputReportCategory, type UploadedAsset } from "@persona/shared";
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

function Icon({ name }: { name: "audio" | "copy" | "check" | "download" | "more" | "sources" | "retry" | "edit" | "file" | "image" | "flag" }) {
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

  if (name === "flag") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M5 22V4" />
        <path d="M5 4c5-4 9 4 14 0v11c-5 4-9-4-14 0" />
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
  onRetry,
  onReport
}: {
  text: string;
  sources: Extract<ContentBlock, { type: "source_list" }>[];
  audioBlocks: Extract<ContentBlock, { type: "audio" }>[];
  personaId: string;
  autoPlayAudio?: boolean;
  onAudioPlaybackChange?: ((playing: boolean) => void) | undefined;
  onRetry?: (() => void) | undefined;
  onReport?: (() => void) | undefined;
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
    void downloadProtectedMedia(primaryAudio.url, `${personaId}-response.${audioFileExtension(primaryAudio.mimeType)}`)
      .catch((error: unknown) => window.alert(error instanceof Error ? error.message : "Could not download this audio."));
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
            {onReport ? (
              <button type="button" role="menuitem" onClick={() => {
                setMenuOpen(false);
                onReport();
              }}>
                <Icon name="flag" />
                <span>Report unsafe output</span>
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
  conversationId,
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
  onReportAssistantTurn,
  hasEarlierTurns = false,
  loadingEarlierTurns = false,
  onLoadEarlierTurns
}: {
  conversationId?: string | undefined;
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
  onReportAssistantTurn?: ((turn: RenderedTurn, category: UnsafeOutputReportCategory, details?: string) => Promise<void>) | undefined;
  hasEarlierTurns?: boolean;
  loadingEarlierTurns?: boolean;
  onLoadEarlierTurns?: (() => void) | undefined;
}) {
  const [reportTarget, setReportTarget] = useState<RenderedTurn | undefined>();
  const [reportConversationId, setReportConversationId] = useState<string | undefined>();
  const [reportCategory, setReportCategory] = useState<UnsafeOutputReportCategory | "">("");
  const [reportDetails, setReportDetails] = useState("");
  const [reportSubmitting, setReportSubmitting] = useState(false);
  const [reportError, setReportError] = useState<string | undefined>();
  const [reportSubmitted, setReportSubmitted] = useState(false);
  const messageCount = turns.length * 2 + (pendingPrompt ? 1 : 0) + (thinking ? 1 : 0);
  const historyRef = useRef<HTMLElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const newestAssistantRef = useRef<HTMLElement>(null);
  const shouldFollowRef = useRef(true);
  const previousThinkingRef = useRef(thinking);
  const focusResponseUntilRef = useRef(0);

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
    if (reportTarget && reportConversationId !== conversationId) {
      setReportTarget(undefined);
      setReportConversationId(undefined);
      setReportCategory("");
      setReportDetails("");
      setReportError(undefined);
      setReportSubmitted(false);
    }
  }, [conversationId, reportConversationId, reportTarget]);

  useEffect(() => {
    // A reading position from the previous chat must not suppress positioning
    // the newly selected conversation. The normal message effect below will
    // choose the bottom for history or the response start for a fresh reply.
    shouldFollowRef.current = true;
    focusResponseUntilRef.current = 0;
  }, [conversationId]);

  useEffect(() => {
    if (pendingPrompt) {
      shouldFollowRef.current = true;
    }
  }, [pendingPrompt]);

  useEffect(() => {
    const responseJustCompleted = previousThinkingRef.current && !thinking;
    previousThinkingRef.current = thinking;
    if (!shouldFollowRef.current || messageCount === 0) return;
    const frame = requestAnimationFrame(() => {
      if (responseJustCompleted && newestAssistantRef.current) {
        // Keep the start of a fresh response readable, especially when it is
        // longer than the viewport. The brief resize window also prevents an
        // image/code block expanding immediately afterward from snapping down.
        focusResponseUntilRef.current = Date.now() + 1000;
        newestAssistantRef.current?.scrollIntoView({ block: "start", behavior: "smooth" });
        return;
      }
      bottomRef.current?.scrollIntoView({ block: "end", behavior: "smooth" });
    });

    return () => cancelAnimationFrame(frame);
  }, [messageCount, pendingPrompt, thinking, turns]);

  useEffect(() => {
    if (!historyRef.current || typeof ResizeObserver === "undefined") return;

    const observer = new ResizeObserver(() => {
      if (!shouldFollowRef.current || messageCount === 0) return;
      if (focusResponseUntilRef.current > Date.now() && newestAssistantRef.current) {
        newestAssistantRef.current.scrollIntoView({ block: "start", behavior: "auto" });
        return;
      }
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
            const assistantText = turn.outputs.some((output) => output.type === "file")
              ? stripGeneratedFileDownloadPrompt(turn.assistantText)
              : turn.assistantText;

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
                <article ref={turnIndex === turns.length - 1 ? newestAssistantRef : undefined} className="chat-row chat-row-assistant">
                  <div className="chat-avatar chat-avatar-assistant">{personaId}</div>
                  <div className="chat-bubble chat-bubble-assistant">
                    <span className="history-role">Reply</span>
                    {assistantText ? <MarkdownText text={assistantText} className="message-text markdown-text" /> : null}
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
                    text={assistantText}
                    sources={sources}
                    audioBlocks={audioBlocks}
                    personaId={personaId}
                    autoPlayAudio={turnIndex === autoPlayAudioTurnIndex}
                    onAudioPlaybackChange={onAudioPlaybackChange}
                    onRetry={onRetryAssistantTurn && turnIndex === turns.length - 1 ? () => onRetryAssistantTurn(turn) : undefined}
                    onReport={onReportAssistantTurn ? () => {
                      setReportTarget(turn);
                      setReportConversationId(conversationId);
                      setReportCategory("");
                      setReportDetails("");
                      setReportError(undefined);
                      setReportSubmitted(false);
                    } : undefined}
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
      {reportTarget ? (
        <div className="response-report-backdrop" role="presentation" onMouseDown={(event) => {
          if (event.target === event.currentTarget && !reportSubmitting) setReportTarget(undefined);
        }}>
          <div className="response-report-dialog" role="dialog" aria-modal="true" aria-labelledby="response-report-title">
            {reportSubmitted ? (
              <div className="response-report-success" role="status">
                <span className="response-report-mark"><Icon name="check" /></span>
                <h2 id="response-report-title">Report received</h2>
                <p>Thank you. Your report was saved for safety review.</p>
                <button type="button" className="response-report-primary" onClick={() => setReportTarget(undefined)}>Done</button>
              </div>
            ) : (
              <>
                <div className="response-report-heading">
                  <div>
                    <span className="eyebrow">Safety feedback</span>
                    <h2 id="response-report-title">Report this response</h2>
                  </div>
                  <button type="button" className="response-report-close" aria-label="Close report" onClick={() => setReportTarget(undefined)} disabled={reportSubmitting}>×</button>
                </div>
                <p className="response-report-copy">Tell us what went wrong. Reports help us investigate unsafe AI output and do not automatically remove your conversation.</p>
                <fieldset className="response-report-categories">
                  <legend>What is the issue?</legend>
                  {REPORT_CATEGORIES.map((option) => (
                    <label key={option.value} className={reportCategory === option.value ? "selected" : ""}>
                      <input type="radio" name="report-category" value={option.value} checked={reportCategory === option.value} onChange={() => setReportCategory(option.value)} />
                      <span>{option.label}</span>
                    </label>
                  ))}
                </fieldset>
                <label className="response-report-details">
                  <span>Anything else? <small>Optional</small></span>
                  <textarea value={reportDetails} maxLength={1000} rows={3} onChange={(event) => setReportDetails(event.target.value)} placeholder="Add context that could help our review." />
                </label>
                {reportError ? <p className="response-report-error" role="alert">{reportError}</p> : null}
                <div className="response-report-actions">
                  <button type="button" className="response-report-secondary" onClick={() => setReportTarget(undefined)} disabled={reportSubmitting}>Cancel</button>
                  <button type="button" className="response-report-primary" disabled={!reportCategory || reportSubmitting} onClick={() => {
                    if (!reportCategory || !onReportAssistantTurn) return;
                    setReportSubmitting(true);
                    setReportError(undefined);
                    void onReportAssistantTurn(reportTarget, reportCategory, reportDetails.trim() || undefined)
                      .then(() => setReportSubmitted(true))
                      .catch((error: unknown) => setReportError(error instanceof Error ? error.message : "Could not submit this report."))
                      .finally(() => setReportSubmitting(false));
                  }}>{reportSubmitting ? "Sending…" : "Send report"}</button>
                </div>
              </>
            )}
          </div>
        </div>
      ) : null}
    </section>
  );
}

const REPORT_CATEGORIES: Array<{ value: UnsafeOutputReportCategory; label: string }> = [
  { value: "sexual_content", label: "Sexual content" },
  { value: "violence_or_self_harm", label: "Violence or self-harm" },
  { value: "hate_or_harassment", label: "Hate or harassment" },
  { value: "child_safety", label: "Child safety" },
  { value: "privacy_or_impersonation", label: "Privacy or impersonation" },
  { value: "dangerous_or_illegal", label: "Dangerous or illegal advice" },
  { value: "misinformation", label: "False or misleading information" },
  { value: "other", label: "Something else" }
];
