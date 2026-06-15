import type { ClientContext, ToolDefinition, ToolName } from "@persona/shared";
import { z } from "zod";

const toolRegistry: Partial<Record<ToolName, ToolDefinition>> = {
  web_search: {
    name: "web_search",
    description: "Search the web for current information and return a concise result set.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    owner: "openai"
  },
  file_search: {
    name: "file_search",
    description: "Search indexed files or uploaded documents for relevant text.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    owner: "openai"
  },
  data_analysis: {
    name: "data_analysis",
    description: "Analyze structured data and produce numeric summaries or chart-ready series.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    owner: "openai"
  },
  image_generation: {
    name: "image_generation",
    description: "Generate or edit images from a prompt and optional style constraints.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    owner: "openai"
  },
  current_time: {
    name: "current_time",
    description: "Return the current date and time using the user's provided locale and time zone.",
    inputSchema: {
      type: "object",
      properties: {
        timeZone: { type: "string", description: "An IANA time zone such as America/Chicago." }
      },
      required: ["timeZone"],
      additionalProperties: false
    },
    owner: "application"
  }
};

export function getToolsByNames(names: string[]): ToolDefinition[] {
  return names
    .map((name) => toolRegistry[name as ToolName])
    .filter((tool): tool is ToolDefinition => Boolean(tool));
}

const currentTimeArgumentsSchema = z.object({
  timeZone: z.string().optional()
});

export async function executeApplicationTool(
  name: string,
  rawArguments: unknown,
  clientContext?: ClientContext
): Promise<unknown> {
  if (name !== "current_time") {
    throw new Error(`Application tool is not registered: ${name}`);
  }

  const arguments_ = currentTimeArgumentsSchema.parse(rawArguments);
  const timeZone = arguments_.timeZone ?? clientContext?.timeZone ?? "UTC";
  const date = clientContext?.currentDateTime ? new Date(clientContext.currentDateTime) : new Date();

  return {
    iso: date.toISOString(),
    timeZone,
    locale: clientContext?.locale ?? "en-US",
    formatted: new Intl.DateTimeFormat(clientContext?.locale ?? "en-US", {
      timeZone,
      dateStyle: "full",
      timeStyle: "long"
    }).format(date)
  };
}
