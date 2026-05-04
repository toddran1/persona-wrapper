import type { ChatResponse } from "@persona/shared";
import { OutputRenderer } from "./OutputRenderer.js";

export function ResponsePanel({ response }: { response: ChatResponse | undefined }) {
  const artifactOutputs = response?.outputs.filter((output) => output.type !== "text") ?? [];

  return (
    <section className="response-card">
      <div className="panel-header">
        <div>
          <div className="eyebrow">Artifacts</div>
          <h2>Tooling, media, and structured extras</h2>
        </div>
        {response ? <span className="provider-pill">{response.provider}</span> : null}
      </div>

      {!response ? (
        <p className="empty-state">No response yet. Send a prompt to see charts, tool calls, files, images, JSON blocks, and audio render here.</p>
      ) : artifactOutputs.length === 0 ? (
        <p className="empty-state">This turn only returned the assistant reply text. Ask for a chart, file, image, JSON payload, or tool call to populate this area.</p>
      ) : (
        <div className="output-stack">
          {artifactOutputs.map((output, index) => (
            <div key={`${output.type}-${index}`} className="output-card">
              <OutputRenderer output={output} />
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
