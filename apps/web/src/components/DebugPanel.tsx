import type { ContentBlock } from "@persona/shared";
import { JsonBlock } from "./output/JsonBlock.js";

export function DebugPanel({ outputs }: { outputs: ContentBlock[] }) {
  const jsonOutput = outputs.find((output) => output.type === "json");

  return (
    <section className="debug-card">
      <div className="panel-header">
        <div>
          <div className="eyebrow">Structured Payload</div>
          <h2>Latest JSON</h2>
        </div>
      </div>
      {jsonOutput?.type === "json" ? <JsonBlock data={jsonOutput.data} /> : <p className="empty-state">No JSON payload returned on this turn.</p>}
    </section>
  );
}
