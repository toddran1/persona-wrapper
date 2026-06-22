import type { ChatResponse } from "@persona/shared";

export function NeutralResponsePanel({ response }: { response: ChatResponse | undefined }) {
  const neutralResponse = response?.diagnostics.neutralResponse;

  return (
    <details className="neutral-card collapsible-panel">
      <summary className="collapsible-summary">
        <div>
          <div className="eyebrow">Test mode</div>
          <h2>Neutral response</h2>
        </div>
      </summary>
      {neutralResponse ? (
        <pre className="neutral-response">{neutralResponse}</pre>
      ) : (
        <p className="empty-state">Send a prompt to see the fully neutral response before style transfer.</p>
      )}
    </details>
  );
}
