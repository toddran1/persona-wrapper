import type { ChatResponse, ClientContext, PersonaDefinition, PersonaSummary, ProviderId, ToolOptions } from "@persona/shared";
import type { CSSProperties } from "react";
import { useEffect, useState } from "react";
import { useRef } from "react";
import { api } from "./lib/api.js";
import { ChatComposer } from "./components/ChatComposer.js";
import { ConversationHistory } from "./components/ConversationHistory.js";
import { DebugPanel } from "./components/DebugPanel.js";
import { EvalCapturePanel } from "./components/EvalCapturePanel.js";
import { GoldenPairReviewPage } from "./components/GoldenPairReviewPage.js";
import { NeutralResponsePanel } from "./components/NeutralResponsePanel.js";
import { PersonaHeader } from "./components/PersonaHeader.js";
import { StatusStrip } from "./components/StatusStrip.js";

type BrowserLocation = NonNullable<ClientContext["location"]>;

function getClientContext(location?: BrowserLocation): ClientContext {
  const now = new Date();

  return {
    locale: navigator.language,
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    currentDateTime: now.toISOString(),
    utcOffsetMinutes: -now.getTimezoneOffset(),
    ...(location ? { location } : {})
  };
}

export function App() {
  const testModeEnabled = import.meta.env.VITE_TEST_MODE === "true";
  const reviewPageEnabled = testModeEnabled && window.location.pathname === "/review";
  const [personas, setPersonas] = useState<PersonaSummary[]>([]);
  const [personaDetail, setPersonaDetail] = useState<PersonaDefinition | undefined>();
  const [provider, setProvider] = useState<ProviderId>("openai");
  const [audioEnabled, setAudioEnabled] = useState(false);
  const [response, setResponse] = useState<ChatResponse | undefined>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [conversationId, setConversationId] = useState<string | undefined>();
  const [evalSaving, setEvalSaving] = useState(false);
  const [evalSavedMessage, setEvalSavedMessage] = useState<string | undefined>();
  const [evalError, setEvalError] = useState<string | undefined>();
  const [browserLocation, setBrowserLocation] = useState<BrowserLocation | undefined>();
  const [locationError, setLocationError] = useState<string | undefined>();
  const [pendingPrompt, setPendingPrompt] = useState<string | undefined>();
  const [streamingText, setStreamingText] = useState("");
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

  async function handleSubmit(message: string, files: File[], toolOptions: ToolOptions): Promise<void> {
    if (!personaDetail) {
      return;
    }

    setLoading(true);
    setError(undefined);
    setPendingPrompt(message);
    setStreamingText("");
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
        clientContext: getClientContext(browserLocation),
        attachments,
        toolOptions: resolvedToolOptions,
        ...(conversationId ? { conversationId } : {})
      };
      const result = provider === "openai"
        ? await api.sendChatStream(payload, (delta) => setStreamingText((current) => current + delta), requestController.signal)
        : await api.sendChat(payload, requestController.signal);

      setConversationId(result.conversationId);
      setResponse(result);
      setPendingPrompt(undefined);
      setStreamingText("");
      setEvalSavedMessage(undefined);
      setEvalError(undefined);
    } catch (submitError) {
      setPendingPrompt(undefined);
      setStreamingText("");
      if (!requestController.signal.aborted) {
        setError(submitError instanceof Error ? submitError.message : "Failed to generate response");
      }
    } finally {
      if (activeRequestRef.current === requestController) activeRequestRef.current = undefined;
      setLoading(false);
    }
  }

  function cancelRequest(): void {
    activeRequestRef.current?.abort();
    activeRequestRef.current = undefined;
    setLoading(false);
    setPendingPrompt(undefined);
    setStreamingText("");
  }

  function resetConversation(): void {
    setConversationId(undefined);
    setResponse(undefined);
    setError(undefined);
    setEvalSavedMessage(undefined);
    setEvalError(undefined);
    setPendingPrompt(undefined);
    setStreamingText("");
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

  function requestLocation(): void {
    setLocationError(undefined);

    if (!navigator.geolocation) {
      setLocationError("Location is not available in this browser.");
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (position) => {
        setBrowserLocation({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracyMeters: position.coords.accuracy
        });
      },
      (locationRequestError) => {
        setLocationError(locationRequestError.message || "Location permission was not granted.");
      },
      {
        enableHighAccuracy: false,
        maximumAge: 300000,
        timeout: 10000
      }
    );
  }

  const activeTheme = personaDetail?.theme ?? personas[0]?.theme;
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
      <div className="background-orb background-orb-a" />
      <div className="background-orb background-orb-b" />
      <div className="app-grid">
        <PersonaHeader personaSummary={personas[0]} personaDetail={personaDetail} />
        <aside className="sidebar-column">
          <StatusStrip
            conversationId={conversationId}
            loading={loading}
            error={error}
            generatedAt={response?.generatedAt}
            onClearError={() => setError(undefined)}
          />
          <DebugPanel outputs={response?.outputs ?? []} />
          {testModeEnabled ? <NeutralResponsePanel response={response} /> : null}
          {testModeEnabled ? (
            <EvalCapturePanel
              response={response}
              saving={evalSaving}
              savedMessage={evalSavedMessage}
              error={evalError}
              onSave={saveEvalCapture}
            />
          ) : null}
        </aside>
        <section className="chat-column">
          <ConversationHistory
            history={response?.history ?? []}
            latestOutputs={response?.outputs ?? []}
            pendingPrompt={pendingPrompt}
            streamingText={streamingText}
          />
          <div className="composer-dock">
            <ChatComposer
              provider={provider}
              audioEnabled={audioEnabled}
              loading={loading}
              locationEnabled={Boolean(browserLocation)}
              locationError={locationError}
              onResetConversation={resetConversation}
              onProviderChange={setProvider}
              onAudioChange={setAudioEnabled}
              onRequestLocation={requestLocation}
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
