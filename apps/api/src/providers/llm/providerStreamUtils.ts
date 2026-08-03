import { HttpError } from "../../utils/httpError.js";
import { env } from "../../config/env.js";

export async function readProviderError(response: Response, providerName: string): Promise<HttpError> {
  await response.body?.cancel().catch(() => undefined);
  return new HttpError(`${providerName} could not complete the request. Please try again.`, 502);
}

export function shouldUseProviderStub(apiKey: string | undefined): boolean {
  return !apiKey || env.NODE_ENV === "test" || env.APP_TEST_MODE;
}

export async function consumeJsonSse(
  response: Response,
  onEvent: (eventName: string, payload: Record<string, unknown>) => void
): Promise<void> {
  if (!response.body) throw new HttpError("The model provider did not return a response stream.", 502);
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  const processFrame = (frame: string) => {
    let eventName = "message";
    const data: string[] = [];
    for (const line of frame.split(/\r?\n/)) {
      if (line.startsWith("event:")) eventName = line.slice(6).trim();
      else if (line.startsWith("data:")) data.push(line.slice(5).trimStart());
    }
    const raw = data.join("\n").trim();
    if (!raw || raw === "[DONE]") return;
    try {
      const payload = JSON.parse(raw) as unknown;
      if (typeof payload === "object" && payload !== null) onEvent(eventName, payload as Record<string, unknown>);
    } catch {
      throw new HttpError("The model provider returned an invalid streaming event.", 502);
    }
  };

  try {
    while (true) {
      const chunk = await reader.read();
      buffer += decoder.decode(chunk.value, { stream: !chunk.done });
      let boundary = buffer.search(/\r?\n\r?\n/);
      while (boundary >= 0) {
        const frame = buffer.slice(0, boundary);
        const matchedSeparator = buffer.slice(boundary).match(/^\r?\n\r?\n/)?.[0] ?? "\n\n";
        buffer = buffer.slice(boundary + matchedSeparator.length);
        if (frame.trim()) processFrame(frame);
        boundary = buffer.search(/\r?\n\r?\n/);
      }
      if (chunk.done) break;
    }
    if (buffer.trim()) processFrame(buffer);
  } finally {
    reader.releaseLock();
  }
}

export function assertTextOnlyProviderRequest(input: {
  attachments?: unknown[] | undefined;
  toolOptions?: {
    webSearch?: boolean;
    fileSearch?: boolean;
    codeInterpreter?: boolean;
    imageGeneration?: boolean;
  } | undefined;
}, providerName: string): void {
  const tools = input.toolOptions;
  if (
    (input.attachments?.length ?? 0) > 0
    || tools?.webSearch
    || tools?.fileSearch
    || tools?.codeInterpreter
    || tools?.imageGeneration
  ) {
    throw new HttpError(`${providerName} currently supports text chat only in this app. Switch to OpenAI for files, search, code, or image generation.`, 400);
  }
}
