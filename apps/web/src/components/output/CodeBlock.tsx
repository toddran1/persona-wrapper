export function CodeBlock({ code, language, title }: { code: string; language?: string | undefined; title?: string | undefined }) {
  return (
    <section>
      <div className="output-label">{title ?? language ?? "Code"}</div>
      <pre className="output-code"><code>{code}</code></pre>
    </section>
  );
}
