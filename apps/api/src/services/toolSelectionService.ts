import type { ChatRequest, ToolOptions } from "@persona/shared";
import OpenAI from "openai";
import { env } from "../config/env.js";

const WEB_PATTERN =
  /\b(latest|current|today|tonight|right now|recent|news|weather|score|standings|schedule|price|stock|market|president|ceo|search|look up|browse|online|verify|fact[- ]?check|source|cite|citation|202[4-9]|203\d)\b/i;
const EXTERNAL_FACT_PATTERN =
  /\b(first[- ]?week sales|album sales|sales numbers|box office|chart position|released this year|last album|new album|latest album|discography|ranking|ranked|winner|won|record|announcement|available|availability)\b/i;
const ANALYSIS_PATTERN =
  /\b(calculate|analy[sz]e|dataset|spreadsheet|csv|chart|graph|plot|statistics|average|median|sum|forecast|python|code interpreter|dashboard|visuali[sz]e|table|pivot|export|downloadable|xlsx|excel)\b/i;
const IMAGE_PATTERN =
  /\b(generate|create|make|draw|design|edit|change|remove|replace|recolor|retouch|give|get|show|provide|turn|convert)\b[\s\S]{0,80}\b(image|photo|picture|poster|logo|art|illustration|avatar|thumbnail|banner|flyer)\b/i;
const FILE_SEARCH_PATTERN =
  /\b(document|file|pdf|report|contract|manual|notes|uploaded|attachment)\b/i;
const FILE_OUTPUT_PATTERN =
  /\b(export|download|downloadable|save|make|create|give|provide)\b[\s\S]{0,80}\b(file|csv|spreadsheet|xlsx|excel|pdf|document|json)\b/i;

const defaults: ToolOptions = {
  webSearch: false,
  fileSearch: false,
  codeInterpreter: false,
  imageGeneration: false,
  appFunctions: true,
  background: false,
  vectorStoreIds: []
};

type RouterDecision = {
  webSearch?: boolean;
  fileSearch?: boolean;
  codeInterpreter?: boolean;
  imageGeneration?: boolean;
  background?: boolean;
};

function mergeTools(explicit: ToolOptions, decision: RouterDecision): ToolOptions {
  return {
    ...explicit,
    webSearch: explicit.webSearch || decision.webSearch === true,
    fileSearch: explicit.fileSearch || decision.fileSearch === true,
    codeInterpreter: explicit.codeInterpreter || decision.codeInterpreter === true,
    imageGeneration: explicit.imageGeneration || decision.imageGeneration === true,
    background: explicit.background || decision.background === true,
    appFunctions: true
  };
}

function deterministicDecision(request: ChatRequest): RouterDecision {
  const hasFiles = request.attachments?.some((attachment) => attachment.kind === "file") ?? false;
  const hasImages = request.attachments?.some((attachment) => attachment.kind === "image") ?? false;

  return {
    webSearch: shouldEnableWebSearchForMessage(request.message),
    fileSearch: hasFiles && FILE_SEARCH_PATTERN.test(request.message),
    codeInterpreter: ANALYSIS_PATTERN.test(request.message) || FILE_OUTPUT_PATTERN.test(request.message) || (hasFiles && ANALYSIS_PATTERN.test(request.message)),
    imageGeneration: IMAGE_PATTERN.test(request.message) || (hasImages && /\b(edit|change|remove|replace|recolor|retouch|put|add|turn|make)\b/i.test(request.message))
  };
}

export function shouldEnableWebSearchForMessage(message: string): boolean {
  return WEB_PATTERN.test(message) || EXTERNAL_FACT_PATTERN.test(message);
}

function shouldUseModelRouter(request: ChatRequest, tools: ToolOptions): boolean {
  if (request.provider !== "openai" && request.provider !== "openai_persona") return false;
  if (!env.OPENAI_TOOL_ROUTER_ENABLED || !env.OPENAI_API_KEY) return false;
  if (env.NODE_ENV === "test" && !env.OPENAI_RUN_INTEGRATION_TESTS) return false;
  if (tools.webSearch || tools.fileSearch || tools.codeInterpreter || tools.imageGeneration) return false;

  return request.message.trim().length >= 8;
}

async function routeWithOpenAI(request: ChatRequest): Promise<RouterDecision> {
  const client = new OpenAI({
    apiKey: env.OPENAI_API_KEY,
    timeout: Math.min(env.OPENAI_REQUEST_TIMEOUT_MS, 20000),
    maxRetries: 0
  });
  const attachmentSummary = (request.attachments ?? [])
    .map((attachment) => `${attachment.kind}:${attachment.mimeType}:${attachment.fileName}`)
    .join(", ") || "none";
  const response = await client.chat.completions.create({
    model: env.OPENAI_TOOL_ROUTER_MODEL,
    messages: [
      {
        role: "system",
        content:
          "You are a strict tool router for a ChatGPT-like app. Decide which tools should be enabled for the user's next request. Return only compact JSON with booleans: webSearch, fileSearch, codeInterpreter, imageGeneration, background. Enable webSearch for current/recent/external facts, citations, verification, news, prices, sports, weather, or public web lookup. Enable codeInterpreter for calculations, charts, dashboards, tables, CSV/spreadsheets, data analysis, generated downloadable files, or transforming data into visual/file outputs. Enable imageGeneration for generating, creating, showing, providing, drawing, designing, or editing images/photos/posters/logos/art. Enable fileSearch only when uploaded documents/files need semantic search. Keep tools false for ordinary chat, writing, summarization without files, or style-only requests."
      },
      {
        role: "user",
        content: `Message: ${request.message}\nAttachments: ${attachmentSummary}`
      }
    ],
    response_format: { type: "json_object" },
    max_completion_tokens: 120
  } as any);
  const content = response.choices[0]?.message?.content ?? "{}";
  const parsed = JSON.parse(content) as RouterDecision;

  return {
    webSearch: parsed.webSearch === true,
    fileSearch: parsed.fileSearch === true,
    codeInterpreter: parsed.codeInterpreter === true,
    imageGeneration: parsed.imageGeneration === true,
    background: parsed.background === true
  };
}

export async function selectTools(request: ChatRequest): Promise<ChatRequest> {
  if (request.provider !== "openai" && request.provider !== "openai_persona") return request;
  const explicit = request.toolOptions ?? defaults;
  const deterministic = deterministicDecision(request);
  let toolOptions = mergeTools(explicit, deterministic);

  if (shouldUseModelRouter(request, toolOptions)) {
    try {
      toolOptions = mergeTools(toolOptions, await routeWithOpenAI(request));
    } catch {
      // Deterministic routing is the fallback; router failure should not block chat.
    }
  }

  return { ...request, toolOptions };
}
