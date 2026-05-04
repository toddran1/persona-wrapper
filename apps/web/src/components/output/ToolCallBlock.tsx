import type { ToolName } from "@persona/shared";

type ToolCallBlockProps = {
  toolName: ToolName;
  arguments_: Record<string, unknown>;
  status: string;
};

export function ToolCallBlock({ toolName, arguments_, status }: ToolCallBlockProps) {
  return (
    <div className="tool-card">
      <div className="output-label">Tool call</div>
      <h3>{toolName}</h3>
      <p>Status: {status}</p>
      <pre className="output-code">{JSON.stringify(arguments_, null, 2)}</pre>
    </div>
  );
}

