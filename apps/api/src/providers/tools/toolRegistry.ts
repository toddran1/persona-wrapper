import {
  chartOutputSchema,
  chartToolArgumentsSchema,
  MAX_CHART_CATEGORIES,
  MAX_CHART_DATASETS,
  MAX_DONUT_CATEGORIES,
  type ClientContext,
  type ToolDefinition,
  type ToolName
} from "@persona/shared";
import { z } from "zod";
import { env } from "../../config/env.js";
import { generateArtifact } from "../../services/artifactGenerationService.js";
import { searchPlaces } from "../../services/placesSearchService.js";

const chartAxisProperties = {
  label: { type: "string" },
  dataType: { type: "string", enum: ["category", "date", "number"] }
};

const renderChartInputSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "version",
    "title",
    "chartType",
    "categories",
    "datasets",
    "xAxis",
    "yAxis",
    "summary",
    "sourceNote"
  ],
  properties: {
    version: { type: "integer", enum: [1] },
    title: { type: "string" },
    chartType: { type: "string", enum: ["bar", "line", "area", "scatter", "donut"] },
    categories: {
      type: "array",
      maxItems: MAX_CHART_CATEGORIES,
      items: { type: "string" }
    },
    datasets: {
      type: "array",
      maxItems: MAX_CHART_DATASETS,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "label", "values"],
        properties: {
          id: { type: "string" },
          label: { type: "string" },
          values: {
            type: "array",
            maxItems: MAX_CHART_CATEGORIES,
            items: {
              anyOf: [
                { type: "number" },
                { type: "null" },
                {
                  type: "object",
                  additionalProperties: false,
                  required: ["x", "y", "label"],
                  properties: {
                    x: { type: "number" },
                    y: { type: "number" },
                    label: { anyOf: [{ type: "string" }, { type: "null" }] }
                  }
                }
              ]
            }
          }
        }
      }
    },
    xAxis: {
      type: "object",
      additionalProperties: false,
      required: ["label", "dataType"],
      properties: chartAxisProperties
    },
    yAxis: {
      type: "object",
      additionalProperties: false,
      required: ["label", "format", "currency", "unit"],
      properties: {
        label: { type: "string" },
        format: { type: "string", enum: ["number", "currency", "percent", "duration"] },
        currency: { anyOf: [{ type: "string" }, { type: "null" }] },
        unit: { anyOf: [{ type: "string" }, { type: "null" }] }
      }
    },
    summary: { type: "string" },
    sourceNote: { anyOf: [{ type: "string" }, { type: "null" }] }
  }
};

const artifactScalarInputSchema = {
  anyOf: [{ type: "string" }, { type: "number" }, { type: "boolean" }, { type: "null" }]
};

const generateArtifactInputSchema = {
  type: "object",
  additionalProperties: false,
  required: ["format", "fileName", "title", "description", "content", "sheets", "files"],
  properties: {
    format: { type: "string", enum: ["csv", "tsv", "xlsx", "json", "text", "markdown", "zip"] },
    fileName: { type: "string", description: "A concise download filename. The application corrects the extension." },
    title: { anyOf: [{ type: "string" }, { type: "null" }] },
    description: { anyOf: [{ type: "string" }, { type: "null" }] },
    content: {
      anyOf: [{ type: "string" }, { type: "null" }],
      description: "Text, Markdown, or valid serialized JSON content. Use null for spreadsheets and ZIP files."
    },
    sheets: {
      type: "array",
      maxItems: 10,
      description: "Spreadsheet data. CSV and TSV use the first sheet; XLSX supports multiple sheets.",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["name", "columns", "rows"],
        properties: {
          name: { type: "string" },
          columns: { type: "array", maxItems: 100, items: { type: "string" } },
          rows: {
            type: "array",
            maxItems: 10000,
            items: { type: "array", maxItems: 100, items: artifactScalarInputSchema }
          }
        }
      }
    },
    files: {
      type: "array",
      maxItems: 100,
      description: "Text files to include in a ZIP. Paths must be relative and may not contain traversal segments.",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["path", "content"],
        properties: {
          path: { type: "string" },
          content: { type: "string" }
        }
      }
    }
  }
};

const placesSearchInputSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "query",
    "location",
    "maxResults",
    "openNow",
    "minimumRating",
    "priceLevels",
    "languageCode",
    "regionCode"
  ],
  properties: {
    query: { type: "string", description: "The category, business, service, activity, or place to find." },
    location: {
      anyOf: [{ type: "string" }, { type: "null" }],
      description: "City, neighborhood, address, landmark, or region. Use null only when device location is available or location is unnecessary."
    },
    maxResults: { anyOf: [{ type: "integer", minimum: 1, maximum: 20 }, { type: "null" }] },
    openNow: { anyOf: [{ type: "boolean" }, { type: "null" }] },
    minimumRating: { anyOf: [{ type: "number", minimum: 0, maximum: 5 }, { type: "null" }] },
    priceLevels: {
      type: "array",
      maxItems: 5,
      items: {
        type: "string",
        enum: [
          "PRICE_LEVEL_FREE",
          "PRICE_LEVEL_INEXPENSIVE",
          "PRICE_LEVEL_MODERATE",
          "PRICE_LEVEL_EXPENSIVE",
          "PRICE_LEVEL_VERY_EXPENSIVE"
        ]
      }
    },
    languageCode: { anyOf: [{ type: "string" }, { type: "null" }] },
    regionCode: { anyOf: [{ type: "string" }, { type: "null" }] }
  }
};

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
  render_chart: {
    name: "render_chart",
    description:
      `Render a validated, accessible chart in the chat UI. Use this after determining the exact numeric values. Use raw numbers, keep labels and units explicit, summarize the main takeaway, and never put formatted number strings in dataset values. Supply 1-${MAX_CHART_DATASETS} datasets and no more than ${MAX_CHART_CATEGORIES} categories or total scatter points. Donut charts require one dataset, non-negative values, and no more than ${MAX_DONUT_CATEGORIES} categories. Currency axes require an ISO 4217 code and duration axes require a unit.`,
    inputSchema: renderChartInputSchema,
    owner: "application"
  },
  generate_artifact: {
    name: "generate_artifact",
    description:
      "Create a real downloadable CSV, TSV, XLSX workbook, JSON, text, Markdown, or ZIP file through the application's provider-independent artifact service. Use this whenever the user asks for a downloadable file. Do not claim a file was created unless this function succeeds. Use sheets for spreadsheet formats, content for JSON/text/Markdown, and files for ZIP archives.",
    inputSchema: generateArtifactInputSchema,
    owner: "application"
  },
  places_search: {
    name: "places_search",
    description:
      "Search Google Maps-backed place data for current local recommendations such as restaurants, stores, attractions, venues, and services. Ask for the user's city or area when neither an explicit location nor device location is available. Base recommendations only on returned results and include each useful Google Maps link. Never invent ratings, hours, prices, or availability.",
    inputSchema: placesSearchInputSchema,
    owner: "application"
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
    .filter((tool): tool is ToolDefinition => {
      if (!tool) return false;
      if (tool.name === "places_search") {
        return env.PLACES_SEARCH_ENABLED && Boolean(env.GOOGLE_MAPS_API_KEY);
      }
      return true;
    });
}

const currentTimeArgumentsSchema = z.object({
  timeZone: z.string().optional()
});

export async function executeApplicationTool(
  name: string,
  rawArguments: unknown,
  clientContext?: ClientContext
): Promise<unknown> {
  if (name === "render_chart") {
    const chart = chartToolArgumentsSchema.parse(rawArguments);
    const firstDataset = chart.datasets[0];
    const legacySeries = firstDataset && chart.chartType !== "scatter"
      ? chart.categories.flatMap((label, index) => {
        const value = firstDataset.values[index];
        return typeof value === "number" ? [{ label, value }] : [];
      })
      : [];

    return chartOutputSchema.parse({
      type: "chart",
      ...chart,
      series: legacySeries
    });
  }

  if (name === "current_time") {
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

  if (name === "generate_artifact") {
    return generateArtifact(rawArguments);
  }

  if (name === "places_search") {
    return searchPlaces(rawArguments, clientContext);
  }

  throw new Error(`Application tool is not registered: ${name}`);
}
