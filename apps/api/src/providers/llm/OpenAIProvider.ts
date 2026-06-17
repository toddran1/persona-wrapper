import OpenAI from "openai";
import type { ContentBlock, LLMInput, LLMOutput, ToolDefinition } from "@persona/shared";
import { llmOutputSchema } from "@persona/shared";
import { env } from "../../config/env.js";
import { executeApplicationTool } from "../tools/toolRegistry.js";
import { openAIArtifactService } from "../../services/openAIArtifactService.js";
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

function buildInput(input: LLMInput): OpenAIItem[] {
  const messages = (input.baseMessages ?? input.messages)
    .filter((message) => message.role !== "system")
    .slice(0, -1)
    .map((message) => ({
      role: message.role === "tool" ? "user" : message.role,
      content: message.content
    }));

  return [...messages, { role: "user", content: inputContent(input) }];
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
    tools.push({ type: "image_generation", action: "auto" });
  }
  if (options.appFunctions) {
    tools.push(...applicationFunctionTools(input.toolDefinitions));
  }

  return tools;
}

function responseInstructions(input: LLMInput): string {
  const instructions = input.baseSystemPrompt ?? input.systemPrompt;
  const extraInstructions: string[] = [];

  if (input.toolOptions?.codeInterpreter) {
    extraInstructions.push(
      "The user is requesting data analysis, calculations, charts, dashboards, or generated files. Use Code Interpreter for this work when it is available. If the user asks for a chart, graph, plot, dashboard, CSV, spreadsheet, or downloadable file, create the actual artifact instead of only describing it in text. Keep any explanatory text concise."
    );
  }

  if (input.toolOptions?.imageGeneration) {
    extraInstructions.push(
      "The user is requesting an image. Use the image generation tool to produce the image. Do not answer that you cannot generate images when the image_generation tool is available. Keep any text response short and do not send generated image data through persona style transfer."
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

function hasCodeInterpreterCall(response: OpenAIResponse): boolean {
  return ((response.output as OpenAIItem[] | undefined) ?? []).some((item) => item.type === "code_interpreter_call");
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
  const outputText = stripArtifactLinks(rawOutputText);
  if (outputText.trim()) {
    blocks.push({ type: "text", text: outputText });
  }
  blocks.push(...mediaLinkBlocksFromText(rawOutputText, prompt));

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
  if (blocks.length === 0) {
    blocks.push({
      type: "status",
      status: response.status === "failed" ? "failed" : response.status === "completed" ? "completed" : "in_progress",
      message: `OpenAI response ${response.status}.`
    });
  }
  return blocks;
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
  async generateResponse(input: LLMInput, signal?: AbortSignal): Promise<LLMOutput> {
    if (!env.OPENAI_API_KEY || (env.NODE_ENV === "test" && !env.OPENAI_RUN_INTEGRATION_TESTS)) {
      return buildStubOutput(input, "openai", "base");
    }

    const client = new OpenAI({
      apiKey: env.OPENAI_API_KEY,
      timeout: env.OPENAI_REQUEST_TIMEOUT_MS,
      maxRetries: 0
    });
    const tools = buildTools(input);
    const responseInput = buildInput(input);
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
      const output = buildStubOutput(input, "openai", "base");
      callbacks.onTextDelta(output.rawText);
      return output;
    }

    const client = new OpenAI({
      apiKey: env.OPENAI_API_KEY,
      timeout: env.OPENAI_REQUEST_TIMEOUT_MS,
      maxRetries: 0
    });
    const tools = buildTools(input);
    const responseInput = buildInput(input);
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
    const estimatedCostUsd = usage
      ? ((usage.input_tokens ?? 0) * env.OPENAI_INPUT_COST_PER_MILLION +
          (usage.output_tokens ?? 0) * env.OPENAI_OUTPUT_COST_PER_MILLION) / 1_000_000
      : 0;
    const output: LLMOutput = {
      provider: "openai",
      rawText: extractOutputText(response),
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
        openaiTools: tools.map((tool) => tool.type)
      }
    };

    return llmOutputSchema.parse(output);
  }

  private createResponse(
    client: OpenAI,
    input: LLMInput,
    responseInput: OpenAIItem[],
    tools: OpenAIItem[],
    signal?: AbortSignal
  ): Promise<OpenAIResponse> {
    return withRetry(() => client.responses.create(this.responseParams(input, responseInput, tools) as any, { signal }));
  }

  private async createStreamingResponse(
    client: OpenAI,
    input: LLMInput,
    responseInput: OpenAIItem[],
    tools: OpenAIItem[],
    callbacks: LLMStreamCallbacks,
    signal?: AbortSignal
  ): Promise<OpenAIResponse> {
    const stream = await withRetry(() => client.responses.create({
      ...this.responseParams(input, responseInput, tools),
      stream: true
    } as any, { signal }));
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

  private responseParams(input: LLMInput, responseInput: OpenAIItem[], tools: OpenAIItem[]) {
    return {
      model: env.OPENAI_MODEL,
      instructions: responseInstructions(input),
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
      max_output_tokens: 4096,
      metadata: {
        persona_id: input.persona.id
      }
    };
  }
}
