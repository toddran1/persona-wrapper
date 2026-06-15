export function ToolResultBlock({ toolName, status, result }: { toolName: string; status: string; result?: unknown }) {
  return (
    <details className="tool-card">
      <summary>{toolName} · {status}</summary>
      {result !== undefined ? <pre className="output-code">{JSON.stringify(result, null, 2)}</pre> : null}
    </details>
  );
}
