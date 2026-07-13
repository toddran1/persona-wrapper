import type { ContentBlock } from "@persona/shared";
import { useState } from "react";
import { AudioBlock } from "./output/AudioBlock.js";
import { ChartBlock } from "./output/ChartBlock.js";
import { FileBlock } from "./output/FileBlock.js";
import { ImageBlock } from "./output/ImageBlock.js";
import { JsonBlock } from "./output/JsonBlock.js";
import { TextBlock } from "./output/TextBlock.js";
import { ToolCallBlock } from "./output/ToolCallBlock.js";
import { ToolResultBlock } from "./output/ToolResultBlock.js";
import { SourceListBlock } from "./output/SourceListBlock.js";
import { TableBlock } from "./output/TableBlock.js";
import { CodeBlock } from "./output/CodeBlock.js";
import { StatusBlock } from "./output/StatusBlock.js";
import { VideoBlock } from "./output/VideoBlock.js";

function ActionBlock({
  output,
  onAction
}: {
  output: Extract<ContentBlock, { type: "action" }>;
  onAction?: ((action: Extract<ContentBlock, { type: "action" }>) => void | Promise<void>) | undefined;
}) {
  const [running, setRunning] = useState(false);
  const [actionError, setActionError] = useState<string | undefined>();

  async function handleClick(): Promise<void> {
    if (!onAction || running) return;
    setRunning(true);
    setActionError(undefined);
    try {
      await onAction(output);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Could not complete this action.");
    } finally {
      setRunning(false);
    }
  }

  return (
    <>
      <button
        type="button"
        className={`action-button action-button-${output.style ?? "secondary"}`}
        disabled={running}
        aria-busy={running}
        onClick={() => void handleClick()}
      >
        {running ? "Checking..." : output.label}
      </button>
      {actionError ? <span className="output-error" role="alert">{actionError}</span> : null}
    </>
  );
}

export function OutputRenderer({
  output,
  onAction
}: {
  output: ContentBlock;
  onAction?: ((action: Extract<ContentBlock, { type: "action" }>) => void | Promise<void>) | undefined;
}) {
  switch (output.type) {
    case "text":
      return <TextBlock text={output.text} />;
    case "json":
      return <JsonBlock data={output.data} />;
    case "audio":
      return <AudioBlock {...output} />;
    case "image":
      return <ImageBlock {...output} />;
    case "video":
      return <VideoBlock {...output} />;
    case "chart":
      return <ChartBlock title={output.title} chartType={output.chartType} series={output.series} />;
    case "file":
      return <FileBlock {...output} />;
    case "tool_call":
      return (
        <ToolCallBlock
          toolName={output.toolName}
          arguments_={output.arguments}
          status={output.status}
        />
      );
    case "tool_result":
      return <ToolResultBlock {...output} />;
    case "source_list":
      return <SourceListBlock sources={output.sources} />;
    case "table":
      return <TableBlock {...output} />;
    case "code":
      return <CodeBlock {...output} />;
    case "status":
      return <StatusBlock {...output} />;
    case "action":
      return <ActionBlock output={output} onAction={onAction} />;
  }
}
