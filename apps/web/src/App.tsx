import type { ChatResponse, ClientContext, PersonaDefinition, PersonaSummary, ProviderId, ToolOptions } from "@persona/shared";
import type { CSSProperties } from "react";
import { useEffect, useState } from "react";
import { useRef } from "react";
import { api } from "./lib/api.js";
import { ChatComposer } from "./components/ChatComposer.js";
import { ConversationHistory, type RenderedTurn } from "./components/ConversationHistory.js";
import { DebugPanel } from "./components/DebugPanel.js";
import { EvalCapturePanel } from "./components/EvalCapturePanel.js";
import { GoldenPairReviewPage } from "./components/GoldenPairReviewPage.js";
import { NeutralResponsePanel } from "./components/NeutralResponsePanel.js";
import { PersonaHeader } from "./components/PersonaHeader.js";
import { PersonaVisualStage } from "./components/PersonaVisualStage.js";

function getClientContext(): ClientContext {
  const now = new Date();

  return {
    locale: navigator.language,
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    currentDateTime: now.toISOString(),
    utcOffsetMinutes: -now.getTimezoneOffset()
  };
}

function wait(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason instanceof Error ? signal.reason : new Error("Request cancelled."));
      return;
    }
    const timeout = window.setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      window.clearTimeout(timeout);
      reject(signal.reason instanceof Error ? signal.reason : new Error("Request cancelled."));
    }, { once: true });
  });
}

export function App() {
  const testModeEnabled = import.meta.env.VITE_TEST_MODE === "true";
  const reviewPageEnabled = testModeEnabled && window.location.pathname.replace(/\/$/, "") === "/review";
  const [personas, setPersonas] = useState<PersonaSummary[]>([]);
  const [personaDetail, setPersonaDetail] = useState<PersonaDefinition | undefined>();
  const [provider, setProvider] = useState<ProviderId>("openai_persona");
  const [audioEnabled, setAudioEnabled] = useState(false);
  const [response, setResponse] = useState<ChatResponse | undefined>();
  const [latestRequest, setLatestRequest] = useState<Record<string, unknown> | undefined>();
  const [renderedTurns, setRenderedTurns] = useState<RenderedTurn[]>([]);
  const [loading, setLoading] = useState(false);
  const [personaAudioPlaying, setPersonaAudioPlaying] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [conversationId, setConversationId] = useState<string | undefined>();
  const [evalSaving, setEvalSaving] = useState(false);
  const [evalSavedMessage, setEvalSavedMessage] = useState<string | undefined>();
  const [evalError, setEvalError] = useState<string | undefined>();
  const [pendingPrompt, setPendingPrompt] = useState<string | undefined>();
  const activeRequestRef = useRef<AbortController | undefined>();

  useEffect(() => {
    void (async () => {
      try {
        const loadedPersonas = await api.getPersonas();
        setPersonas(loadedPersonas);

        if (loadedPersonas[0]) {
          const detail = await api.getPersona(loadedPersonas[0].id);
          setPersonaDetail(detail);
        }
      } catch (loadError) {
        setError(loadError instanceof Error ? loadError.message : "Failed to load personas");
      }
    })();
  }, []);

  useEffect(() => {
    const nextTitle = personaDetail?.documentTitle ?? personas[0]?.documentTitle;
    document.title = nextTitle ?? "Persona Wrapper";
  }, [personaDetail?.documentTitle, personas]);

  useEffect(() => {
    if (!audioEnabled) {
      setPersonaAudioPlaying(false);
    }
  }, [audioEnabled]);

  async function handleSubmit(message: string, files: File[], toolOptions: ToolOptions): Promise<void> {
    if (!personaDetail) {
      return;
    }

    setLoading(true);
    setPersonaAudioPlaying(false);
    setError(undefined);
    setPendingPrompt(message);
    const requestController = new AbortController();
    activeRequestRef.current = requestController;

    try {
      const attachments = files.length > 0 ? await api.uploadFiles(files) : [];
      let resolvedToolOptions = toolOptions;
      if (toolOptions.fileSearch && attachments.some((attachment) => attachment.kind === "file")) {
        const vectorStore = await api.createVectorStore(
          attachments.filter((attachment) => attachment.kind === "file").map((attachment) => attachment.id)
        );
        resolvedToolOptions = { ...toolOptions, vectorStoreIds: [vectorStore.id] };
      }
      const payload = {
        personaId: personaDetail.id,
        message,
        provider,
        audio: audioEnabled,
        testMode: testModeEnabled,
        clientContext: getClientContext(),
        attachments,
        toolOptions: resolvedToolOptions,
        ...(conversationId ? { conversationId } : {})
      };
      setLatestRequest(payload);
      const result = await api.sendChat(payload, requestController.signal);
      const backgroundJob = result.diagnostics.backgroundJob;
      const finalResult = backgroundJob
        ? await pollChatJob(backgroundJob.id, requestController.signal)
        : result;

      appendChatResult(message, finalResult);
      setPendingPrompt(undefined);
      setEvalSavedMessage(undefined);
      setEvalError(undefined);
    } catch (submitError) {
      setPendingPrompt(undefined);
      if (!requestController.signal.aborted) {
        setError(submitError instanceof Error ? submitError.message : "Failed to generate response");
      }
    } finally {
      if (activeRequestRef.current === requestController) activeRequestRef.current = undefined;
      setLoading(false);
    }
  }

  function appendChatResult(message: string, result: ChatResponse): void {
    const assistantTextBlock = result.outputs.find((output) => output.type === "text");
    const assistantText = assistantTextBlock?.type === "text" ? assistantTextBlock.text : "";

    setConversationId(result.conversationId);
    setResponse(result);
    setRenderedTurns((current) => [
      ...current,
      {
        userMessage: message,
        assistantText,
        outputs: result.outputs,
        usage: result.usage
      }
    ]);
  }

  async function pollChatJob(jobId: string, signal: AbortSignal): Promise<ChatResponse> {
    const startedAt = Date.now();
    const maxPollMs = 12 * 60 * 1000;
    let intervalMs = 1200;

    while (Date.now() - startedAt < maxPollMs) {
      signal.throwIfAborted();
      const job = await api.getChatJob(jobId, signal);
      if (job.status === "completed" && job.response) {
        return job.response;
      }
      if (job.status === "failed") {
        throw new Error(job.error ? `Background request failed: ${job.error}` : "Background request failed");
      }
      await wait(intervalMs, signal);
      intervalMs = Math.min(5000, Math.round(intervalMs * 1.35));
    }

    throw new Error("Background request is still running. Try again in a moment.");
  }

  function cancelRequest(): void {
    activeRequestRef.current?.abort();
    activeRequestRef.current = undefined;
    setLoading(false);
    setPersonaAudioPlaying(false);
    setPendingPrompt(undefined);
  }

  function resetConversation(): void {
    setConversationId(undefined);
    setResponse(undefined);
    setLatestRequest(undefined);
    setRenderedTurns([]);
    setError(undefined);
    setEvalSavedMessage(undefined);
    setEvalError(undefined);
    setPendingPrompt(undefined);
    setPersonaAudioPlaying(false);
  }

  async function saveEvalCapture(idealStyledText: string, notes: string, tags: string[]): Promise<void> {
    if (!response?.conversationId) {
      return;
    }

    setEvalSaving(true);
    setEvalSavedMessage(undefined);
    setEvalError(undefined);

    try {
      const result = await api.saveStyleTransferEval({
        conversationId: response.conversationId,
        idealStyledText,
        notes,
        tags: ["ui-review", ...tags]
      });
      setEvalSavedMessage(`Saved ${result.id}`);
    } catch (saveError) {
      setEvalError(saveError instanceof Error ? saveError.message : "Failed to save eval example");
    } finally {
      setEvalSaving(false);
    }
  }

  const activeTheme = personaDetail?.theme ?? personas[0]?.theme;
  const hasConversationContent = renderedTurns.length > 0 || Boolean(pendingPrompt) || loading;
  const personaVisualState = !audioEnabled ? "idle" : personaAudioPlaying ? "speaking" : loading ? "thinking" : "idle";
  const themeStyle = activeTheme
    ? ({
        "--theme-background": activeTheme.background,
        "--theme-background-accent": activeTheme.backgroundAccent,
        "--theme-background-accent-secondary": activeTheme.backgroundAccentSecondary,
        "--theme-surface": activeTheme.surface,
        "--theme-surface-strong": activeTheme.surfaceStrong,
        "--theme-border": activeTheme.border,
        "--theme-accent": activeTheme.accent,
        "--theme-accent-2": activeTheme.accent2,
        "--theme-text": activeTheme.text,
        "--theme-muted": activeTheme.muted
      } as CSSProperties)
    : undefined;

  return (
    reviewPageEnabled ? (
      <GoldenPairReviewPage />
    ) : (
    <main className="page-shell" style={themeStyle}>
      <div className={`app-grid ${testModeEnabled ? "app-grid-test" : "app-grid-normal"}`}>
        <PersonaHeader personaSummary={personas[0]} personaDetail={personaDetail} />
        {testModeEnabled ? (
          <aside className="sidebar-column">
            <DebugPanel request={latestRequest} response={response} />
            <NeutralResponsePanel response={response} />
            <EvalCapturePanel
              response={response}
              saving={evalSaving}
              savedMessage={evalSavedMessage}
              error={evalError}
              onSave={saveEvalCapture}
            />
          </aside>
        ) : null}
        <section className={`chat-column${hasConversationContent ? "" : " chat-column-empty"}`}>
          <div className="conversation-stage-grid">
            <ConversationHistory
              turns={renderedTurns}
              pendingPrompt={pendingPrompt}
              thinking={loading && Boolean(pendingPrompt)}
              testMode={testModeEnabled}
              onAudioPlaybackChange={audioEnabled ? setPersonaAudioPlaying : undefined}
            />
            <PersonaVisualStage state={personaVisualState} personaName={personaDetail?.name ?? personas[0]?.name ?? "LaRae"} />
          </div>
          <div className="composer-dock">
            <ChatComposer
              provider={provider}
              audioEnabled={audioEnabled}
              loading={loading}
              promptPlaceholder={personaDetail?.promptPlaceholder ?? personas[0]?.promptPlaceholder ?? "Ask anything"}
              suggestedPrompts={personaDetail?.suggestedPrompts ?? personas[0]?.suggestedPrompts ?? []}
              onResetConversation={resetConversation}
              onProviderChange={setProvider}
              onAudioChange={setAudioEnabled}
              onCancel={cancelRequest}
              onSubmit={handleSubmit}
            />
          </div>
        </section>
        {error ? <div className="error-banner">{error}</div> : null}
      </div>
    </main>
    )
  );
}
