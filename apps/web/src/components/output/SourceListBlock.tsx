import type { Citation } from "@persona/shared";
import { safeExternalUrl } from "../../lib/security.js";

export function SourceListBlock({ sources }: { sources: Citation[] }) {
  return (
    <section className="source-list" aria-label="Sources">
      <div className="output-label">Sources</div>
      <ol>
        {sources.map((source) => {
          const safeUrl = safeExternalUrl(source.url);
          return (
            <li key={source.url}>
              {safeUrl ? <a href={safeUrl} target="_blank" rel="noreferrer">{source.title}</a> : <span>{source.title}</span>}
              {source.snippet ? <p>{source.snippet}</p> : null}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
