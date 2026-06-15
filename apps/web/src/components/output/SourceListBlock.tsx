import type { Citation } from "@persona/shared";

export function SourceListBlock({ sources }: { sources: Citation[] }) {
  return (
    <section className="source-list" aria-label="Sources">
      <div className="output-label">Sources</div>
      <ol>
        {sources.map((source) => (
          <li key={source.url}>
            <a href={source.url} target="_blank" rel="noreferrer">{source.title}</a>
            {source.snippet ? <p>{source.snippet}</p> : null}
          </li>
        ))}
      </ol>
    </section>
  );
}
