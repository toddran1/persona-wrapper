import OpenAI, { toFile } from "openai";
import { createReadStream } from "node:fs";
import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import { fileURLToPath } from "node:url";
import {
  chartOutputSchema,
  finiteNonnegativeIntegerOr,
  fileOutputSchema,
  type Citation,
  type ContentBlock,
  type ImageProviderId,
  type LLMInput,
  type LLMOutput,
  type ProviderId,
  type ToolDefinition
} from "@persona/shared";
import { llmOutputSchema, MAX_OPENAI_IMAGE_EDIT_BYTES, stripGeneratedFileDownloadPrompt } from "@persona/shared";
import { env } from "../../config/env.js";
import { executeApplicationTool } from "../tools/toolRegistry.js";
import { openAIArtifactService } from "../../services/openAIArtifactService.js";
import { placesSearchResultSchema } from "../../services/placesSearchService.js";
import { buildPersonaStyleReference } from "../../services/personaStyleReferenceBuilder.js";
import { personaVoicePromptInstructions } from "../../services/personaVoicePerformance.js";
import { buildImageGenerationPrompt, directPersonaVisualReferencePaths } from "../../services/imagePromptBuilder.js";
import { storageService } from "../../services/storageService.js";
import { analyzeImageReferenceRequirement } from "../../services/imageReferenceRequirement.js";
import { HttpError } from "../../utils/httpError.js";
import { maxOutputTokensForRequest } from "../../services/audioResponsePolicy.js";
import type { LLMProgressCallbacks, LLMProvider, LLMStreamCallbacks } from "./LLMProvider.js";
import { buildStubOutput } from "./stubScenarioBuilder.js";
import { createImageProvider } from "../image/providerFactory.js";
import type { ImageReferenceInput } from "../image/ImageProvider.js";
import { fluxImageDimensions } from "../image/fluxImageDimensions.js";

type OpenAIResponse = any;
type OpenAIItem = Record<string, any>;

const CHART_REQUEST_PATTERN = /\b(pie chart|bar chart|line chart|chart|graph|plot|visuali[sz]e|dashboard)\b/i;
const DATA_OUTPUT_REQUEST_PATTERN =
  /\b(calculate|analy[sz]e|dataset|spreadsheet|csv|statistics|average|median|sum|pivot|export|downloadable|xlsx|excel)\b/i;
const IMAGE_SAFETY_REFUSAL_PATTERN =
  /\b(safety|policy|policies|disallowed|not allowed|can't assist|cannot assist|can't help|cannot help|explicit|sexualized|sexual|nudity|nude|pornographic|erotic|minor|underage|flagged|violat(?:e|es|ing|ion)|unsafe)\b/i;
const IMAGE_EDIT_OR_CONTEXT_PATTERN =
  /\b(edit|change|modify|retouch|inpaint|remove|replace|swap|make it|turn it|this image|that image|previous image|uploaded image|reference image|same image|her outfit|his outfit|their outfit|add sunglasses|add a hat|add a cap)\b/i;
const RESPONSE_INCLUDE_FIELDS = [
  "web_search_call.action.sources",
  "file_search_call.results",
  "code_interpreter_call.outputs"
];
const DIRECT_IMAGE_EDIT_MIME_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);

function inputContent(input: LLMInput): OpenAIItem[] {
  const promptText = input.toolOptions?.imageGeneration ? buildImageGenerationPrompt(input) : input.userMessage;
  const content: OpenAIItem[] = promptText.trim()
    ? [{ type: "input_text", text: promptText }]
    : [];

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
  providerId?: Extract<ProviderId, "openai">;
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
    !input.toolOptions?.imageGeneration &&
    !input.toolOptions?.codeInterpreter;
}

function dualTextResponseFormat(): OpenAIItem {
  return {
    type: "json_schema",
    name: "persona_visible_text_and_tts_script",
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
          description: "The same response meaning and facts, rewritten as a provider-neutral narration script with speech pacing, normalized pronunciation, and emotional delivery cues appropriate for the configured voice."
        }
      }
    }
  };
}

export function buildInput(input: LLMInput, promptMode: OpenAIPromptMode): OpenAIItem[] {
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
  if (
    promptMode !== "full" ||
    input.personaInfluenceLevel === "professional" ||
    !input.persona.styleReference?.enabled ||
    input.toolOptions?.imageGeneration ||
    input.toolOptions?.codeInterpreter
  ) {
    return responseInput;
  }

  return [
    {
      role: "developer",
      content: buildPersonaStyleReference(input.persona)
    },
    ...responseInput
  ];
}

function compactObject<T extends Record<string, unknown>>(value: T): Partial<T> {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined)) as Partial<T>;
}

/**
 * Web search is allowed to run in an app-level durable job, but a provider
 * response that stays queued/in-progress is not allowed to consume that job's
 * entire execution deadline. Keep this policy in one place so the timeout is
 * visible in logs and easy to tune independently from image/code jobs.
 */
export function backgroundPollTimeoutMs(input: Pick<LLMInput, "toolOptions">): number {
  const hasLongRunningTool = Boolean(input.toolOptions?.imageGeneration || input.toolOptions?.codeInterpreter);
  return input.toolOptions?.webSearch && !hasLongRunningTool
    ? Math.min(env.OPENAI_BACKGROUND_POLL_TIMEOUT_MS, env.OPENAI_WEB_SEARCH_POLL_TIMEOUT_MS)
    : env.OPENAI_BACKGROUND_POLL_TIMEOUT_MS;
}

// `toolOptions.background` is also the app-level durable-job flag. Do not pass
// that flag through to Responses background mode for ordinary web searches:
// the durable worker already lets the user leave the app, while provider
// background polling can remain queued indefinitely. Image/code requests are
// the cases where OpenAI's background response mode is useful.
function shouldUseOpenAIBackgroundMode(input: LLMInput): boolean {
  return Boolean(
    input.toolOptions?.background &&
    (input.toolOptions.imageGeneration || input.toolOptions.codeInterpreter)
  );
}

function imageQuality(input: LLMInput) {
  return input.toolOptions?.imageQuality ?? env.OPENAI_IMAGE_QUALITY;
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

export function buildOpenAITools(input: LLMInput): OpenAIItem[] {
  const tools: OpenAIItem[] = [];
  const options = input.toolOptions ?? {
    webSearch: false, fileSearch: false, codeInterpreter: false, imageGeneration: false,
    appFunctions: true, background: false, vectorStoreIds: []
  };
  const fileIds = (input.attachments ?? []).flatMap((attachment) => attachment.openaiFileId ? [attachment.openaiFileId] : []);

  if (options.webSearch && env.OPENAI_ENABLE_WEB_SEARCH) {
    tools.push({ type: "web_search" });
  }
  if (options.fileSearch && env.OPENAI_ENABLE_FILE_SEARCH && options.vectorStoreIds.length > 0) {
    tools.push({ type: "file_search", vector_store_ids: options.vectorStoreIds });
  }
  if (options.codeInterpreter && env.OPENAI_ENABLE_CODE_INTERPRETER) {
    tools.push({ type: "code_interpreter", container: { type: "auto", file_ids: fileIds } });
  }
  if (options.imageGeneration && env.OPENAI_ENABLE_IMAGE_GENERATION) {
    tools.push({
      type: "image_generation",
      action: "auto",
      model: env.OPENAI_IMAGE_MODEL,
      moderation: env.OPENAI_IMAGE_MODERATION,
      size: env.OPENAI_IMAGE_SIZE,
      quality: imageQuality(input)
    });
  }
  if (options.appFunctions) {
    tools.push(...applicationFunctionTools(input.toolDefinitions));
  }

  return tools;
}

export function shouldUseDirectImageApi(input: LLMInput): boolean {
  const options = input.toolOptions;
  const attachments = input.attachments ?? [];
  const imageReferenceRequirement = analyzeImageReferenceRequirement(input.userMessage);
  const imageAttachmentCount = attachments.filter((attachment) => attachment.kind === "image").length;
  const hasOnlyImageAttachments = attachments.length > 0 && attachments.every((attachment) =>
    attachment.kind === "image" && DIRECT_IMAGE_EDIT_MIME_TYPES.has(attachment.mimeType)
  );
  return Boolean(
    env.OPENAI_DIRECT_IMAGE_API_ENABLED &&
    env.OPENAI_ENABLE_IMAGE_GENERATION &&
    options?.imageGeneration &&
    !options.webSearch &&
    !options.fileSearch &&
    !options.codeInterpreter &&
    (!imageReferenceRequirement.required || imageAttachmentCount >= imageReferenceRequirement.minimumImages) &&
    !wantsGeneratedImageDescription(input.userMessage) &&
    (hasOnlyImageAttachments || (attachments.length === 0 && !IMAGE_EDIT_OR_CONTEXT_PATTERN.test(input.userMessage)))
  );
}

// FLUX.2 Pro is the app's second image provider. It serves image generation
// and editing requests; mixed-tool requests keep the OpenAI tool path
// unchanged. Unlike the OpenAI branches this does not require an OpenAI key.
// Note the tool flags are intentionally NOT excluded here: the deterministic
// tool router enables web search on incidental travel/shopping keywords
// ("trip", "resort"), and FLUX has no tool composition to conflict with —
// choosing FLUX is an explicit request for FLUX image output. Image intent is
// established by the attachment-shape and edit-context conditions instead.
// The narrow structural input lets the usage reservation reuse the same gate.
export function shouldUseFluxImageApi(input: {
  imageProvider?: ImageProviderId | undefined;
  toolOptions?: {
    imageGeneration?: boolean | undefined;
    webSearch?: boolean | undefined;
    fileSearch?: boolean | undefined;
    codeInterpreter?: boolean | undefined;
  } | undefined;
  attachments?: Array<{ kind: "image" | "file"; mimeType: string }> | undefined;
  userMessage: string;
}): boolean {
  if (input.imageProvider !== "flux") return false;
  const options = input.toolOptions;
  const attachments = input.attachments ?? [];
  const imageReferenceRequirement = analyzeImageReferenceRequirement(input.userMessage);
  const imageAttachmentCount = attachments.filter((attachment) => attachment.kind === "image").length;
  const hasOnlyImageAttachments = attachments.length > 0 && attachments.every((attachment) =>
    attachment.kind === "image" && DIRECT_IMAGE_EDIT_MIME_TYPES.has(attachment.mimeType)
  );
  return Boolean(
    options?.imageGeneration &&
    (!imageReferenceRequirement.required || imageAttachmentCount >= imageReferenceRequirement.minimumImages) &&
    !wantsGeneratedImageDescription(input.userMessage) &&
    (hasOnlyImageAttachments || (attachments.length === 0 && !IMAGE_EDIT_OR_CONTEXT_PATTERN.test(input.userMessage)))
  );
}

async function streamToBuffer(stream: NodeJS.ReadableStream): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

// Mirrors directUserImageFiles but returns base64 payloads for the BFL API
// instead of OpenAI file uploads.
async function fluxUserReferenceImages(input: LLMInput): Promise<ImageReferenceInput[]> {
  const images = (input.attachments ?? []).filter((attachment) => attachment.kind === "image") as InternalImageAttachment[];
  return Promise.all(images.map(async (attachment) => {
    if (attachment.sizeBytes > MAX_OPENAI_IMAGE_EDIT_BYTES) {
      throw new HttpError("An attached image is too large for image editing. Images must be smaller than 50 MB.", 413);
    }
    if (attachment.storageKey) {
      const downloaded = await storageService.getStream(attachment.storageKey);
      if (downloaded.sizeBytes !== undefined && downloaded.sizeBytes > MAX_OPENAI_IMAGE_EDIT_BYTES) {
        downloaded.stream.destroy();
        throw new HttpError("An attached image is too large for image editing. Images must be smaller than 50 MB.", 413);
      }
      const buffer = await streamToBuffer(downloaded.stream);
      return { dataBase64: buffer.toString("base64"), mimeType: attachment.mimeType };
    }
    if (attachment.localPath) {
      const buffer = await readFile(attachment.localPath);
      return { dataBase64: buffer.toString("base64"), mimeType: attachment.mimeType };
    }
    if (attachment.url) {
      const match = /^data:([^;,]+);base64,([\s\S]+)$/i.exec(attachment.url);
      if (match) {
        const buffer = Buffer.from(match[2]!, "base64");
        if (buffer.byteLength > MAX_OPENAI_IMAGE_EDIT_BYTES) {
          throw new HttpError("An attached image is too large for image editing. Images must be smaller than 50 MB.", 413);
        }
        return { dataBase64: match[2]!, mimeType: match[1] || attachment.mimeType };
      }
    }
    throw new HttpError("An attached image is no longer available. Please re-upload it and try again.", 409);
  }));
}

async function fluxPersonaReferenceImages(input: LLMInput): Promise<ImageReferenceInput[]> {
  return Promise.all(
    directPersonaVisualReferencePaths(input).map(async (referencePath) => {
      const buffer = await readFile(localPersonaVisualReferencePath(referencePath));
      return { dataBase64: buffer.toString("base64"), mimeType: "image/png" };
    })
  );
}

export function buildDirectImageApiParams(input: LLMInput): OpenAIItem {
  const hasPersonaVisualReferences = directPersonaVisualReferencePaths(input).length > 0;
  const hasUserImageReferences = (input.attachments ?? []).some((attachment) => attachment.kind === "image");

  return compactObject({
    model: env.OPENAI_IMAGE_MODEL,
    prompt: buildImageGenerationPrompt(input, {
      includePersonaVisualReferences: hasPersonaVisualReferences,
      includeUserImageReferences: hasUserImageReferences
    }),
    moderation: env.OPENAI_IMAGE_MODERATION,
    size: env.OPENAI_IMAGE_SIZE,
    quality: imageQuality(input),
    n: 1
  });
}

function localPersonaVisualReferencePath(referencePath: string): string {
  const relativePath = referencePath.replace(/^\/+/, "");
  return fileURLToPath(new URL(`../../../../../${relativePath}`, import.meta.url));
}

async function directPersonaVisualReferenceFiles(input: LLMInput) {
  return Promise.all(
    directPersonaVisualReferencePaths(input).map(async (referencePath) => {
      const localPath = localPersonaVisualReferencePath(referencePath);
      return toFile(createReadStream(localPath), basename(localPath), { type: "image/png" });
    })
  );
}

type InternalImageAttachment = NonNullable<LLMInput["attachments"]>[number] & {
  storageKey?: string;
  localPath?: string;
};

function fileFromDataUrl(url: string, fileName: string, mimeType: string) {
  const match = /^data:([^;,]+);base64,([\s\S]+)$/i.exec(url);
  if (!match) return undefined;
  const buffer = Buffer.from(match[2]!, "base64");
  if (buffer.byteLength > MAX_OPENAI_IMAGE_EDIT_BYTES) {
    throw new HttpError("An attached image is too large for image editing. Images must be smaller than 50 MB.", 413);
  }
  return toFile(buffer, basename(fileName), { type: match[1] || mimeType });
}

async function directUserImageFiles(input: LLMInput) {
  const images = (input.attachments ?? []).filter((attachment) => attachment.kind === "image") as InternalImageAttachment[];
  return Promise.all(images.map(async (attachment) => {
    if (attachment.sizeBytes > MAX_OPENAI_IMAGE_EDIT_BYTES) {
      throw new HttpError("An attached image is too large for image editing. Images must be smaller than 50 MB.", 413);
    }
    if (attachment.storageKey) {
      const downloaded = await storageService.getStream(attachment.storageKey);
      if (downloaded.sizeBytes !== undefined && downloaded.sizeBytes > MAX_OPENAI_IMAGE_EDIT_BYTES) {
        downloaded.stream.destroy();
        throw new HttpError("An attached image is too large for image editing. Images must be smaller than 50 MB.", 413);
      }
      return toFile(downloaded.stream, basename(attachment.fileName), { type: attachment.mimeType });
    }
    if (attachment.localPath) {
      return toFile(createReadStream(attachment.localPath), basename(attachment.fileName), { type: attachment.mimeType });
    }
    if (attachment.url) {
      const file = fileFromDataUrl(attachment.url, attachment.fileName, attachment.mimeType);
      if (file) return file;
    }
    throw new HttpError("An attached image is no longer available. Please re-upload it and try again.", 409);
  }));
}

export function buildOpenAIResponseInstructions(input: LLMInput, promptMode: OpenAIPromptMode, inlineTtsScriptOverride?: boolean): string {
  const inlineTtsScript = inlineTtsScriptOverride ?? shouldRequestInlineTtsScript(input, promptMode);
  const instructions = promptMode === "full" ? input.systemPrompt : (input.baseSystemPrompt ?? input.systemPrompt);
  const extraInstructions: string[] = [];
  const applicationToolEnabled = (name: string) =>
    input.toolOptions?.appFunctions !== false &&
    input.toolDefinitions.some((tool) => tool.owner === "application" && tool.name === name);

  if (promptMode === "full") {
    const personaInstructions = input.personaInfluenceLevel === "professional"
      ? input.persona.professionalInstructions
      : input.persona.directResponseInstructions;
    extraInstructions.push(
      [
        ...(personaInstructions.length > 0
          ? ["Direct persona performance direction:", ...personaInstructions]
          : []),
        `Answer directly in ${input.persona.shortName ?? input.persona.name}'s voice. Keep useful structure such as lists, bullets, tables, links, citations, images, charts, or files when the task calls for them.`,
        "Use markdown sparingly. Do not wrap lots of ordinary names, numbers, or phrases in bold. Prefer clean prose, bullets, and tables over heavy **bold** formatting.",
        "When web search is used, cite sources through normal citation metadata if available. Do not stuff raw source URLs or repeated source links into every sentence.",
        "When recommending a product, store, booking, ticket, or other destination and a safe direct page URL is available, make the relevant call-to-action text a markdown link to that page. Do not write phrases such as 'buy it here', 'view the product', or 'open the listing' as plain bold text when the destination URL is known. Keep the broader source list in citation metadata as well.",
        "Preserve facts, names, dates, numbers, URLs, citations, quotes, code, chart data, table values, image/file links, and user-selected options exactly. Style the wording around protected details instead of changing the details.",
        input.personaInfluenceLevel === "professional"
          ? "Keep every part of the response workplace-appropriate and free of profanity, slurs, and vulgarity."
          : "Vary catchphrases and profanity naturally. Do not repeat the same catchphrase in every response."
      ].join("\n")
    );
  }

  if (input.audio && input.conciseAudioResponse) {
    extraInstructions.push(
      [
        "Audio response length requirement:",
        `Keep the complete visible response at or below ${env.CHAT_AUDIO_MAX_RESPONSE_CHARACTERS} characters so its spoken version is approximately 45 seconds.`,
        "Answer the user's main question directly, retain essential facts and safety information, and omit repetitive commentary, exhaustive alternatives, and long checklists.",
        "Do not mention this character limit or say that the response was shortened."
      ].join("\n")
    );
  }

  if (inlineTtsScript) {
    const ttsModelId = env.TTS_PROVIDER === "fish_audio"
      ? input.persona.voiceProfile.fishAudio?.model ?? env.FISH_AUDIO_MODEL
      : env.TTS_PROVIDER === "elevenlabs"
        ? input.persona.voiceProfile.elevenLabs?.modelId ?? env.ELEVENLABS_MODEL_ID
        : env.TTS_PROVIDER;
    extraInstructions.push(
      [
        "Audio response format requirement:",
        "Because audio is enabled, your text response must be a single strict JSON object with exactly these keys:",
        "{\"visible_text\":\"normal response for the UI\",\"tts_script\":\"provider-optimized narration script\"}",
        "Do not wrap the JSON in markdown fences. Do not add text before or after the JSON.",
        "visible_text is the normal user-facing answer and may use markdown when useful.",
        "tts_script is hidden and will be sent only to the configured speech provider. It must preserve the same meaning and facts as visible_text, but it should NOT simply copy visible_text.",
        `Write tts_script as a performance-ready narration script for the current voice. Configured speaking style: ${input.persona.voiceProfile.speakingStyle}.`,
        "For tts_script, remove markdown syntax, raw source citations, code fences, tables, image/file markup, and raw links unless the link itself must be spoken.",
        "For tts_script, normalize text for speech: expand abbreviations and units, spell out awkward symbols, rewrite URLs as source names or omit them, and make numbers, dates, money, percentages, times, temperatures, and acronyms easier to pronounce while preserving their exact factual value. Always write temperature units in full, such as '90 degrees Fahrenheit' or '32 degrees Celsius', never as a trailing F or C.",
        "For tts_script, always expand abbreviated weekdays—including Mon, Tue or Tues, Wed or Weds, Thu, Thur, or Thurs, Fri, Sat, and Sun—to their full spoken names. Keep those abbreviations unchanged in visible_text unless normal editing calls for otherwise.",
        "For tts_script, add natural speech pacing using sentence breaks, paragraph breaks, commas, dashes, ellipses, and occasional short pauses. Keep pauses tasteful and do not overdo them.",
        "For tts_script, carry the configured persona emotion and delivery through word choice and punctuation.",
        "For tts_script, omit emoji and pictographs. Keep emoji only in visible_text; use words, punctuation, pauses, or supported provider performance cues to convey their intended emotion in speech.",
        "For tts_script, preserve all names, dates, numbers, quotes, and factual claims. Do not add facts not present in visible_text.",
        ...(input.conciseAudioResponse
          ? [`Keep tts_script at or below ${env.CHAT_AUDIO_MAX_RESPONSE_CHARACTERS} characters.`]
          : ["The user allows full-length audio. Keep tts_script aligned with the complete visible response."]),
        ...personaVoicePromptInstructions(input.persona, ttsModelId, input.personaInfluenceLevel),
        "Make the tts_script sound like a human performance script, not a transcript copy."
      ].join("\n")
    );
  }

  if (input.toolOptions?.codeInterpreter) {
    extraInstructions.push(
      "The user is requesting data analysis, calculations, charts, dashboards, or generated files. Use code execution for calculations, uploaded datasets, and transformations. For a chart that can be represented as bar, line, area, scatter, or donut data, call render_chart after determining the exact values so the app can display an accessible native chart. Use raw numeric values and explicit axis units; do not invent missing values. For a downloadable CSV, TSV, XLSX, JSON, text, Markdown, or ZIP file, call generate_artifact with the completed data or text; do not rely on provider sandbox links and do not claim a file exists unless that call succeeds. Keep explanatory text concise. Do not include a download URL, a 'download here' call to action, MIME type, or provider attribution; the app renders generated file controls."
    );
  }

  const applicationUtilities: string[] = [];
  if (applicationToolEnabled("generate_artifact")) {
    applicationUtilities.push(
      "Use generate_artifact whenever the user asks for a supported downloadable file, whether or not code execution is needed."
    );
  }
  if (applicationToolEnabled("places_search")) {
    applicationUtilities.push(
      "Use places_search for local businesses, restaurants, venues, attractions, stores, or services. If a place request has no usable city, area, address, landmark, or device location, ask for a location before searching. Base local recommendations only on returned place records, include useful Google Maps links, and make clear that hours, ratings, prices, and availability can change."
    );
  }
  if (applicationUtilities.length > 0) {
    extraInstructions.push(`Application utilities: ${applicationUtilities.join(" ")}`);
  }

  if (input.toolOptions?.imageGeneration) {
    extraInstructions.push(
      "The user is requesting an image. Use the image generation tool to produce the image. Do not answer that you cannot generate, edit, change, show, or provide images when the image_generation tool is available. Never invent or substitute a generic source image when the user asks to mix, combine, edit, match, or otherwise use specific uploads or references that are missing or unavailable. In that case, ask the user to attach or re-upload the required images and do not generate a replacement image. Do not classify or lecture about a supplied reference image unless the provider returns a hard safety error. Keep any text response short and do not send generated image data through persona style transfer. If the user asks you to generate an image and also describe, caption, explain, or summarize it, include a short text description in the same final answer after generating the image."
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

function hasFunctionCall(response: OpenAIResponse, name: string): boolean {
  return ((response.output as OpenAIItem[] | undefined) ?? []).some(
    (item) => item.type === "function_call" && item.name === name
  );
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

export function shouldRetryForImageGeneration(input: LLMInput, response: OpenAIResponse): boolean {
  if (!input.toolOptions?.imageGeneration || hasGeneratedImage(response)) {
    return false;
  }

  const outputText = extractOutputText(response);
  if (IMAGE_SAFETY_REFUSAL_PATTERN.test(outputText)) {
    return false;
  }

  return /\b(can't|cannot|unable to|do not have the ability to|don't have the ability to|can’t)\b[\s\S]{0,120}\b(generate|create|make|show|provide|edit|change|modify|retouch)\b[\s\S]{0,120}\b(images?|photos?|pictures?|art|illustrations?|portraits?)\b/i.test(
    outputText
  );
}

function shouldRetryForCodeInterpreter(input: LLMInput, response: OpenAIResponse): boolean {
  if (
    !input.toolOptions?.codeInterpreter ||
    hasCodeInterpreterCall(response) ||
    hasFunctionCall(response, "render_chart")
  ) {
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
        if (typeof url !== "string" || !isSafeCitationUrl(url) || seen.has(url)) continue;
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
        if (typeof url !== "string" || !isSafeCitationUrl(url) || seen.has(url)) continue;
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

function isSafeCitationUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" || parsed.protocol === "http:";
  } catch {
    return false;
  }
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

export function stripExternalCitationLinks(text: string): string {
  return text
    .replace(/\s*\(\[([^\]]+)\]\((https?:\/\/[^)]+)\)\)/gi, (_full, _label, url) => isArtifactUrl(String(url)) ? _full : "")
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
      if (!isSafeCitationUrl(source.url) || seen.has(source.url)) continue;
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
        metadata: {
          id: item.id,
          status: item.status,
          generationSource: "openai_image_generation"
        }
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
  if (dedupedBlocks.some((block) => block.type === "file")) {
    for (const block of dedupedBlocks) {
      if (block.type === "text") block.text = stripGeneratedFileDownloadPrompt(block.text);
    }
  }
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

async function runApplicationFunctionCall(
  call: OpenAIItem,
  clientContext: LLMInput["clientContext"]
): Promise<{ result: unknown; trace: ContentBlock[] }> {
  const arguments_ = safeJson(call.arguments);
  try {
    const result = await executeApplicationTool(call.name, arguments_, clientContext);
    if (call.name === "render_chart") {
      const chart = chartOutputSchema.safeParse(result);
      if (!chart.success) {
        throw new Error("The chart renderer returned invalid chart data.");
      }
      return { result, trace: [chart.data] };
    }
    if (call.name === "generate_artifact") {
      const file = fileOutputSchema.safeParse(result);
      if (!file.success) throw new Error("The artifact generator returned invalid file data.");
      return { result, trace: [file.data] };
    }
    if (call.name === "places_search") {
      const places = placesSearchResultSchema.safeParse(result);
      if (!places.success) throw new Error("The place search returned invalid data.");
      return {
        result,
        trace: [
          { type: "tool_call", toolName: call.name, arguments: arguments_, status: "completed" },
          { type: "tool_result", toolName: call.name, status: "completed", result },
          {
            type: "source_list",
            sources: places.data.places.map((place) => ({
              title: `${place.name} — Google Maps`,
              url: place.mapsUrl,
              ...(place.address ? { snippet: place.address } : {}),
              sourceType: "google_maps"
            }))
          }
        ]
      };
    }
    return {
      result,
      trace: [
        { type: "tool_call", toolName: call.name, arguments: arguments_, status: "completed" },
        { type: "tool_result", toolName: call.name, status: "completed", result }
      ]
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "The application tool failed.";
    const result = { error: message };
    if (call.name === "render_chart" || call.name === "generate_artifact") {
      // Chart validation errors are returned to the model so it can repair the
      // call. They are not user-facing provider diagnostics.
      return { result, trace: [] };
    }
    return {
      result,
      trace: [
        { type: "tool_call", toolName: call.name, arguments: arguments_, status: "failed" },
        { type: "tool_result", toolName: call.name, status: "failed", result }
      ]
    };
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
    input_tokens: finiteNonnegativeIntegerOr(primaryUsage?.input_tokens) + finiteNonnegativeIntegerOr(secondaryUsage?.input_tokens),
    output_tokens: finiteNonnegativeIntegerOr(primaryUsage?.output_tokens) + finiteNonnegativeIntegerOr(secondaryUsage?.output_tokens),
    total_tokens: finiteNonnegativeIntegerOr(primaryUsage?.total_tokens) + finiteNonnegativeIntegerOr(secondaryUsage?.total_tokens),
    input_tokens_details: {
      ...(primaryUsage?.input_tokens_details ?? {}),
      cached_tokens:
        finiteNonnegativeIntegerOr(primaryUsage?.input_tokens_details?.cached_tokens) +
        finiteNonnegativeIntegerOr(secondaryUsage?.input_tokens_details?.cached_tokens)
    },
    output_tokens_details: {
      ...(primaryUsage?.output_tokens_details ?? {}),
      reasoning_tokens:
        finiteNonnegativeIntegerOr(primaryUsage?.output_tokens_details?.reasoning_tokens) +
        finiteNonnegativeIntegerOr(secondaryUsage?.output_tokens_details?.reasoning_tokens)
    }
  };
}

async function withRetry<T>(operation: () => Promise<T>, signal?: AbortSignal): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= env.OPENAI_MAX_RETRIES; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (!shouldRetry(error) || attempt === env.OPENAI_MAX_RETRIES) throw error;
      await delay(Math.min(8000, 500 * 2 ** attempt), signal);
    }
  }
  throw lastError;
}

function isBackgroundPending(response: OpenAIResponse): boolean {
  return response?.status === "queued" || response?.status === "in_progress";
}

function isBackgroundTerminalFailure(response: OpenAIResponse): boolean {
  return response?.status === "failed" || response?.status === "cancelled" || response?.status === "incomplete";
}

function backgroundFailureMessage(response: OpenAIResponse): string {
  const status = typeof response?.status === "string" ? response.status : "unknown";
  const errorMessage = response?.error?.message;
  const incompleteReason = response?.incomplete_details?.reason;
  const outputTokens = finiteNonnegativeIntegerOr(response?.usage?.output_tokens);
  const reasoningTokens = finiteNonnegativeIntegerOr(response?.usage?.output_tokens_details?.reasoning_tokens);
  const configuredMax = finiteNonnegativeIntegerOr(response?.max_output_tokens);
  const usageDetails = outputTokens > 0 || reasoningTokens > 0 || configuredMax > 0
    ? ` (outputTokens: ${outputTokens}, reasoningTokens: ${reasoningTokens}, maxOutputTokens: ${configuredMax})`
    : "";
  if (typeof errorMessage === "string" && errorMessage.trim()) {
    return `OpenAI response ${status}: ${errorMessage}${usageDetails}`;
  }
  if (typeof incompleteReason === "string" && incompleteReason.trim()) {
    return `OpenAI response ${status}: ${incompleteReason}${usageDetails}`;
  }
  return `OpenAI response ended with status: ${status}${usageDetails}`;
}

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  signal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    const cleanup = () => signal?.removeEventListener("abort", onAbort);
    const timeout = setTimeout(() => {
      cleanup();
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timeout);
      cleanup();
      reject(signal?.reason instanceof Error ? signal.reason : new Error("Request aborted."));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

export class OpenAIProvider implements LLMProvider {
  private readonly promptMode: OpenAIPromptMode;
  private readonly providerId: Extract<ProviderId, "openai">;

  constructor(options: OpenAIProviderOptions = {}) {
    this.promptMode = options.promptMode ?? "full";
    this.providerId = options.providerId ?? "openai";
  }

  private requestTimeout(input: LLMInput): number {
    return input.toolOptions?.imageGeneration
      ? Math.max(env.OPENAI_REQUEST_TIMEOUT_MS, env.OPENAI_IMAGE_REQUEST_TIMEOUT_MS)
      : env.OPENAI_REQUEST_TIMEOUT_MS;
  }

  async generateResponse(input: LLMInput, signal?: AbortSignal, progressCallbacks?: LLMProgressCallbacks): Promise<LLMOutput> {
    // Tests and offline runs must stay on the deterministic stub — never call BFL.
    if (shouldUseFluxImageApi(input) && !(env.NODE_ENV === "test" && !env.OPENAI_RUN_INTEGRATION_TESTS)) {
      return this.generateFluxImageResponse(input, signal);
    }
    if (!env.OPENAI_API_KEY || (env.NODE_ENV === "test" && !env.OPENAI_RUN_INTEGRATION_TESTS)) {
      return buildStubOutput(input, this.providerId, this.promptMode);
    }

    const client = new OpenAI({
      apiKey: env.OPENAI_API_KEY,
      timeout: this.requestTimeout(input),
      maxRetries: 0
    });
    if (shouldUseDirectImageApi(input)) {
      return this.generateDirectImageResponse(client, input, signal);
    }

    const tools = buildOpenAITools(input);
    const responseInput = withStyleReference(input, this.promptMode, buildInput(input, this.promptMode));
    const applicationTrace: ContentBlock[] = [];
    // Every retry and tool-loop iteration below is a separate billed
    // responses.create call that re-sends the full context. Accumulate their
    // usage so metering reflects the true cost of multi-step turns.
    let intermediateUsage: OpenAIItem | undefined;
    const absorbUsage = (completed: OpenAIResponse): void => {
      intermediateUsage = mergeUsage(intermediateUsage, completed.usage as OpenAIItem | null | undefined);
    };
    let response = await this.createResponse(client, input, responseInput, tools, signal, progressCallbacks);
    if (shouldRetryForImageGeneration(input, response)) {
      absorbUsage(response);
      responseInput.push({
        role: "user",
        content: "Retry using the image_generation tool now. Generate the requested image instead of explaining that image generation or editing is unavailable. If the reference image cannot be edited directly, generate a new safe non-explicit image that follows the requested visual change and the persona's visual identity."
      });
      response = await this.createResponse(client, input, responseInput, tools, signal, progressCallbacks);
    }
    if (shouldRetryForCodeInterpreter(input, response)) {
      absorbUsage(response);
      responseInput.push({
        role: "user",
        content:
          "Retry using Code Interpreter now. Create the requested analysis artifact, chart, graph, plot, dashboard, or downloadable file instead of only explaining it in text."
      });
      response = await this.createResponse(client, input, responseInput, tools, signal, progressCallbacks);
    }
    if (shouldDescribeGeneratedImage(input, response)) {
      const descriptionResponse = await this.describeGeneratedImage(client, input, generatedImageResults(response)[0]!, signal, progressCallbacks);
      response = this.mergeImageResponseWithDescription(response, descriptionResponse);
    }

    for (let iteration = 0; iteration < env.OPENAI_MAX_TOOL_ITERATIONS; iteration += 1) {
      const calls = (response.output as OpenAIItem[]).filter((item) => item.type === "function_call");
      if (calls.length === 0) break;

      absorbUsage(response);
      responseInput.push(...(response.output as OpenAIItem[]));
      for (const call of calls) {
        const { result, trace } = await runApplicationFunctionCall(call, input.clientContext);
        applicationTrace.push(...trace);
        responseInput.push({
          type: "function_call_output",
          call_id: call.call_id,
          output: JSON.stringify(result)
        });
      }
      signal?.throwIfAborted();
      response = await this.createResponse(client, input, responseInput, tools, signal, progressCallbacks);
    }

    return this.formatResponse(response, input, tools, applicationTrace, intermediateUsage);
  }

  private async generateDirectImageResponse(client: OpenAI, input: LLMInput, signal?: AbortSignal): Promise<LLMOutput> {
    const params = buildDirectImageApiParams(input);
    const [userReferenceFiles, personaReferenceFiles] = await Promise.all([
      directUserImageFiles(input),
      directPersonaVisualReferenceFiles(input)
    ]);
    const imageReferences = [...userReferenceFiles, ...personaReferenceFiles];
    const usesImageReferences = imageReferences.length > 0;
    const response = usesImageReferences
      ? await withRetry(() => client.images.edit({ ...params, image: imageReferences } as any, { signal }), signal)
      : await withRetry(() => client.images.generate(params as any, { signal }), signal);
    const images = (response.data ?? []) as Array<{ b64_json?: string; url?: string; revised_prompt?: string }>;
    const content: ContentBlock[] = images.flatMap((image, index) => {
      const url = image.b64_json ? `data:image/png;base64,${image.b64_json}` : image.url;
      if (!url) return [];
      return [{
        type: "image" as const,
        url,
        alt: input.userMessage || `Generated image ${index + 1}`,
        prompt: input.userMessage,
        mimeType: image.b64_json ? "image/png" : undefined,
        metadata: {
          route: usesImageReferences ? "images_api_edit" : "images_api",
          generationSource: "openai_image_generation",
          imagePrompt: params.prompt,
          ...(personaReferenceFiles.length > 0 ? { personaVisualReferencePaths: directPersonaVisualReferencePaths(input) } : {}),
          ...(userReferenceFiles.length > 0 ? { userImageReferenceCount: userReferenceFiles.length } : {}),
          ...(image.revised_prompt ? { revisedPrompt: image.revised_prompt } : {})
        }
      }];
    });

    const output: LLMOutput = {
      provider: this.providerId,
      rawText: "",
      content,
      metadata: {
        providerModel: env.OPENAI_IMAGE_MODEL,
        status: "completed",
        background: false,
        openaiTools: [usesImageReferences ? "images.edit" : "images.generate"],
        promptMode: this.promptMode,
        route: usesImageReferences ? "images_api_edit" : "images_api",
        imageModeration: env.OPENAI_IMAGE_MODERATION,
        imageSize: env.OPENAI_IMAGE_SIZE,
        imageQuality: imageQuality(input)
      }
    };

    return llmOutputSchema.parse(output);
  }

  // FLUX.2 Pro image path: same image-only request shape as the OpenAI direct
  // Images API branch, same content-block output, billed via the
  // "flux_image_generation" generationSource. Reference images are the same
  // uploads and persona 360 references the OpenAI edit path uses.
  private async generateFluxImageResponse(input: LLMInput, signal?: AbortSignal): Promise<LLMOutput> {
    const hasPersonaVisualReferences = directPersonaVisualReferencePaths(input).length > 0;
    const hasUserImageReferences = (input.attachments ?? []).some((attachment) => attachment.kind === "image");
    const prompt = buildImageGenerationPrompt(input, {
      includePersonaVisualReferences: hasPersonaVisualReferences,
      includeUserImageReferences: hasUserImageReferences
    });
    const [userReferenceImages, personaReferenceImages] = await Promise.all([
      fluxUserReferenceImages(input),
      fluxPersonaReferenceImages(input)
    ]);
    // Persona identity refs come first so any truncation to the API's 8-image
    // limit drops user uploads rather than the persona's identity.
    const referenceImages = [...personaReferenceImages, ...userReferenceImages];
    const usesImageReferences = referenceImages.length > 0;
    // Edit follow-ups reuse the source image's recorded seed so the edit
    // preserves composition and identity; otherwise pin via env or draw a
    // fresh seed (recorded in the output for future follow-ups).
    const sourceSeed = (input.attachments ?? []).find((attachment) =>
      attachment.kind === "image" && typeof attachment.seed === "number"
    )?.seed;
    const seed = sourceSeed ?? env.BFL_IMAGE_SEED ?? Math.floor(Math.random() * 2 ** 31);
    const dimensions = fluxImageDimensions(input);
    const result = await createImageProvider("flux").generate({
      prompt,
      referenceImages,
      width: dimensions.width,
      height: dimensions.height,
      seed
    }, signal);

    const content: ContentBlock[] = result.images.map((image, index) => ({
      type: "image" as const,
      url: `data:${image.mimeType};base64,${image.dataBase64}`,
      alt: input.userMessage || `Generated image ${index + 1}`,
      prompt: input.userMessage,
      mimeType: image.mimeType,
      metadata: {
        route: usesImageReferences ? "flux_api_edit" : "flux_api",
        generationSource: "flux_image_generation",
        imagePrompt: prompt,
        ...(personaReferenceImages.length > 0 ? { personaVisualReferencePaths: directPersonaVisualReferencePaths(input) } : {}),
        ...(userReferenceImages.length > 0 ? { userImageReferenceCount: userReferenceImages.length } : {}),
        ...result.metadata
      }
    }));

    return llmOutputSchema.parse({
      provider: this.providerId,
      rawText: "",
      content,
      metadata: {
        providerModel: env.BFL_IMAGE_MODEL,
        status: "completed",
        background: false,
        route: usesImageReferences ? "flux_api_edit" : "flux_api",
        imageProvider: "flux"
      }
    });
  }

  async generateResponseStream(
    input: LLMInput,
    callbacks: LLMStreamCallbacks,
    signal?: AbortSignal,
    progressCallbacks?: LLMProgressCallbacks
  ): Promise<LLMOutput> {
    if (shouldUseFluxImageApi(input) && !(env.NODE_ENV === "test" && !env.OPENAI_RUN_INTEGRATION_TESTS)) {
      return this.generateFluxImageResponse(input, signal);
    }
    if (!env.OPENAI_API_KEY || (env.NODE_ENV === "test" && !env.OPENAI_RUN_INTEGRATION_TESTS)) {
      const output = buildStubOutput(input, this.providerId, this.promptMode);
      callbacks.onTextDelta(output.rawText);
      return output;
    }

    const client = new OpenAI({
      apiKey: env.OPENAI_API_KEY,
      timeout: this.requestTimeout(input),
      maxRetries: 0
    });
    // Same direct Images API path as generateResponse: without this branch a
    // streamed edit request falls through to the Responses API, which may
    // legally answer an image edit with text only.
    if (shouldUseDirectImageApi(input)) {
      return this.generateDirectImageResponse(client, input, signal);
    }

    const tools = buildOpenAITools(input);
    const responseInput = withStyleReference(input, this.promptMode, buildInput(input, this.promptMode));
    const applicationTrace: ContentBlock[] = [];
    let intermediateUsage: OpenAIItem | undefined;
    let response = await this.createStreamingResponse(client, input, responseInput, tools, callbacks, signal, progressCallbacks);

    for (let iteration = 0; iteration < env.OPENAI_MAX_TOOL_ITERATIONS; iteration += 1) {
      const calls = (response.output as OpenAIItem[]).filter((item) => item.type === "function_call");
      if (calls.length === 0) break;

      // Each loop iteration is a separate billed responses.create call; keep
      // its usage so metering reflects the true cost of multi-step turns.
      intermediateUsage = mergeUsage(intermediateUsage, response.usage as OpenAIItem | null | undefined);
      responseInput.push(...(response.output as OpenAIItem[]));
      for (const call of calls) {
        const { result, trace } = await runApplicationFunctionCall(call, input.clientContext);
        applicationTrace.push(...trace);
        responseInput.push({
          type: "function_call_output",
          call_id: call.call_id,
          output: JSON.stringify(result)
        });
      }
      signal?.throwIfAborted();
      response = await this.createStreamingResponse(client, input, responseInput, tools, callbacks, signal, progressCallbacks);
    }

    return this.formatResponse(response, input, tools, applicationTrace, intermediateUsage);
  }

  private formatResponse(response: OpenAIResponse, input: LLMInput, tools: OpenAIItem[], applicationTrace: ContentBlock[] = [], intermediateUsage?: OpenAIItem): LLMOutput {
    const mergedUsage = mergeUsage(intermediateUsage, response.usage as OpenAIItem | null | undefined);
    const usage = (mergedUsage ?? response.usage ?? null) as OpenAIItem | null;
    const rawText = extractOutputText(response);
    const dualText = parseDualTextPayload(rawText);
    const visibleText = dualText.payload?.visibleText ?? displayTextFromDualText(rawText);
    const inputTokens = finiteNonnegativeIntegerOr(usage?.input_tokens);
    const outputTokens = finiteNonnegativeIntegerOr(usage?.output_tokens);
    const estimatedCostUsd = usage
      ? (inputTokens * env.OPENAI_INPUT_COST_PER_MILLION +
          outputTokens * env.OPENAI_OUTPUT_COST_PER_MILLION) / 1_000_000
      : 0;
    const output: LLMOutput = {
      provider: this.providerId,
      rawText: visibleText,
      content: [...mapOutput(response, input.userMessage), ...applicationTrace],
      ...(usage ? {
        usage: {
          inputTokens,
          outputTokens,
          totalTokens: finiteNonnegativeIntegerOr(usage.total_tokens, inputTokens + outputTokens),
          cachedInputTokens: finiteNonnegativeIntegerOr(usage.input_tokens_details?.cached_tokens),
          reasoningTokens: finiteNonnegativeIntegerOr(usage.output_tokens_details?.reasoning_tokens),
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
    signal?: AbortSignal,
    progressCallbacks?: LLMProgressCallbacks
  ): Promise<OpenAIResponse> {
    const descriptionInput: LLMInput = {
      ...input,
      userMessage: "Describe the generated image.",
      toolOptions: {
        webSearch: false,
        fileSearch: false,
        codeInterpreter: false,
        imageGeneration: false,
        videoAnalysis: false,
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

    return this.createResponse(client, descriptionInput, descriptionInputItems, [], signal, progressCallbacks);
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
    signal?: AbortSignal,
    progressCallbacks?: LLMProgressCallbacks
  ): Promise<OpenAIResponse> {
    const params = this.responseParams(input, responseInput, tools);
    return withRetry(() => client.responses.create(params as any, { signal }), signal).catch((error) => {
      const unsupportedParam = unsupportedControlParameter(error);
      if (!unsupportedParam) throw error;
      return withRetry(() => client.responses.create(stripUnsupportedControlParam(params, unsupportedParam) as any, { signal }), signal);
    }).then((response) => this.resolveBackgroundResponse(client, input, response, signal, progressCallbacks));
  }

  private async resolveBackgroundResponse(
    client: OpenAI,
    input: LLMInput,
    response: OpenAIResponse,
    signal?: AbortSignal,
    progressCallbacks?: LLMProgressCallbacks
  ): Promise<OpenAIResponse> {
    if (typeof response?.id === "string") {
      progressCallbacks?.onProviderResponse?.({ id: response.id, status: response.status });
    }

    if (!input.toolOptions?.background || !response?.id) {
      return response;
    }

    let next = response;
    const startedAt = Date.now();
    const pollTimeoutMs = backgroundPollTimeoutMs(input);
    let intervalMs = env.OPENAI_BACKGROUND_POLL_INTERVAL_MS;

    while (isBackgroundPending(next)) {
      if (Date.now() - startedAt > pollTimeoutMs) {
        throw new Error(
          `OpenAI background response timed out after ${Math.round(pollTimeoutMs / 1000)} seconds (status: ${next.status ?? "unknown"}). Response ID: ${next.id}`
        );
      }

      await delay(intervalMs, signal);
      signal?.throwIfAborted();
      next = await withRetry(() => client.responses.retrieve(next.id, {
        include: RESPONSE_INCLUDE_FIELDS as any,
        stream: false
      } as any, { signal }) as Promise<OpenAIResponse>, signal);
      if (typeof next?.id === "string") {
        progressCallbacks?.onProviderResponse?.({ id: next.id, status: next.status });
      }
      intervalMs = Math.min(5000, Math.round(intervalMs * 1.25));
    }

    if (isBackgroundTerminalFailure(next)) {
      throw new Error(backgroundFailureMessage(next));
    }

    return next;
  }

  private async createStreamingResponse(
    client: OpenAI,
    input: LLMInput,
    responseInput: OpenAIItem[],
    tools: OpenAIItem[],
    callbacks: LLMStreamCallbacks,
    signal?: AbortSignal,
    progressCallbacks?: LLMProgressCallbacks
  ): Promise<OpenAIResponse> {
    const params = this.responseParams(input, responseInput, tools, true);
    const stream = await withRetry(() => client.responses.create({
      ...params,
      stream: true
    } as any, { signal }), signal).catch((error) => {
      const unsupportedParam = unsupportedControlParameter(error);
      if (!unsupportedParam) throw error;
      return withRetry(() => client.responses.create({
        ...stripUnsupportedControlParam(params, unsupportedParam),
        stream: true
      } as any, { signal }), signal);
    });
    let completedResponse: OpenAIResponse | undefined;
    let responseId: string | undefined;
    let streamedText = "";

    for await (const event of stream as any) {
      if (typeof event.response?.id === "string") {
        responseId = event.response.id;
      }
      if (event.type === "response.output_text.delta" && typeof event.delta === "string") {
        streamedText += event.delta;
        callbacks.onTextDelta(event.delta);
      } else if (event.type === "response.completed") {
        completedResponse = event.response;
        if (typeof completedResponse?.id === "string") {
          progressCallbacks?.onProviderResponse?.({ id: completedResponse.id, status: completedResponse.status });
        }
      } else if (event.type === "response.failed") {
        if (typeof event.response?.id === "string") {
          progressCallbacks?.onProviderResponse?.({ id: event.response.id, status: event.response.status });
        }
        throw new Error(event.response?.error?.message ?? "OpenAI streaming response failed.");
      } else if (event.type === "error") {
        throw new Error(event.message ?? "OpenAI streaming response failed.");
      }
    }

    // A proxy or transient network interruption can close the SSE connection
    // after OpenAI has created the response but before the final
    // `response.completed` event reaches us. Recover the already-billed
    // response by ID instead of starting a duplicate generation.
    if (!completedResponse && responseId) {
      const recoveryStartedAt = Date.now();
      const recoveryTimeoutMs = Math.min(env.OPENAI_BACKGROUND_POLL_TIMEOUT_MS, 30_000);
      let intervalMs = Math.min(env.OPENAI_BACKGROUND_POLL_INTERVAL_MS, 1_500);

      while (Date.now() - recoveryStartedAt <= recoveryTimeoutMs) {
        signal?.throwIfAborted();
        const recovered = await withRetry(() => client.responses.retrieve(responseId, {
          include: RESPONSE_INCLUDE_FIELDS as any,
          stream: false
        } as any, { signal }) as Promise<OpenAIResponse>, signal);
        progressCallbacks?.onProviderResponse?.({ id: responseId, status: recovered.status });

        if (recovered.status === "completed") {
          completedResponse = recovered;
          break;
        }
        if (isBackgroundTerminalFailure(recovered)) {
          throw new Error(backgroundFailureMessage(recovered));
        }

        await delay(intervalMs, signal);
        intervalMs = Math.min(5_000, Math.round(intervalMs * 1.25));
      }
    }

    if (!completedResponse) {
      throw new Error(
        responseId
          ? `OpenAI stream ended before completion and response recovery timed out. Response ID: ${responseId}`
          : "OpenAI stream ended without a completed response."
      );
    }
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

  private responseParams(input: LLMInput, responseInput: OpenAIItem[], tools: OpenAIItem[], streaming = false) {
    const controls = this.requestControls();
    // Streaming forwards output_text deltas verbatim to the client, so the
    // dual-text JSON envelope (visible_text/tts_script) must stay off there —
    // otherwise users watch raw JSON render character by character. Streamed
    // responses fall back to the mechanical TTS script builder.
    const inlineTtsScript = shouldRequestInlineTtsScript(input, this.promptMode) && !streaming;
    const text = {
      ...(controls.text ?? {}),
      ...(inlineTtsScript ? { format: dualTextResponseFormat() } : {})
    };

    return {
      model: env.OPENAI_MODEL,
      instructions: buildOpenAIResponseInstructions(input, this.promptMode, inlineTtsScript),
      input: responseInput as any,
      tools: tools as any,
      background: shouldUseOpenAIBackgroundMode(input),
      include: RESPONSE_INCLUDE_FIELDS,
      parallel_tool_calls: true,
      prompt_cache_key: `persona-${input.persona.id}`,
      prompt_cache_retention: "24h",
      max_output_tokens: maxOutputTokensForRequest(input.audio, input.conciseAudioResponse, input.toolOptions?.codeInterpreter),
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
        ...(inlineTtsScript ? { response_format: "visible_text_tts_script" } : {})
      }
    };
  }
}
