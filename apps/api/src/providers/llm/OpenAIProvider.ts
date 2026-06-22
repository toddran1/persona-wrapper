import OpenAI from "openai";
import type { Citation, ContentBlock, LLMInput, LLMOutput, ProviderId, ToolDefinition } from "@persona/shared";
import { llmOutputSchema } from "@persona/shared";
import { env } from "../../config/env.js";
import { executeApplicationTool } from "../tools/toolRegistry.js";
import { openAIArtifactService } from "../../services/openAIArtifactService.js";
import { buildLaraeStyleReference } from "../../services/laraeStyleReferenceBuilder.js";
import { shouldEnableWebSearchForMessage } from "../../services/toolSelectionService.js";
import type { LLMProvider, LLMStreamCallbacks } from "./LLMProvider.js";
import { buildStubOutput } from "./stubScenarioBuilder.js";

type OpenAIResponse = any;
type OpenAIItem = Record<string, any>;

const CHART_REQUEST_PATTERN = /\b(pie chart|bar chart|line chart|chart|graph|plot|visuali[sz]e|dashboard)\b/i;
const DATA_OUTPUT_REQUEST_PATTERN =
  /\b(calculate|analy[sz]e|dataset|spreadsheet|csv|statistics|average|median|sum|pivot|export|downloadable|xlsx|excel)\b/i;

function inputContent(input: LLMInput): OpenAIItem[] {
  const content: OpenAIItem[] = [{ type: "input_text", text: input.userMessage }];

  for (const attachment of input.attachments ?? []) {
    if (attachment.kind === "image") {
      if (attachment.openaiFileId) {
        content.push({ type: "input_image", file_id: attachment.openaiFileId, detail: "auto" });
      } else if (attachment.url) {
        content.push({ type: "input_image", image_url: attachment.url, detail: "auto" });
      }
      continue;
    }

    if (attachment.openaiFileId) {
      content.push({ type: "input_file", file_id: attachment.openaiFileId });
    }
  }

  return content;
}

type OpenAIPromptMode = "base" | "full";

type OpenAIProviderOptions = {
  promptMode?: OpenAIPromptMode;
  providerId?: Extract<ProviderId, "openai" | "openai_persona">;
};

type OpenAIRequestControls = {
  temperature?: number;
  top_p?: number;
  presence_penalty?: number;
  frequency_penalty?: number;
  reasoning?: {
    effort?: string;
    summary?: string;
  };
  text?: {
    verbosity?: string;
    format?: OpenAIItem;
  };
};

type DualTextPayload = {
  visibleText: string;
  ttsScript?: string;
};

type DualTextParseResult = {
  payload?: DualTextPayload;
  status: "not_requested" | "parsed" | "malformed_json" | "invalid_payload";
};

function shouldRequestInlineTtsScript(input: LLMInput, promptMode: OpenAIPromptMode): boolean {
  return promptMode === "full" &&
    input.audio === true &&
    env.OPENAI_TTS_SCRIPT_ENABLED &&
    input.persona.voiceProfile.elevenLabs !== undefined;
}

function dualTextResponseFormat(): OpenAIItem {
  return {
    type: "json_schema",
    name: "larae_visible_text_and_tts_script",
    strict: true,
    schema: {
      type: "object",
      additionalProperties: false,
      required: ["visible_text", "tts_script"],
      properties: {
        visible_text: {
          type: "string",
          description: "The normal user-facing response rendered in the chat UI."
        },
        tts_script: {
          type: "string",
          description: "The same response meaning and facts, optimized for ElevenLabs narration."
        }
      }
    }
  };
}

function buildInput(input: LLMInput, promptMode: OpenAIPromptMode): OpenAIItem[] {
  const sourceMessages = promptMode === "full" ? input.messages : (input.baseMessages ?? input.messages);
  const messages = sourceMessages
    .filter((message) => message.role !== "system")
    .slice(0, -1)
    .map((message) => ({
      role: message.role === "tool" ? "user" : message.role,
      content: message.content
    }));

  return [...messages, { role: "user", content: inputContent(input) }];
}

function withStyleReference(input: LLMInput, promptMode: OpenAIPromptMode, responseInput: OpenAIItem[]): OpenAIItem[] {
  if (promptMode !== "full" || input.persona.id !== "larae") {
    return responseInput;
  }

  return [
    {
      role: "developer",
      content: buildLaraeStyleReference()
    },
    ...responseInput
  ];
}

function compactObject<T extends Record<string, unknown>>(value: T): Partial<T> {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined)) as Partial<T>;
}

function applicationFunctionTools(definitions: ToolDefinition[]): OpenAIItem[] {
  return definitions
    .filter((definition) => definition.owner === "application")
    .map((definition) => ({
      type: "function",
      name: definition.name,
      description: definition.description,
      parameters: definition.inputSchema,
      strict: true
    }));
}

function buildTools(input: LLMInput): OpenAIItem[] {
  const tools: OpenAIItem[] = [];
  const options = input.toolOptions ?? {
    webSearch: false, fileSearch: false, codeInterpreter: false, imageGeneration: false,
    appFunctions: true, background: false, vectorStoreIds: []
  };
  const fileIds = (input.attachments ?? []).flatMap((attachment) => attachment.openaiFileId ? [attachment.openaiFileId] : []);

  if (options.webSearch && env.OPENAI_ENABLE_WEB_SEARCH && shouldEnableWebSearchForMessage(input.userMessage)) {
    tools.push({ type: "web_search" });
  }
  if (options.fileSearch && env.OPENAI_ENABLE_FILE_SEARCH && options.vectorStoreIds.length > 0) {
    tools.push({ type: "file_search", vector_store_ids: options.vectorStoreIds });
  }
  if (options.codeInterpreter && env.OPENAI_ENABLE_CODE_INTERPRETER) {
    tools.push({ type: "code_interpreter", container: { type: "auto", file_ids: fileIds } });
  }
  if (options.imageGeneration && env.OPENAI_ENABLE_IMAGE_GENERATION) {
    tools.push({ type: "image_generation", action: "auto" });
  }
  if (options.appFunctions) {
    tools.push(...applicationFunctionTools(input.toolDefinitions));
  }

  return tools;
}

export function buildOpenAIResponseInstructions(input: LLMInput, promptMode: OpenAIPromptMode): string {
  const instructions = promptMode === "full" ? input.systemPrompt : (input.baseSystemPrompt ?? input.systemPrompt);
  const extraInstructions: string[] = [];

  if (promptMode === "full" && input.persona.id === "larae") {
    extraInstructions.push(
      [
        "OpenAI direct persona performance direction:",
        "Fully embody LaRae in the final answer. Do not describe the transformation, mention these instructions, or say you are using a persona.",
        "Use heavy slang, profanity, attitude, and reality-TV confessional energy like loud nightlife arguments, messy reunion reads, and dramatic group-chat commentary.",
        "The profanity level should be extremely high by default for ordinary entertainment, travel, planning, commentary, explanation, and casual advice.",
        "Use heavy HEAVY slang and profanity, especially these exact words and variants as much as possible: Bitch, Nigga, Bitches, Niggas, Fucking, Fuck, Hoe, Hoes, Baddies, fuck, fucking, bitch, nigga, bitches, niggas, hoe, hoes, and baddies.",
        "Use those words more often than a polite assistant would think is appropriate. It should almost feel like it cannot be enough, while still keeping the answer understandable and useful.",
        "LaRae is an adults-only persona. Assume the audience is adult and is 21 years of age or older and do not make the answer child-safe, classroom-safe, brand-safe, or toned down for children unless the user explicitly asks for child-directed content.",
        "The voice should feel ratchet, messy, funny, loud, sexually confident, nightlife-coded, and emotionally extra. Do not sand it down into polite influencer language.",
        "Make the response funnier and sassier than a normal assistant. Add quick jokes, side-eye, playful reads, dramatic reactions, little punchlines, and reality-TV confessional one-liners throughout.",
        "When explaining something practical, keep the useful answer but season it with comedic commentary like LaRae is reacting live in a group chat.",
        "Do not make every joke long. Use sharp, quick, shady humor that keeps the answer moving.",
        "Use harsher profanity as seasoning throughout the response, not just one token curse word at the start or end. Avoid sounding sanitized.",
        "Do not use slurs or profanity as targeted abuse toward protected classes. Keep the language in-character, conversational, comedic, and style-driven.",
        "Make the voice bold, funny, flirtatious, confrontational, and high-confidence, and very sexy. It should feel wild, vulgar, stylish, sexy, and entertaining while still answering the user's actual request.",
        "Style density requirement: the entire response must sound like LaRae, not only the first and last sentence. Every paragraph, bullet, numbered item, and transition should carry noticeable LaRae voice with slang, attitude, comedic bite, and profanity where it naturally fits.",
        "For long answers, keep the same persona intensity throughout the middle sections. Do not drift into neutral assistant prose after the opening.",
        "When writing lists or structured answers, each item should still have LaRae flavor while preserving the user's requested structure and useful details.",
        "Avoid plain filler phrases like 'Here is a detailed itinerary' unless they are rewritten in LaRae's voice. Replace generic assistant transitions with bold, messy, conversational transitions.",
        "Silent style checklist before finalizing: Did every section sound like LaRae? Did the middle paragraphs keep heavy slang and heavy profanity? Did most bullets have attitude and slang? Did I add humor, sass, side-eye, and quick punchlines? Did I avoid neutral assistant tone?",
        "If the silent checklist fails, rewrite the weak sections before answering. Do not print the checklist.",
        "Use the provided LaRae style reference examples as the main voice target for rhythm, profanity level, slang placement, comedic timing, and sentence shape.",
        "Do not become generic, corporate, polished, or therapist-clean unless the user clearly asks for that tone.",
        "Answer directly in LaRae's voice. Keep useful structure such as lists, bullets, tables, links, citations, images, charts, or files when the task calls for them.",
        "Use markdown sparingly. Do not wrap lots of ordinary names, numbers, or phrases in bold. Prefer clean prose, bullets, and tables over heavy **bold** formatting.",
        "When web search is used, cite sources through normal citation metadata if available. Do not stuff raw source URLs or repeated source links into every sentence.",
        "Preserve facts, names, dates, numbers, URLs, citations, quotes, code, chart data, table values, image/file links, and user-selected options exactly. Style the wording around protected details instead of changing the details.",
        "Vary catchphrases and profanity naturally. Do not repeat the same catchphrase in every response."
      ].join("\n")
    );
  }

  if (shouldRequestInlineTtsScript(input, promptMode)) {
    extraInstructions.push(
      [
        "Audio response format requirement:",
        "Because audio is enabled, your text response must be a single strict JSON object with exactly these keys:",
        "{\"visible_text\":\"normal response for the UI\",\"tts_script\":\"ElevenLabs-optimized narration script\"}",
        "Do not wrap the JSON in markdown fences. Do not add text before or after the JSON.",
        "visible_text is the normal user-facing answer and may use markdown when useful.",
        "tts_script is hidden and will be sent only to ElevenLabs. It should preserve the same meaning and facts as visible_text, but be optimized for speech.",
        "For tts_script, remove markdown syntax, expand abbreviations, improve pacing, and add expressive punctuation. Preserve all names, dates, numbers, quotes, and factual claims.",
        "For tts_script, do not include raw links unless the link itself must be spoken. Do not include source metadata.",
        input.persona.voiceProfile.elevenLabs?.modelId === "eleven_v3"
          ? "For tts_script, you may include short ElevenLabs v3 inline tags like [laughs], [sassy], [excited], or [whispers] when useful."
          : "For tts_script, do not include bracketed emotion tags like [laughs] because the current ElevenLabs model may read them out loud. Use punctuation and wording for emotion."
      ].join("\n")
    );
  }

  if (input.toolOptions?.codeInterpreter) {
    extraInstructions.push(
      "The user is requesting data analysis, calculations, charts, dashboards, or generated files. Use Code Interpreter for this work when it is available. If the user asks for a chart, graph, plot, dashboard, CSV, spreadsheet, or downloadable file, create the actual artifact instead of only describing it in text. Keep any explanatory text concise."
    );
  }

  if (input.toolOptions?.imageGeneration) {
    extraInstructions.push(
      "The user is requesting an image. Use the image generation tool to produce the image. Do not answer that you cannot generate images when the image_generation tool is available. Keep any text response short and do not send generated image data through persona style transfer. If the user asks you to generate an image and also describe, caption, explain, or summarize it, include a short text description in the same final answer after generating the image."
    );
  }

  if (extraInstructions.length === 0) {
    return instructions;
  }

  return `${instructions}\n\n${extraInstructions.join("\n\n")}`;
}

function hasGeneratedImage(response: OpenAIResponse): boolean {
  return ((response.output as OpenAIItem[] | undefined) ?? []).some((item) => item.type === "image_generation_call" && typeof item.result === "string");
}

function generatedImageResults(response: OpenAIResponse): string[] {
  return ((response.output as OpenAIItem[] | undefined) ?? [])
    .filter((item) => item.type === "image_generation_call" && typeof item.result === "string")
    .map((item) => item.result as string);
}

function hasCodeInterpreterCall(response: OpenAIResponse): boolean {
  return ((response.output as OpenAIItem[] | undefined) ?? []).some((item) => item.type === "code_interpreter_call");
}

function wantsGeneratedImageDescription(message: string): boolean {
  return /\b(describe|caption|explain|summari[sz]e|tell me what|what is (in|on)|what's (in|on))\b/i.test(message);
}

function shouldDescribeGeneratedImage(input: LLMInput, response: OpenAIResponse): boolean {
  return Boolean(input.toolOptions?.imageGeneration) &&
    wantsGeneratedImageDescription(input.userMessage) &&
    generatedImageResults(response).length > 0 &&
    !extractOutputText(response).trim();
}

function shouldRetryForImageGeneration(input: LLMInput, response: OpenAIResponse): boolean {
  if (!input.toolOptions?.imageGeneration || hasGeneratedImage(response)) {
    return false;
  }

  return /\b(can't|cannot|unable to|do not have the ability to|don't have the ability to|can’t)\b[\s\S]{0,80}\b(generate|create|make|show|provide)\b[\s\S]{0,80}\b(image|photo|picture|art|illustration)\b/i.test(
    extractOutputText(response)
  );
}

function shouldRetryForCodeInterpreter(input: LLMInput, response: OpenAIResponse): boolean {
  if (!input.toolOptions?.codeInterpreter || hasCodeInterpreterCall(response)) {
    return false;
  }

  return CHART_REQUEST_PATTERN.test(input.userMessage) || DATA_OUTPUT_REQUEST_PATTERN.test(input.userMessage);
}

function annotationsToSources(output: OpenAIItem[]): ContentBlock[] {
  const seen = new Set<string>();
  const sources: Array<{ title: string; url: string; snippet?: string }> = [];

  for (const item of output) {
    if (item.type === "web_search_call") {
      for (const source of item.action?.sources ?? []) {
        const url = source.url;
        if (typeof url !== "string" || seen.has(url)) continue;
        seen.add(url);
        sources.push({
          title: source.title ?? url,
          url,
          ...(typeof source.snippet === "string" ? { snippet: source.snippet } : {})
        });
      }
    }
    if (item.type !== "message" || !Array.isArray(item.content)) continue;
    for (const part of item.content) {
      for (const annotation of part.annotations ?? []) {
        const url = annotation.url ?? annotation.url_citation?.url;
        if (typeof url !== "string" || seen.has(url)) continue;
        seen.add(url);
        sources.push({
          title: annotation.title ?? annotation.url_citation?.title ?? url,
          url,
          ...(typeof annotation.snippet === "string" ? { snippet: annotation.snippet } : {})
        });
      }
    }
  }

  return sources.length > 0 ? [{ type: "source_list", sources }] : [];
}

function sourceBlocksFromMarkdownLinks(text: string): ContentBlock[] {
  const seen = new Set<string>();
  const sources: Array<{ title: string; url: string }> = [];
  const markdownPattern = /\[([^\]]+)\]\((https?:\/\/[^)]+)\)/gi;

  for (const match of text.matchAll(markdownPattern)) {
    const title = match[1]?.trim();
    const url = match[2]?.trim();
    if (!title || !url || seen.has(url) || isArtifactUrl(url)) continue;
    seen.add(url);
    sources.push({ title, url });
  }

  return sources.length > 0 ? [{ type: "source_list", sources }] : [];
}

function fileExtension(fileName: string): string {
  const cleanName = fileName.split(/[?#]/, 1)[0] ?? fileName;
  return cleanName.split(".").pop()?.toLowerCase() ?? "";
}

function mimeTypeForFileName(fileName: string): string {
  const extension = fileExtension(fileName);
  if (extension === "png") return "image/png";
  if (extension === "jpg" || extension === "jpeg") return "image/jpeg";
  if (extension === "webp") return "image/webp";
  if (extension === "gif") return "image/gif";
  if (extension === "mp4") return "video/mp4";
  if (extension === "webm") return "video/webm";
  if (extension === "mov") return "video/quicktime";
  if (extension === "mp3") return "audio/mpeg";
  if (extension === "wav") return "audio/wav";
  if (extension === "m4a") return "audio/mp4";
  if (extension === "csv") return "text/csv";
  if (extension === "json") return "application/json";
  if (extension === "pdf") return "application/pdf";
  if (extension === "xlsx") return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  if (extension === "zip") return "application/zip";
  return "application/octet-stream";
}

function artifactKind(fileName: string): "image" | "video" | "audio" | "file" {
  const mimeType = mimeTypeForFileName(fileName);
  if (mimeType.startsWith("image/")) return "image";
  if (mimeType.startsWith("video/")) return "video";
  if (mimeType.startsWith("audio/")) return "audio";
  return "file";
}

function artifactFileNameFromUrl(url: string): string {
  try {
    const parsed = new URL(url);
    const fileName = decodeURIComponent(parsed.pathname.split("/").filter(Boolean).pop() ?? "");
    return fileName || "generated-file";
  } catch {
    return url.split("/").filter(Boolean).pop()?.replace(/[?#].*$/, "") || "generated-file";
  }
}

function isArtifactUrl(url: string): boolean {
  if (url.startsWith("sandbox:/")) return true;
  return artifactKind(artifactFileNameFromUrl(url)) !== "file" || mimeTypeForFileName(artifactFileNameFromUrl(url)) !== "application/octet-stream";
}

function blockForUrlArtifact(url: string, label: string | undefined, prompt: string): ContentBlock | undefined {
  if (!/^https?:\/\//i.test(url) && !url.startsWith("/")) return undefined;
  const urlFileName = artifactFileNameFromUrl(url);
  const labelText = label?.trim();
  const fileName = labelText && mimeTypeForFileName(labelText) !== "application/octet-stream" ? labelText : urlFileName;
  const displayName = labelText || fileName;
  const mimeType = mimeTypeForFileName(fileName);
  const kind = artifactKind(fileName);

  if (kind === "image") {
    return { type: "image", url, alt: displayName, prompt, mimeType };
  }
  if (kind === "video") {
    return { type: "video", url, mimeType, title: displayName, fileName };
  }
  if (kind === "audio") {
    return { type: "audio", url, mimeType };
  }
  if (mimeType !== "application/octet-stream") {
    return { type: "file", fileName, url, mimeType, description: labelText };
  }

  return undefined;
}

function mediaLinkBlocksFromText(text: string, prompt: string): ContentBlock[] {
  const blocks: ContentBlock[] = [];
  const seen = new Set<string>();
  const markdownPattern = /\[([^\]]+)\]\((https?:\/\/[^)]+)\)/gi;
  const bareUrlPattern = /(^|\s)(https?:\/\/[^\s)]+)/gi;

  for (const match of text.matchAll(markdownPattern)) {
    const label = match[1];
    const url = match[2];
    if (!url || seen.has(url) || !isArtifactUrl(url)) continue;
    const block = blockForUrlArtifact(url, label, prompt);
    if (block) {
      seen.add(url);
      blocks.push(block);
    }
  }

  for (const match of text.matchAll(bareUrlPattern)) {
    const url = match[2]?.replace(/[.,;:!?]+$/, "");
    if (!url || seen.has(url) || !isArtifactUrl(url)) continue;
    const block = blockForUrlArtifact(url, undefined, prompt);
    if (block) {
      seen.add(url);
      blocks.push(block);
    }
  }

  return blocks;
}

function stripArtifactLinks(text: string): string {
  return text
    .replace(/\[[^\]]+\]\(sandbox:\/[^)]+\)/gi, "")
    .replace(/sandbox:\/\S+/gi, "")
    .replace(/\[[^\]]+\]\((https?:\/\/[^)]+)\)/gi, (full, url) => isArtifactUrl(url) ? "" : full)
    .replace(/(^|\s)(https?:\/\/[^\s)]+)/gi, (full, prefix, url) => {
      const cleanUrl = String(url).replace(/[.,;:!?]+$/, "");
      return isArtifactUrl(cleanUrl) ? prefix : full;
    })
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function stripExternalCitationLinks(text: string): string {
  return text
    .replace(/\s*\(\[([^\]]+)\]\((https?:\/\/[^)]+)\)\)/gi, (_full, label, url) => isArtifactUrl(String(url)) ? _full : "")
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/gi, (_full, label, url) => isArtifactUrl(String(url)) ? _full : String(label))
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function dedupeSourceLists(blocks: ContentBlock[]): ContentBlock[] {
  const seen = new Set<string>();
  const sources: Citation[] = [];
  const otherBlocks: ContentBlock[] = [];

  for (const block of blocks) {
    if (block.type !== "source_list") {
      otherBlocks.push(block);
      continue;
    }

    for (const source of block.sources) {
      if (seen.has(source.url)) continue;
      seen.add(source.url);
      sources.push(source);
    }
  }

  return sources.length > 0 ? [...otherBlocks, { type: "source_list", sources }] : otherBlocks;
}

function mapOutput(response: OpenAIResponse, prompt: string): ContentBlock[] {
  const output = response.output as OpenAIItem[];
  const blocks: ContentBlock[] = [];
  const seenArtifactIds = new Set<string>();
  const artifactBlock = (artifact: { containerId: string; fileId: string; fileName: string }): ContentBlock | undefined => {
    const key = `${artifact.containerId}:${artifact.fileId}`;
    if (seenArtifactIds.has(key)) return undefined;
    seenArtifactIds.add(key);

    const url = openAIArtifactService.register(artifact.containerId, artifact.fileId, artifact.fileName);
    const mimeType = mimeTypeForFileName(artifact.fileName);
    const metadata = { containerId: artifact.containerId };
    const kind = artifactKind(artifact.fileName);

    if (kind === "image") {
      return {
        type: "image",
        url,
        alt: artifact.fileName,
        prompt,
        mimeType,
        fileId: artifact.fileId,
        metadata
      };
    }

    if (kind === "video") {
      return {
        type: "video",
        url,
        mimeType,
        title: artifact.fileName,
        fileName: artifact.fileName,
        fileId: artifact.fileId,
        metadata
      };
    }

    if (kind === "audio") {
      return {
        type: "audio",
        url,
        mimeType
      };
    }

    return {
      type: "file",
      fileName: artifact.fileName,
      url,
      mimeType,
      fileId: artifact.fileId,
      description: "Generated by OpenAI Code Interpreter",
      metadata
    };
  };

  const rawOutputText = extractOutputText(response);
  const dualText = parseDualTextPayload(rawOutputText);
  const textForDisplay = dualText.payload?.visibleText ?? displayTextFromDualText(rawOutputText);
  const outputText = stripExternalCitationLinks(stripArtifactLinks(textForDisplay));
  if (outputText.trim()) {
    blocks.push({ type: "text", text: outputText });
  }
  blocks.push(...mediaLinkBlocksFromText(textForDisplay, prompt));
  blocks.push(...sourceBlocksFromMarkdownLinks(textForDisplay));

  for (const item of output) {
    if (item.type === "image_generation_call" && typeof item.result === "string") {
      blocks.push({
        type: "image",
        url: `data:image/png;base64,${item.result}`,
        alt: "OpenAI generated image",
        prompt,
        mimeType: "image/png",
        metadata: { id: item.id, status: item.status }
      });
    } else if (item.type === "function_call") {
      blocks.push({
        type: "tool_call",
        toolName: item.name,
        arguments: safeJson(item.arguments),
        status: item.status === "completed" ? "completed" : "planned"
      });
    } else if (item.type === "web_search_call" || item.type === "file_search_call" || item.type === "code_interpreter_call") {
      if (item.type === "code_interpreter_call") {
        for (const generated of item.outputs ?? []) {
          const generatedFileId = typeof generated.file_id === "string" ? generated.file_id : typeof generated.fileId === "string" ? generated.fileId : undefined;
          const generatedFileName =
            typeof generated.filename === "string" ? generated.filename :
            typeof generated.file_name === "string" ? generated.file_name :
            typeof generated.path === "string" ? artifactFileNameFromUrl(generated.path) :
            typeof generated.url === "string" ? artifactFileNameFromUrl(generated.url) :
            undefined;

          if (typeof item.container_id === "string" && generatedFileId && generatedFileName) {
            const block = artifactBlock({
              containerId: item.container_id,
              fileId: generatedFileId,
              fileName: generatedFileName
            });
            if (block) blocks.push(block);
          } else if (typeof generated.url === "string") {
            const block = blockForUrlArtifact(generated.url, generatedFileName, prompt);
            if (block) {
              blocks.push(block);
            } else if (generated.type === "image") {
              blocks.push({
                type: "image",
                url: generated.url,
                alt: "Code Interpreter generated chart",
                prompt,
                metadata: { containerId: item.container_id }
              });
            }
          }
        }
      }
      const toolName =
        item.type === "web_search_call" ? "web_search" :
        item.type === "file_search_call" ? "file_search" : "data_analysis";
      const status = item.status === "failed" ? "failed" : item.status === "completed" ? "completed" : "in_progress";
      if (!(toolName === "data_analysis" && status === "completed")) {
        blocks.push({
          type: "tool_result",
          toolName,
          status,
          result: {
            id: item.id,
            ...(item.results ? { results: item.results } : {}),
            ...(item.outputs ? { outputs: item.outputs } : {})
          }
        });
      }
    }
  }

  for (const item of output) {
    if (item.type !== "message" || !Array.isArray(item.content)) continue;
    for (const part of item.content) {
      for (const annotation of part.annotations ?? []) {
        if (annotation.type !== "container_file_citation") continue;
        const fileName = annotation.filename;
        if (typeof annotation.container_id !== "string" || typeof annotation.file_id !== "string" || typeof fileName !== "string") {
          continue;
        }
        const block = artifactBlock({
          containerId: annotation.container_id,
          fileId: annotation.file_id,
          fileName
        });
        if (block) blocks.push(block);
      }
    }
  }

  blocks.push(...annotationsToSources(output));
  const dedupedBlocks = dedupeSourceLists(blocks);
  if (dedupedBlocks.length === 0) {
    dedupedBlocks.push({
      type: "status",
      status: response.status === "failed" ? "failed" : response.status === "completed" ? "completed" : "in_progress",
      message: `OpenAI response ${response.status}.`
    });
  }
  return dedupedBlocks;
}

function extractOutputText(response: OpenAIResponse): string {
  if (typeof response.output_text === "string") return response.output_text;
  return (response.output as OpenAIItem[] ?? [])
    .filter((item) => item.type === "message" && Array.isArray(item.content))
    .flatMap((item) => item.content)
    .filter((part) => part.type === "output_text" && typeof part.text === "string")
    .map((part) => part.text)
    .join("");
}

export function parseDualTextPayload(rawText: string): DualTextParseResult {
  const trimmed = rawText.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  if (!trimmed.startsWith("{")) return { status: "not_requested" };

  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (typeof parsed !== "object" || parsed === null) return { status: "invalid_payload" };
    const record = parsed as Record<string, unknown>;
    if (typeof record.visible_text !== "string" || !record.visible_text.trim()) return { status: "invalid_payload" };
    return {
      status: "parsed",
      payload: {
        visibleText: record.visible_text,
        ...(typeof record.tts_script === "string" && record.tts_script.trim() ? { ttsScript: record.tts_script } : {})
      }
    };
  } catch {
    return { status: "malformed_json" };
  }
}

export function displayTextFromDualText(rawText: string): string {
  const dualText = parseDualTextPayload(rawText);
  if (dualText.payload) return dualText.payload.visibleText;
  if (dualText.status === "malformed_json" || dualText.status === "invalid_payload") {
    return "I hit a response formatting issue before I could show that answer. Please try again.";
  }
  return rawText;
}

function safeJson(value: unknown): Record<string, unknown> {
  if (typeof value === "object" && value !== null) return value as Record<string, unknown>;
  if (typeof value !== "string") return {};
  try {
    const parsed = JSON.parse(value);
    return typeof parsed === "object" && parsed !== null ? parsed : {};
  } catch {
    return {};
  }
}

function shouldRetry(error: unknown): boolean {
  const status = typeof error === "object" && error !== null && "status" in error ? Number(error.status) : 0;
  return status === 408 || status === 409 || status === 429 || status >= 500;
}

const OPTIONAL_OPENAI_CONTROL_PARAMS = new Set([
  "temperature",
  "top_p",
  "presence_penalty",
  "frequency_penalty",
  "reasoning",
  "reasoning.effort",
  "reasoning.summary",
  "text",
  "text.format",
  "text.verbosity"
]);

function unsupportedControlParameter(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  const record = error as { status?: unknown; param?: unknown; error?: { param?: unknown } };
  const status = Number(record.status);
  const param = typeof record.param === "string"
    ? record.param
    : typeof record.error?.param === "string"
      ? record.error.param
      : undefined;

  if (status !== 400 || !param || !OPTIONAL_OPENAI_CONTROL_PARAMS.has(param)) return undefined;
  return param;
}

function stripUnsupportedControlParam(params: OpenAIItem, param: string): OpenAIItem {
  const next = { ...params };
  if (param.includes(".")) {
    const [parent, child] = param.split(".");
    if (!parent || !child) return next;
    const parentValue = typeof next[parent] === "object" && next[parent] !== null ? { ...next[parent] } : undefined;
    if (parentValue) {
      delete parentValue[child];
      if (Object.keys(parentValue).length > 0) {
        next[parent] = parentValue;
      } else {
        delete next[parent];
      }
    }
    return next;
  }

  delete next[param];
  return next;
}

function mergeUsage(primaryUsage: OpenAIItem | null | undefined, secondaryUsage: OpenAIItem | null | undefined): OpenAIItem | undefined {
  if (!primaryUsage && !secondaryUsage) return undefined;

  return {
    ...(primaryUsage ?? {}),
    input_tokens: Number(primaryUsage?.input_tokens ?? 0) + Number(secondaryUsage?.input_tokens ?? 0),
    output_tokens: Number(primaryUsage?.output_tokens ?? 0) + Number(secondaryUsage?.output_tokens ?? 0),
    total_tokens: Number(primaryUsage?.total_tokens ?? 0) + Number(secondaryUsage?.total_tokens ?? 0),
    input_tokens_details: {
      ...(primaryUsage?.input_tokens_details ?? {}),
      cached_tokens:
        Number(primaryUsage?.input_tokens_details?.cached_tokens ?? 0) +
        Number(secondaryUsage?.input_tokens_details?.cached_tokens ?? 0)
    },
    output_tokens_details: {
      ...(primaryUsage?.output_tokens_details ?? {}),
      reasoning_tokens:
        Number(primaryUsage?.output_tokens_details?.reasoning_tokens ?? 0) +
        Number(secondaryUsage?.output_tokens_details?.reasoning_tokens ?? 0)
    }
  };
}

async function withRetry<T>(operation: () => Promise<T>): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= env.OPENAI_MAX_RETRIES; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (!shouldRetry(error) || attempt === env.OPENAI_MAX_RETRIES) throw error;
      await new Promise((resolve) => setTimeout(resolve, Math.min(8000, 500 * 2 ** attempt)));
    }
  }
  throw lastError;
}

export class OpenAIProvider implements LLMProvider {
  private readonly promptMode: OpenAIPromptMode;
  private readonly providerId: Extract<ProviderId, "openai" | "openai_persona">;

  constructor(options: OpenAIProviderOptions = {}) {
    this.promptMode = options.promptMode ?? "base";
    this.providerId = options.providerId ?? "openai";
  }

  async generateResponse(input: LLMInput, signal?: AbortSignal): Promise<LLMOutput> {
    if (!env.OPENAI_API_KEY || (env.NODE_ENV === "test" && !env.OPENAI_RUN_INTEGRATION_TESTS)) {
      return buildStubOutput(input, this.providerId, this.promptMode);
    }

    const client = new OpenAI({
      apiKey: env.OPENAI_API_KEY,
      timeout: env.OPENAI_REQUEST_TIMEOUT_MS,
      maxRetries: 0
    });
    const tools = buildTools(input);
    const responseInput = withStyleReference(input, this.promptMode, buildInput(input, this.promptMode));
    const applicationTrace: ContentBlock[] = [];
    let response = await this.createResponse(client, input, responseInput, tools, signal);
    if (shouldRetryForImageGeneration(input, response)) {
      responseInput.push({
        role: "user",
        content: "Retry using the image_generation tool now. Generate the requested image instead of explaining that image generation is unavailable."
      });
      response = await this.createResponse(client, input, responseInput, tools, signal);
    }
    if (shouldRetryForCodeInterpreter(input, response)) {
      responseInput.push({
        role: "user",
        content:
          "Retry using Code Interpreter now. Create the requested analysis artifact, chart, graph, plot, dashboard, or downloadable file instead of only explaining it in text."
      });
      response = await this.createResponse(client, input, responseInput, tools, signal);
    }
    if (shouldDescribeGeneratedImage(input, response)) {
      const descriptionResponse = await this.describeGeneratedImage(client, input, generatedImageResults(response)[0]!, signal);
      response = this.mergeImageResponseWithDescription(response, descriptionResponse);
    }

    for (let iteration = 0; iteration < env.OPENAI_MAX_TOOL_ITERATIONS; iteration += 1) {
      const calls = (response.output as OpenAIItem[]).filter((item) => item.type === "function_call");
      if (calls.length === 0) break;

      responseInput.push(...(response.output as OpenAIItem[]));
      for (const call of calls) {
        let result: unknown;
        try {
          result = await executeApplicationTool(call.name, safeJson(call.arguments), input.clientContext);
        } catch (error) {
          result = { error: error instanceof Error ? error.message : String(error) };
        }
        applicationTrace.push(
          { type: "tool_call", toolName: call.name, arguments: safeJson(call.arguments), status: "completed" },
          { type: "tool_result", toolName: call.name, status: "completed", result }
        );
        responseInput.push({
          type: "function_call_output",
          call_id: call.call_id,
          output: JSON.stringify(result)
        });
      }
      signal?.throwIfAborted();
      response = await this.createResponse(client, input, responseInput, tools, signal);
    }

    return this.formatResponse(response, input, tools, applicationTrace);
  }

  async generateResponseStream(input: LLMInput, callbacks: LLMStreamCallbacks, signal?: AbortSignal): Promise<LLMOutput> {
    if (!env.OPENAI_API_KEY || (env.NODE_ENV === "test" && !env.OPENAI_RUN_INTEGRATION_TESTS)) {
      const output = buildStubOutput(input, this.providerId, this.promptMode);
      callbacks.onTextDelta(output.rawText);
      return output;
    }

    const client = new OpenAI({
      apiKey: env.OPENAI_API_KEY,
      timeout: env.OPENAI_REQUEST_TIMEOUT_MS,
      maxRetries: 0
    });
    const tools = buildTools(input);
    const responseInput = withStyleReference(input, this.promptMode, buildInput(input, this.promptMode));
    const applicationTrace: ContentBlock[] = [];
    let response = await this.createStreamingResponse(client, input, responseInput, tools, callbacks, signal);

    for (let iteration = 0; iteration < env.OPENAI_MAX_TOOL_ITERATIONS; iteration += 1) {
      const calls = (response.output as OpenAIItem[]).filter((item) => item.type === "function_call");
      if (calls.length === 0) break;

      responseInput.push(...(response.output as OpenAIItem[]));
      for (const call of calls) {
        let result: unknown;
        try {
          result = await executeApplicationTool(call.name, safeJson(call.arguments), input.clientContext);
        } catch (error) {
          result = { error: error instanceof Error ? error.message : String(error) };
        }
        applicationTrace.push(
          { type: "tool_call", toolName: call.name, arguments: safeJson(call.arguments), status: "completed" },
          { type: "tool_result", toolName: call.name, status: "completed", result }
        );
        responseInput.push({
          type: "function_call_output",
          call_id: call.call_id,
          output: JSON.stringify(result)
        });
      }
      signal?.throwIfAborted();
      response = await this.createStreamingResponse(client, input, responseInput, tools, callbacks, signal);
    }

    return this.formatResponse(response, input, tools, applicationTrace);
  }

  private formatResponse(response: OpenAIResponse, input: LLMInput, tools: OpenAIItem[], applicationTrace: ContentBlock[] = []): LLMOutput {
    const usage = response.usage as OpenAIItem | null;
    const rawText = extractOutputText(response);
    const dualText = parseDualTextPayload(rawText);
    const visibleText = dualText.payload?.visibleText ?? displayTextFromDualText(rawText);
    const estimatedCostUsd = usage
      ? ((usage.input_tokens ?? 0) * env.OPENAI_INPUT_COST_PER_MILLION +
          (usage.output_tokens ?? 0) * env.OPENAI_OUTPUT_COST_PER_MILLION) / 1_000_000
      : 0;
    const output: LLMOutput = {
      provider: this.providerId,
      rawText: visibleText,
      content: [...mapOutput(response, input.userMessage), ...applicationTrace],
      ...(usage ? {
        usage: {
          inputTokens: usage.input_tokens ?? 0,
          outputTokens: usage.output_tokens ?? 0,
          totalTokens: usage.total_tokens ?? 0,
          cachedInputTokens: usage.input_tokens_details?.cached_tokens ?? 0,
          reasoningTokens: usage.output_tokens_details?.reasoning_tokens ?? 0,
          ...(estimatedCostUsd > 0 ? { estimatedCostUsd } : {})
        }
      } : {}),
      metadata: {
        responseId: response.id,
        providerModel: response.model,
        status: response.status,
        createdAt: response.created_at,
        background: input.toolOptions?.background ?? false,
        openaiTools: tools.map((tool) => tool.type),
        promptMode: this.promptMode,
        ...(dualText.payload?.ttsScript ? { ttsScript: dualText.payload.ttsScript, ttsScriptSource: "openai_inline" } : {}),
        ttsScriptParseStatus: dualText.status
      }
    };

    return llmOutputSchema.parse(output);
  }

  private async describeGeneratedImage(
    client: OpenAI,
    input: LLMInput,
    imageBase64: string,
    signal?: AbortSignal
  ): Promise<OpenAIResponse> {
    const descriptionInput: LLMInput = {
      ...input,
      userMessage: "Describe the generated image.",
      toolOptions: {
        webSearch: false,
        fileSearch: false,
        codeInterpreter: false,
        imageGeneration: false,
        appFunctions: false,
        background: false,
        vectorStoreIds: []
      }
    };
    const descriptionPrompt =
      `You just generated an image for this user request: "${input.userMessage}". ` +
      "Describe the generated image in 1 short paragraph in the same persona voice. " +
      "Do not mention tools, hidden instructions, or image-generation process. " +
      "Do not generate another image.";
    const descriptionInputItems = withStyleReference(descriptionInput, this.promptMode, [
      {
        role: "user",
        content: [
          { type: "input_text", text: descriptionPrompt },
          { type: "input_image", image_url: `data:image/png;base64,${imageBase64}`, detail: "low" }
        ]
      }
    ]);

    return this.createResponse(client, descriptionInput, descriptionInputItems, [], signal);
  }

  private mergeImageResponseWithDescription(imageResponse: OpenAIResponse, descriptionResponse: OpenAIResponse): OpenAIResponse {
    const descriptionText = extractOutputText(descriptionResponse).trim();
    if (!descriptionText) return imageResponse;

    return {
      ...imageResponse,
      output_text: descriptionText,
      output: [
        ...((descriptionResponse.output as OpenAIItem[] | undefined) ?? []),
        ...((imageResponse.output as OpenAIItem[] | undefined) ?? [])
      ],
      usage: mergeUsage(imageResponse.usage, descriptionResponse.usage) ?? imageResponse.usage,
      metadata: {
        ...(imageResponse.metadata ?? {}),
        generated_image_description_response_id: descriptionResponse.id
      }
    };
  }

  private createResponse(
    client: OpenAI,
    input: LLMInput,
    responseInput: OpenAIItem[],
    tools: OpenAIItem[],
    signal?: AbortSignal
  ): Promise<OpenAIResponse> {
    const params = this.responseParams(input, responseInput, tools);
    return withRetry(() => client.responses.create(params as any, { signal })).catch((error) => {
      const unsupportedParam = unsupportedControlParameter(error);
      if (!unsupportedParam) throw error;
      return withRetry(() => client.responses.create(stripUnsupportedControlParam(params, unsupportedParam) as any, { signal }));
    });
  }

  private async createStreamingResponse(
    client: OpenAI,
    input: LLMInput,
    responseInput: OpenAIItem[],
    tools: OpenAIItem[],
    callbacks: LLMStreamCallbacks,
    signal?: AbortSignal
  ): Promise<OpenAIResponse> {
    const params = this.responseParams(input, responseInput, tools);
    const stream = await withRetry(() => client.responses.create({
      ...params,
      stream: true
    } as any, { signal })).catch((error) => {
      const unsupportedParam = unsupportedControlParameter(error);
      if (!unsupportedParam) throw error;
      return withRetry(() => client.responses.create({
        ...stripUnsupportedControlParam(params, unsupportedParam),
        stream: true
      } as any, { signal }));
    });
    let completedResponse: OpenAIResponse | undefined;
    let streamedText = "";

    for await (const event of stream as any) {
      if (event.type === "response.output_text.delta" && typeof event.delta === "string") {
        streamedText += event.delta;
        callbacks.onTextDelta(event.delta);
      } else if (event.type === "response.completed") {
        completedResponse = event.response;
      } else if (event.type === "response.failed") {
        throw new Error(event.response?.error?.message ?? "OpenAI streaming response failed.");
      } else if (event.type === "error") {
        throw new Error(event.message ?? "OpenAI streaming response failed.");
      }
    }

    if (!completedResponse) throw new Error("OpenAI stream ended without a completed response.");
    if (!extractOutputText(completedResponse) && streamedText) completedResponse.output_text = streamedText;
    return completedResponse;
  }

  private requestControls(): OpenAIRequestControls {
    const temperature = this.promptMode === "full" ? env.OPENAI_PERSONA_TEMPERATURE : env.OPENAI_TEMPERATURE;
    const topP = this.promptMode === "full" ? env.OPENAI_PERSONA_TOP_P : env.OPENAI_TOP_P;
    const presencePenalty = this.promptMode === "full" ? env.OPENAI_PERSONA_PRESENCE_PENALTY : env.OPENAI_PRESENCE_PENALTY;
    const frequencyPenalty = this.promptMode === "full" ? env.OPENAI_PERSONA_FREQUENCY_PENALTY : env.OPENAI_FREQUENCY_PENALTY;
    const reasoningEffort = this.promptMode === "full" ? env.OPENAI_PERSONA_REASONING_EFFORT : env.OPENAI_REASONING_EFFORT;
    const reasoningSummary = this.promptMode === "full" ? env.OPENAI_PERSONA_REASONING_SUMMARY : env.OPENAI_REASONING_SUMMARY;
    const textVerbosity = this.promptMode === "full" ? env.OPENAI_PERSONA_TEXT_VERBOSITY : env.OPENAI_TEXT_VERBOSITY;
    const reasoning = compactObject({
      effort: reasoningEffort,
      summary: reasoningSummary
    });
    const text = compactObject({
      verbosity: textVerbosity
    });

    return compactObject({
      // The OpenAI docs recommend changing temperature or top_p, not both. If top_p is set, it wins.
      temperature: topP === undefined ? temperature : undefined,
      top_p: topP,
      presence_penalty: presencePenalty,
      frequency_penalty: frequencyPenalty,
      reasoning: Object.keys(reasoning).length > 0 ? reasoning : undefined,
      text: Object.keys(text).length > 0 ? text : undefined
    }) as OpenAIRequestControls;
  }

  private responseParams(input: LLMInput, responseInput: OpenAIItem[], tools: OpenAIItem[]) {
    const controls = this.requestControls();
    const text = {
      ...(controls.text ?? {}),
      ...(shouldRequestInlineTtsScript(input, this.promptMode) ? { format: dualTextResponseFormat() } : {})
    };

    return {
      model: env.OPENAI_MODEL,
      instructions: buildOpenAIResponseInstructions(input, this.promptMode),
      input: responseInput as any,
      tools: tools as any,
      background: input.toolOptions?.background ?? false,
      include: [
        "web_search_call.action.sources",
        "file_search_call.results",
        "code_interpreter_call.outputs"
      ],
      parallel_tool_calls: true,
      prompt_cache_key: `persona-${input.persona.id}`,
      prompt_cache_retention: "24h",
      max_output_tokens: env.OPENAI_MAX_OUTPUT_TOKENS,
      ...controls,
      ...(Object.keys(text).length > 0 ? { text } : {}),
      metadata: {
        persona_id: input.persona.id,
        prompt_mode: this.promptMode,
        ...(controls.temperature !== undefined ? { temperature: String(controls.temperature) } : {}),
        ...(controls.top_p !== undefined ? { top_p: String(controls.top_p) } : {}),
        ...(controls.presence_penalty !== undefined ? { presence_penalty: String(controls.presence_penalty) } : {}),
        ...(controls.frequency_penalty !== undefined ? { frequency_penalty: String(controls.frequency_penalty) } : {}),
        ...(controls.reasoning?.effort ? { reasoning_effort: controls.reasoning.effort } : {}),
        ...(controls.reasoning?.summary ? { reasoning_summary: controls.reasoning.summary } : {}),
        ...(controls.text?.verbosity ? { text_verbosity: controls.text.verbosity } : {}),
        ...(shouldRequestInlineTtsScript(input, this.promptMode) ? { response_format: "visible_text_tts_script" } : {})
      }
    };
  }
}
