import type { ChatResponse, PersonaDefinition, PersonaSummary, ProviderId } from "@persona/shared";
import type { CSSProperties } from "react";
import { useEffect, useState } from "react";
import { api } from "./lib/api.js";
import { ChatComposer } from "./components/ChatComposer.js";
import { ConversationHistory } from "./components/ConversationHistory.js";
import { DebugPanel } from "./components/DebugPanel.js";
import { EvalCapturePanel } from "./components/EvalCapturePanel.js";
import { PersonaHeader } from "./components/PersonaHeader.js";
import { StatusStrip } from "./components/StatusStrip.js";

export function App() {
  const [personas, setPersonas] = useState<PersonaSummary[]>([]);
  const [personaDetail, setPersonaDetail] = useState<PersonaDefinition | undefined>();
  const [provider, setProvider] = useState<ProviderId>("local");
  const [audioEnabled, setAudioEnabled] = useState(false);
  const [response, setResponse] = useState<ChatResponse | undefined>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [conversationId, setConversationId] = useState<string | undefined>();
  const [testModeEnabled, setTestModeEnabled] = useState(false);
  const [evalSaving, setEvalSaving] = useState(false);
  const [evalSavedMessage, setEvalSavedMessage] = useState<string | undefined>();
  const [evalError, setEvalError] = useState<string | undefined>();

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

  async function handleSubmit(message: string): Promise<void> {
    if (!personaDetail) {
      return;
    }

    setLoading(true);
    setError(undefined);

    try {
      const result = await api.sendChat({
        personaId: personaDetail.id,
        message,
        provider,
        audio: audioEnabled,
        ...(conversationId ? { conversationId } : {})
      });

      setConversationId(result.conversationId);
      setResponse(result);
      setEvalSavedMessage(undefined);
      setEvalError(undefined);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Failed to generate response");
    } finally {
      setLoading(false);
    }
  }

  function resetConversation(): void {
    setConversationId(undefined);
    setResponse(undefined);
    setError(undefined);
    setEvalSavedMessage(undefined);
    setEvalError(undefined);
  }

  async function saveEvalCapture(idealStyledText: string, notes: string): Promise<void> {
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
        tags: ["ui-review"]
      });
      setEvalSavedMessage(`Saved ${result.id}`);
    } catch (saveError) {
      setEvalError(saveError instanceof Error ? saveError.message : "Failed to save eval example");
    } finally {
      setEvalSaving(false);
    }
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
          <EvalCapturePanel
            enabled={testModeEnabled}
            response={response}
            saving={evalSaving}
            savedMessage={evalSavedMessage}
            error={evalError}
            onEnabledChange={setTestModeEnabled}
            onSave={saveEvalCapture}
          />
        </aside>
        <section className="chat-column">
          <ConversationHistory history={response?.history ?? []} latestOutputs={response?.outputs ?? []} />
          <div className="composer-dock">
            <ChatComposer
              provider={provider}
              audioEnabled={audioEnabled}
              loading={loading}
              onResetConversation={resetConversation}
              onProviderChange={setProvider}
              onAudioChange={setAudioEnabled}
              onSubmit={handleSubmit}
            />
          </div>
        </section>
        {error ? <div className="error-banner">{error}</div> : null}
      </div>
    </main>
  );
}
