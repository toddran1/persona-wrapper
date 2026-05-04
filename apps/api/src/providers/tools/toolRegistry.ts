import type { ToolDefinition } from "@persona/shared";

const toolRegistry: Record<string, ToolDefinition> = {
  web_search: {
    name: "web_search",
    description: "Search the web for current information and return a concise result set.",
    inputSchema: {
      query: "string",
      recencyDays: "number?"
    }
  },
  file_search: {
    name: "file_search",
    description: "Search indexed files or uploaded documents for relevant text.",
    inputSchema: {
      query: "string",
      fileIds: "string[]?"
    }
  },
  data_analysis: {
    name: "data_analysis",
    description: "Analyze structured data and produce numeric summaries or chart-ready series.",
    inputSchema: {
      datasetRef: "string",
      task: "string"
    }
  },
  image_generation: {
    name: "image_generation",
    description: "Generate or edit images from a prompt and optional style constraints.",
    inputSchema: {
      prompt: "string",
      style: "string?"
    }
  }
};

export function getToolsByNames(names: string[]): ToolDefinition[] {
  return names
    .map((name) => toolRegistry[name])
    .filter((tool): tool is ToolDefinition => Boolean(tool));
}

