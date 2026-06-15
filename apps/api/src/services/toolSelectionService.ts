import type { ChatRequest, ToolOptions } from "@persona/shared";

const WEB_PATTERN =
  /\b(latest|current|today|tonight|right now|recent|news|weather|score|standings|schedule|price|stock|market|president|ceo|search|look up|browse|online|202[4-9]|203\d)\b/i;
const ANALYSIS_PATTERN =
  /\b(calculate|analy[sz]e|dataset|spreadsheet|csv|chart|graph|plot|statistics|average|median|sum|forecast|python|code interpreter)\b/i;
const IMAGE_PATTERN =
  /\b(generate|create|make|draw|design|edit|change|remove|replace|recolor|retouch)\b[\s\S]{0,40}\b(image|photo|picture|poster|logo|art|illustration)\b/i;
const FILE_SEARCH_PATTERN =
  /\b(document|file|pdf|report|contract|manual|notes|uploaded|attachment)\b/i;

const defaults: ToolOptions = {
  webSearch: false,
  fileSearch: false,
  codeInterpreter: false,
  imageGeneration: false,
  appFunctions: true,
  background: false,
  vectorStoreIds: []
};

export function selectTools(request: ChatRequest): ChatRequest {
  if (request.provider !== "openai") return request;
  const explicit = request.toolOptions ?? defaults;
  const hasFiles = request.attachments?.some((attachment) => attachment.kind === "file") ?? false;
  const hasImages = request.attachments?.some((attachment) => attachment.kind === "image") ?? false;

  return {
    ...request,
    toolOptions: {
      ...explicit,
      webSearch: explicit.webSearch || WEB_PATTERN.test(request.message),
      fileSearch: explicit.fileSearch || (hasFiles && FILE_SEARCH_PATTERN.test(request.message)),
      codeInterpreter: explicit.codeInterpreter || (hasFiles && ANALYSIS_PATTERN.test(request.message)),
      imageGeneration: explicit.imageGeneration || IMAGE_PATTERN.test(request.message) || (hasImages && /\bedit|change|remove|replace|recolor|retouch\b/i.test(request.message)),
      appFunctions: true
    }
  };
}
