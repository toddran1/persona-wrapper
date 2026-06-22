import type { ChatResponse } from "@persona/shared";
import { JsonBlock } from "./output/JsonBlock.js";

export function DebugPanel({ request, response }: { request: Record<string, unknown> | undefined; response: ChatResponse | undefined }) {
  const payload = request || response
    ? {
        request: request ?? null,
        response: response ?? null
      }
    : undefined;

  return (
    <details className="debug-card collapsible-panel">
      <summary className="collapsible-summary">
        <div>
          <div className="eyebrow">Structured Payload</div>
          <h2>Latest JSON</h2>
        </div>
      </summary>
      {payload ? <JsonBlock data={payload} /> : <p className="empty-state">Send a prompt to inspect the request and response payload.</p>}
    </details>
  );
}
