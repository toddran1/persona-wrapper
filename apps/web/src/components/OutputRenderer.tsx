import type { ContentBlock } from "@persona/shared";
import { AudioBlock } from "./output/AudioBlock.js";
import { ChartBlock } from "./output/ChartBlock.js";
import { FileBlock } from "./output/FileBlock.js";
import { ImageBlock } from "./output/ImageBlock.js";
import { JsonBlock } from "./output/JsonBlock.js";
import { TextBlock } from "./output/TextBlock.js";
import { ToolCallBlock } from "./output/ToolCallBlock.js";

export function OutputRenderer({ output }: { output: ContentBlock }) {
  switch (output.type) {
    case "text":
      return <TextBlock text={output.text} />;
    case "json":
      return <JsonBlock data={output.data} />;
    case "audio":
      return <AudioBlock {...output} />;
    case "image":
      return <ImageBlock {...output} />;
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
  }
}
