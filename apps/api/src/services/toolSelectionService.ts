import type { ChatRequest, ToolOptions } from "@persona/shared";
import OpenAI from "openai";
import { env } from "../config/env.js";
import { containsHttpUrl, extractYouTubeVideoUrls } from "./urlInputService.js";
import { inferVisualIntent, shouldUseConversationMediaContext } from "./conversationMediaContext.js";

const WEB_SEARCH_PATTERNS = [
  /\b(search|look up|lookup|browse|google|find online|check online|on the web|from the web|internet|web search)\b/i,
  /\b(latest|current|currently|today|tonight|right now|live|breaking|recent|recently|newest|most recent|upcoming|this week|this month|this year|last year|as of)\b/i,
  /\b(news|headline|weather|forecast|temperature|traffic|flight status|delay|closure|outage|recall|alert)\b/i,
  /\b(score|scores|standings|schedule|fixture|results?|box score|roster|lineup|injury report|depth chart|playoffs?|tournament|draft|trade|free agent)\b/i,
  /\b(last|previous|most recent)\s+(game|match|race|fight|season|appearance|start|episode|release|event)\b/i,
  /\b(official event|event results?|top\s*\d+|qualifiers?|finalists?|champion|championship|finals)\b/i,
  /\b(how many|what|who)\b[\s\S]{0,100}\b(points|goals|runs|rebounds|assists|yards|hits|strikeouts|stats?|votes|seats|medals)\b/i,
  /\b(price|pricing|cost|stock|share price|market cap|market|exchange rate|interest rate|mortgage rate|inflation|cpi|gdp|unemployment|earnings|revenue)\b/i,
  /\b(president|prime minister|governor|mayor|ceo|cfo|cto|chairperson|senator|representative|office holder|election|polls?|approval rating)\b/i,
  /\b(law|laws|legal requirement|regulation|regulations|rule change|policy change|tax rate|visa requirement|travel advisory|entry requirement)\b/i,
  /\b(release date|released|launch date|announcement|announced|available|availability|in stock|sold out|specs?|version|update|changelog|supported|compatibility)\b/i,
  /\b(first[- ]?week sales|album sales|sales numbers|box office|chart position|discography|ranking|ranked|winner|won|record holder)\b/i,
  /\b(recommend|recommendation|best|top rated|reviews?|compare prices|near me|nearby|restaurant|hotel|flight|vacation|trip|travel plan)\b/i,
  /\b(verify|confirm|fact[- ]?check|citation|citations|cite|source|sources|reference|references|evidence|proof)\b/i,
  /\b20(?:2[4-9]|[3-9]\d)\b/
];

const ANALYSIS_PATTERNS = [
  /\b(calculate|compute|solve|evaluate|estimate|measure|quantify|count|total|sum|average|mean|median|mode|percent|percentage|ratio|variance|standard deviation|correlation|regression)\b/i,
  /\b(growth|conversion|success|failure|error|response|retention|churn)\s+rate\b/i,
  /\b(analy[sz]e|analysis|inspect data|explore data|data set|dataset|statistics|statistical|outlier|forecast|projection|simulation)\b/i,
  /\b(trend|pattern|model|scenario)\b[\s\S]{0,60}\b(data|dataset|numbers?|financial|statistical|forecast|projection)\b/i,
  /\b(chart|graph|plot|visuali[sz]e|dashboard|histogram|scatter plot|pie chart|bar chart|line chart|heatmap|pivot|table)\b/i,
  /\b(python|code interpreter|run code|execute code|notebook|dataframe|pandas|numpy)\b/i,
  /\b(sort|filter|group|aggregate|merge|join|deduplicate|clean|normalize|transform|convert)\b[\s\S]{0,80}\b(data|rows?|columns?|csv|spreadsheet|workbook|json|file)\b/i,
  /\b(csv|tsv|xlsx|excel|spreadsheet|workbook)\b[\s\S]{0,80}\b(analy[sz]e|calculate|chart|graph|summari[sz]e|compare|transform|clean)\b/i
];

const IMAGE_GENERATION_PATTERNS = [
  /\b(generate|create|make|draw|design|render|illustrate|paint|sketch|produce|show|give|provide)\b[\s\S]{0,100}\b(image|photo|picture|portrait|poster|logo|art|artwork|illustration|avatar|thumbnail|banner|flyer|wallpaper|icon|graphic|mockup|meme|sticker)\b/i,
  /\b(image|photo|picture|portrait|poster|logo|art|artwork|illustration|avatar|thumbnail|banner|flyer|wallpaper|icon|graphic|mockup|meme|sticker)\b[\s\S]{0,100}\b(of|showing|depicting|with|featuring|in the style|that looks)\b/i,
  /\b(what would|show me what|visuali[sz]e how)\b[\s\S]{0,100}\b(look like|appear|look)\b/i,
  /\b(text to image|image generation|generate an? visual|create an? visual)\b/i
];

const IMAGE_EDIT_PATTERNS = [
  /\b(edit|change|modify|retouch|touch up|enhance|upscale|restore|repair|crop|resize|rotate|flip|remove|erase|replace|swap|add|insert|recolor|colori[sz]e|lighten|darken|blur|unblur|sharpen|extend|outpaint|inpaint|restyle|transform)\b/i,
  /\b(use|reuse|base|reference|match|keep)\b[\s\S]{0,80}\b(this|that|the uploaded|attached|image|photo|picture|visual)\b/i
];

const FILE_SEARCH_PATTERNS = [
  /\b(search|find|look for|locate|retrieve|quote|cite|reference)\b[\s\S]{0,80}\b(document|file|pdf|report|contract|manual|notes|attachment|upload)\b/i,
  /\b(summari[sz]e|review|read|explain|compare|extract|answer from|based on|according to)\b[\s\S]{0,80}\b(document|file|pdf|report|contract|manual|notes|attachment|upload)\b/i,
  /\b(in|from|within|across)\s+(the|this|these|my|attached|uploaded)\s+(document|file|pdf|report|contract|manual|notes|attachment|upload)s?\b/i
];

const NATIVE_VIDEO_ANALYSIS_PATTERNS = [
  /\b(?:watch|inspect|analy[sz]e)\b[\s\S]{0,100}\b(?:video|clip|footage|visuals?)\b/i,
  /\b(?:describe|compare|identify|explain)\b[\s\S]{0,100}\b(?:visuals?|scenes?|frames?|what happens on screen|body language|editing|camera work)\b/i,
  /\b(?:timestamp|timecode|at\s+\d{1,2}:\d{2}|specific scene|shown on screen|visible in the video)\b/i,
  /\b(?:listen to|inspect the audio|sound in|music in|speaker in)\b[\s\S]{0,80}\b(?:video|clip|footage)?\b/i,
  /\b(?:actual|full|deep|frame[- ]by[- ]frame)\s+(?:video|clip|footage|visual|analysis)\b/i
];

function matchesAny(message: string, patterns: RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(message));
}

const defaults: ToolOptions = {
  webSearch: false,
  fileSearch: false,
  codeInterpreter: false,
  imageGeneration: false,
  videoAnalysis: false,
  appFunctions: true,
  background: false,
  vectorStoreIds: []
};

type RouterDecision = {
  webSearch?: boolean;
  fileSearch?: boolean;
  codeInterpreter?: boolean;
  imageGeneration?: boolean;
  videoAnalysis?: boolean;
  videoAnalysisMode?: "auto" | "explicit";
  background?: boolean;
  mediaReference?: "none" | "inspect" | "transform";
};

type MediaReferenceHint = NonNullable<RouterDecision["mediaReference"]>;

// The LLM router is a backstop for phrasing the deterministic patterns miss
// ("ok now remove the sunglasses"); it never overrides a deterministic match.
export function mergeMediaReference(deterministic: MediaReferenceHint, routed?: MediaReferenceHint): MediaReferenceHint {
  return deterministic !== "none" ? deterministic : routed ?? "none";
}

function mergeTools(explicit: ToolOptions, decision: RouterDecision): ToolOptions {
  const videoAnalysisMode = explicit.videoAnalysis
    ? explicit.videoAnalysisMode ?? "explicit"
    : decision.videoAnalysis === true
      ? decision.videoAnalysisMode ?? "auto"
      : explicit.videoAnalysisMode;
  return {
    ...explicit,
    webSearch: explicit.webSearch || decision.webSearch === true,
    fileSearch: explicit.fileSearch || decision.fileSearch === true,
    codeInterpreter: explicit.codeInterpreter || decision.codeInterpreter === true,
    imageGeneration: explicit.imageGeneration || decision.imageGeneration === true,
    videoAnalysis: explicit.videoAnalysis || decision.videoAnalysis === true,
    ...(videoAnalysisMode ? { videoAnalysisMode } : {}),
    background: explicit.background || decision.background === true,
    appFunctions: true
  };
}

function deterministicDecision(request: ChatRequest): RouterDecision {
  const hasFiles = request.attachments?.some((attachment) => attachment.kind === "file") ?? false;
  const hasImages = request.attachments?.some((attachment) => attachment.kind === "image") ?? false;
  const wantsAnalysis = matchesAny(request.message, ANALYSIS_PATTERNS);
  return {
    webSearch: shouldEnableWebSearchForMessage(request.message),
    fileSearch: hasFiles && matchesAny(request.message, FILE_SEARCH_PATTERNS),
    // File construction itself is handled by generate_artifact. Only enable
    // provider code execution when the request also requires real analysis or
    // transformation work.
    codeInterpreter: wantsAnalysis || (hasFiles && wantsAnalysis),
    imageGeneration: matchesAny(request.message, IMAGE_GENERATION_PATTERNS) || (hasImages && matchesAny(request.message, IMAGE_EDIT_PATTERNS)),
    videoAnalysis: extractYouTubeVideoUrls(request.message).length > 0 && matchesAny(request.message, NATIVE_VIDEO_ANALYSIS_PATTERNS),
    videoAnalysisMode: "explicit",
    background: /\b(in the background|background task|take your time|long[- ]running|large dataset|big dataset)\b/i.test(request.message),
    mediaReference: shouldUseConversationMediaContext(request.message)
      ? inferVisualIntent(request.message)
      : "none"
  };
}

export function shouldEnableWebSearchForMessage(message: string): boolean {
  return containsHttpUrl(message) || matchesAny(message, WEB_SEARCH_PATTERNS);
}

function shouldUseModelRouter(request: ChatRequest): boolean {
  if (request.provider !== "openai" && request.provider !== "gemini") return false;
  if (!env.OPENAI_TOOL_ROUTER_ENABLED || !env.OPENAI_API_KEY) return false;
  if (env.NODE_ENV === "test" && !env.OPENAI_RUN_INTEGRATION_TESTS) return false;
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
          "You are a strict tool router for a ChatGPT-like app. Decide every provider-native tool needed for the user's complete request; multiple tools may be true. Return only compact JSON with booleans: webSearch, fileSearch, codeInterpreter, imageGeneration, videoAnalysis, background — plus mediaReference as one of \"none\", \"inspect\", or \"transform\". Set mediaReference to \"transform\" when the user wants to change, edit, restyle, add something to, or remove something from an image generated or attached earlier in the conversation, however phrased (\"remove the sunglasses\", \"take those off\", \"make it brighter\", \"same but different outfit\"); \"inspect\" when they only ask a question about an earlier image's content; and \"none\" when the message stands alone. Enable webSearch whenever the user supplies a public URL or asks about linked content, and for current, recent, changing, external, location-specific, recommendation, product, legal, political, financial, sports, entertainment, weather, citation, verification, or public-web facts. Enable videoAnalysis only when a YouTube URL is present and the user explicitly needs the actual audiovisual content, such as scenes, visuals, timestamps, on-screen details, or audio; metadata, title, captions, or an ordinary summary do not require native video analysis. Enable codeInterpreter for calculations, quantitative reasoning, charts, dashboards, tables, datasets, spreadsheets, data transformations, or any task requiring code execution. Downloadable files are built by a separate application tool, so a simple file-writing request alone does not require codeInterpreter. Enable imageGeneration for creating, rendering, designing, or editing visual media, including edits to attached images. Enable fileSearch only when attached or uploaded documents must be searched, read, compared, quoted, summarized, or used as evidence. Enable background for explicitly long-running work or large analysis/generation tasks. Keep tools false for ordinary conversation, writing, rewriting, brainstorming, or style-only requests that need no external data or artifacts."
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
    videoAnalysis: parsed.videoAnalysis === true,
    videoAnalysisMode: "explicit",
    background: parsed.background === true,
    mediaReference: parsed.mediaReference === "inspect" || parsed.mediaReference === "transform"
      ? parsed.mediaReference
      : "none"
  };
}

export async function selectTools(request: ChatRequest): Promise<ChatRequest> {
  if (request.provider !== "openai" && request.provider !== "gemini") {
    // Never trust a client-supplied hint; it is server-stamped only.
    return { ...request, mediaReferenceHint: undefined };
  }
  const explicit = request.toolOptions ?? defaults;
  const deterministic = deterministicDecision(request);
  let toolOptions = mergeTools(explicit, deterministic);
  let mediaReferenceHint = mergeMediaReference(deterministic.mediaReference ?? "none");

  if (shouldUseModelRouter(request)) {
    try {
      const routed = await routeWithOpenAI(request);
      toolOptions = mergeTools(toolOptions, routed);
      mediaReferenceHint = mergeMediaReference(deterministic.mediaReference ?? "none", routed.mediaReference);
    } catch {
      // Deterministic routing is the fallback; router failure should not block chat.
    }
  }

  return { ...request, toolOptions, mediaReferenceHint };
}
