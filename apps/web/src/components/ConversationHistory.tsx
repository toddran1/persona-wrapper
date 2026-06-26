import type { ChatResponse, ContentBlock } from "@persona/shared";
import { useEffect, useId, useRef, useState } from "react";
import { MarkdownText } from "./MarkdownText.js";
import { OutputRenderer } from "./OutputRenderer.js";

export type RenderedTurn = {
  userMessage: string;
  assistantText: string;
  outputs: ContentBlock[];
  usage?: ChatResponse["usage"];
};

function resolveAssetUrl(url: string): string {
  return url.startsWith("/") ? `${import.meta.env.VITE_API_URL ?? "http://localhost:4000"}${url}` : url;
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

async function downloadAsset(url: string, fileName: string): Promise<void> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Download failed: ${response.status}`);
  const blob = await response.blob();
  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = objectUrl;
  link.download = fileName;
  link.style.display = "none";
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(objectUrl);
}

function Icon({ name }: { name: "audio" | "copy" | "download" | "more" | "sources" | "retry" }) {
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

  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 12h.01" />
      <path d="M19 12h.01" />
      <path d="M5 12h.01" />
    </svg>
  );
}

function AssistantActions({
  text,
  sources,
  audioBlocks,
  autoPlayAudio = false,
  onAudioPlaybackChange
}: {
  text: string;
  sources: Extract<ContentBlock, { type: "source_list" }>[];
  audioBlocks: Extract<ContentBlock, { type: "audio" }>[];
  autoPlayAudio?: boolean;
  onAudioPlaybackChange?: ((playing: boolean) => void) | undefined;
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
  const flatSources = sources.flatMap((sourceList) => sourceList.sources);
  const primaryAudio = audioBlocks[0];
  const resolvedAudioUrl = primaryAudio ? resolveAssetUrl(primaryAudio.url) : "";

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
    void downloadAsset(resolvedAudioUrl, `larae-response.${audioFileExtension(primaryAudio.mimeType)}`);
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
            setSourcesOpen(false);
            setAudioOpen(false);
          }}
        >
          <Icon name="more" />
        </button>
        {menuOpen ? (
          <div id={menuId} className="message-action-menu" role="menu">
            <button type="button" role="menuitem" onClick={() => setMenuOpen(false)}>
              <Icon name="retry" />
              <span>Retry</span>
            </button>
          </div>
        ) : null}
      </div>
      {flatSources.length > 0 ? (
        <div className="message-action-wrap">
          <button
            type="button"
            className="message-sources-button"
            aria-haspopup="dialog"
            aria-expanded={sourcesOpen}
            aria-controls={sourcesId}
            onClick={() => {
              setSourcesOpen((current) => !current);
              setMenuOpen(false);
              setAudioOpen(false);
            }}
          >
            <Icon name="sources" />
            <span>Sources</span>
          </button>
          {sourcesOpen ? (
            <div id={sourcesId} className="message-sources-popover" role="dialog" aria-label="Sources">
              <div className="message-sources-title">Sources</div>
              {flatSources.map((source, index) => (
                <a key={`${source.url}-${index}`} href={source.url} target="_blank" rel="noreferrer" className="message-source-item">
                  <span>{source.title}</span>
                  {source.snippet ? <small>{source.snippet}</small> : null}
                </a>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function shouldRenderInlineOutput(output: ContentBlock): boolean {
  if (output.type === "text" || output.type === "json" || output.type === "source_list" || output.type === "audio") return false;
  if (output.type === "tool_result" && output.toolName === "web_search" && output.status === "completed") return false;
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
  turns,
  pendingPrompt,
  thinking,
  testMode = false,
  onAudioPlaybackChange
}: {
  turns: RenderedTurn[];
  pendingPrompt?: string | undefined;
  thinking?: boolean | undefined;
  testMode?: boolean | undefined;
  onAudioPlaybackChange?: ((playing: boolean) => void) | undefined;
}) {
  const messageCount = turns.length * 2 + (pendingPrompt ? 1 : 0) + (thinking ? 1 : 0);

  return (
    <section className={`history-card${messageCount === 0 ? " history-card-empty" : ""}`}>
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
                    <p className="message-text">{turn.userMessage}</p>
                  </div>
                </article>
                <article className="chat-row chat-row-assistant">
                  <div className="chat-avatar chat-avatar-assistant">LaRae</div>
                  <div className="chat-bubble chat-bubble-assistant">
                    <span className="history-role">Reply</span>
                    {turn.assistantText ? <MarkdownText text={turn.assistantText} className="message-text markdown-text" /> : null}
                    {inlineOutputs.length > 0 ? (
                      <div className="inline-artifact-stack">
                        {inlineOutputs.map((output, outputIndex) => (
                          <div key={`${output.type}-${outputIndex}`} className="inline-artifact-card">
                            <OutputRenderer output={output} />
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
                    autoPlayAudio={turnIndex === turns.length - 1}
                    onAudioPlaybackChange={onAudioPlaybackChange}
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
                <p className="message-text">{pendingPrompt}</p>
              </div>
            </article>
          ) : null}
          {thinking ? (
            <article className="chat-row chat-row-assistant">
              <div className="chat-avatar chat-avatar-assistant">LaRae</div>
              <div className="chat-bubble chat-bubble-assistant">
                <span className="history-role">Reply</span>
                <div className="thinking-indicator" aria-live="polite" aria-label="LaRae is thinking">
                  <span />
                  <span />
                  <span />
                </div>
              </div>
            </article>
          ) : null}
        </div>
      )}
    </section>
  );
}
