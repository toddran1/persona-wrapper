import { env } from "../../config/env.js";
import { logger } from "../../utils/logger.js";
import { HttpError } from "../../utils/httpError.js";
import type {
  GeneratedImage,
  ImageGenerationInput,
  ImageGenerationOutput,
  ImageProvider
} from "./ImageProvider.js";

const MAX_REFERENCE_IMAGES = 8;
const MAX_SUBMIT_RETRIES = 2;
const MAX_POLL_FAILURES = 3;
const TERMINAL_FAILURE_STATUSES = new Set(["Error", "Task not found"]);
const MODERATION_STATUSES = new Set(["Request Moderated", "Content Moderated"]);
const IN_FLIGHT_STATUSES = new Set(["Pending", "Reasoning", "Generating"]);

type FetchImpl = typeof fetch;

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new DOMException("The operation was aborted.", "AbortError"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function combinedSignal(signal: AbortSignal | undefined, timeoutMs: number): AbortSignal {
  const timeout = AbortSignal.timeout(timeoutMs);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

/**
 * Black Forest Labs FLUX.2 Pro (https://docs.bfl.ml). One endpoint handles
 * text-to-image and multi-reference editing; generation is asynchronous
 * (submit, then poll the returned polling_url until Ready). The sample URL
 * expires within minutes, so the image is downloaded and re-encoded here.
 */
export class FluxImageProvider implements ImageProvider {
  readonly providerId = "flux" as const;

  constructor(private readonly fetchImpl: FetchImpl = fetch) {}

  async generate(input: ImageGenerationInput, signal?: AbortSignal): Promise<ImageGenerationOutput> {
    if (!env.BFL_API_KEY) {
      throw new HttpError("FLUX image generation is not configured on this server.", 503);
    }

    const edited = input.referenceImages.length > 0;
    const body: Record<string, unknown> = {
      prompt: input.prompt,
      width: input.width,
      height: input.height,
      // 5 is the least restrictive value the BFL API accepts; anything higher
      // requires explicit BFL approval on the account.
      safety_tolerance: env.BFL_IMAGE_SAFETY_TOLERANCE,
      output_format: env.BFL_IMAGE_OUTPUT_FORMAT,
      // Persona and reference-image prompts are already assembled by the app;
      // skip BFL's prompt upsampling so they pass through verbatim.
      disable_pup: true,
      ...(input.seed !== undefined ? { seed: input.seed } : {})
    };
    // FLUX.2 accepts up to 8 reference images as input_image..input_image_8.
    if (input.referenceImages.length > MAX_REFERENCE_IMAGES) {
      logger.warn("FLUX reference images truncated to the API limit", {
        provided: input.referenceImages.length,
        limit: MAX_REFERENCE_IMAGES
      });
    }
    input.referenceImages.slice(0, MAX_REFERENCE_IMAGES).forEach((image, index) => {
      body[index === 0 ? "input_image" : `input_image_${index + 1}`] = image.dataBase64;
    });

    // One overall budget covers submit + polling (the sample download has its
    // own short timeout since the URL expires quickly).
    const deadline = Date.now() + env.BFL_IMAGE_REQUEST_TIMEOUT_MS;
    const submission = await this.submitWithRetry(body, signal, deadline);
    const result = await this.pollUntilSettled(submission.polling_url, signal, deadline);
    const images = await this.downloadImages(result.sampleUrls, signal);

    return {
      images,
      provider: this.providerId,
      metadata: {
        taskId: submission.id,
        edited,
        model: env.BFL_IMAGE_MODEL,
        safetyTolerance: env.BFL_IMAGE_SAFETY_TOLERANCE,
        ...(input.seed !== undefined ? { seed: input.seed } : {}),
        ...(typeof submission.cost === "number" ? { providerCostCredits: submission.cost } : {}),
        ...(typeof submission.inputMp === "number" ? { inputMp: submission.inputMp } : {}),
        ...(typeof submission.outputMp === "number" ? { outputMp: submission.outputMp } : {})
      }
    };
  }

  private async submitWithRetry(body: Record<string, unknown>, signal: AbortSignal | undefined, deadline: number): Promise<{
    id: string;
    polling_url: string;
    cost?: number;
    inputMp?: number;
    outputMp?: number;
  }> {
    let attempt = 0;
    for (;;) {
      signal?.throwIfAborted();
      if (Date.now() > deadline) {
        throw new HttpError("Image generation timed out. Please try again.", 504);
      }
      let response: Response;
      try {
        response = await this.fetchImpl(`${env.BFL_API_BASE_URL}/v1/${env.BFL_IMAGE_MODEL}`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-key": env.BFL_API_KEY!
          },
          body: JSON.stringify(body),
          signal: combinedSignal(signal, 30_000)
        });
      } catch (error) {
        throw this.networkError(error, signal);
      }

      if (response.status === 429 || response.status >= 500) {
        if (attempt < MAX_SUBMIT_RETRIES) {
          attempt += 1;
          await sleep(Math.min(4_000, 500 * 2 ** attempt), signal);
          continue;
        }
        logger.warn("FLUX image submission failed after retries", { status: response.status });
        throw new HttpError("Image generation is temporarily unavailable. Please try again.", 502);
      }
      if (response.status === 402) {
        throw new HttpError("Image generation is temporarily unavailable. Please try again later.", 503);
      }
      if (!response.ok) {
        logger.warn("FLUX image submission rejected", { status: response.status });
        throw new HttpError("The image request could not be completed. Try a different prompt.", 400);
      }

      const payload = await this.parseJson(response);
      if (typeof payload.id !== "string" || typeof payload.polling_url !== "string") {
        throw new HttpError("The image service returned an unexpected response.", 502);
      }
      return {
        id: payload.id,
        polling_url: payload.polling_url,
        ...(typeof payload.cost === "number" ? { cost: payload.cost } : {}),
        ...(typeof payload.input_mp === "number" ? { inputMp: payload.input_mp } : {}),
        ...(typeof payload.output_mp === "number" ? { outputMp: payload.output_mp } : {})
      };
    }
  }

  private async pollUntilSettled(pollingUrl: string, signal: AbortSignal | undefined, deadline: number): Promise<{ sampleUrls: string[] }> {
    let consecutiveFailures = 0;
    for (;;) {
      signal?.throwIfAborted();
      if (Date.now() > deadline) {
        throw new HttpError("Image generation timed out. Please try again.", 504);
      }
      let response: Response;
      try {
        response = await this.fetchImpl(pollingUrl, {
          headers: { "x-key": env.BFL_API_KEY! },
          signal: combinedSignal(signal, 30_000)
        });
      } catch (error) {
        // A transient poll error must not kill a running (billable) task.
        if (signal?.aborted) throw this.networkError(error, signal);
        consecutiveFailures += 1;
        if (consecutiveFailures >= MAX_POLL_FAILURES) throw this.networkError(error, signal);
        await sleep(env.BFL_IMAGE_POLL_INTERVAL_MS, signal);
        continue;
      }
      if (!response.ok) {
        consecutiveFailures += 1;
        if (consecutiveFailures >= MAX_POLL_FAILURES) {
          logger.warn("FLUX image polling failed after retries", { status: response.status });
          throw new HttpError("Image generation is temporarily unavailable. Please try again.", 502);
        }
        await sleep(env.BFL_IMAGE_POLL_INTERVAL_MS, signal);
        continue;
      }
      consecutiveFailures = 0;
      const payload = await this.parseJson(response);
      const status = typeof payload.status === "string" ? payload.status : "";
      if (status === "Ready") {
        const sample = payload.result && typeof payload.result === "object"
          ? (payload.result as Record<string, unknown>).sample
          : undefined;
        if (typeof sample !== "string" || !sample) {
          throw new HttpError("The image service returned an unexpected response.", 502);
        }
        return { sampleUrls: [sample] };
      }
      if (MODERATION_STATUSES.has(status)) {
        // Surface the moderation outcome in server logs for diagnosis; the
        // user-facing message stays generic.
        logger.warn("FLUX image task moderated", {
          status,
          details: payload.details === undefined ? undefined : JSON.stringify(payload.details).slice(0, 500)
        });
        throw new HttpError("The image service flagged this request. Try a different prompt or reference image.", 422);
      }
      if (TERMINAL_FAILURE_STATUSES.has(status)) {
        logger.warn("FLUX image task failed", { status });
        throw new HttpError("The image request could not be completed. Please try again.", 502);
      }
      if (!IN_FLIGHT_STATUSES.has(status)) {
        throw new HttpError("The image service returned an unexpected response.", 502);
      }
      await sleep(env.BFL_IMAGE_POLL_INTERVAL_MS, signal);
    }
  }

  private async downloadImages(sampleUrls: string[], signal?: AbortSignal): Promise<GeneratedImage[]> {
    const mimeType = `image/${env.BFL_IMAGE_OUTPUT_FORMAT}`;
    return Promise.all(sampleUrls.map(async (url) => {
      let response: Response;
      try {
        // BFL sample URLs expire within minutes — download immediately.
        response = await this.fetchImpl(url, { signal: combinedSignal(signal, 60_000) });
      } catch (error) {
        throw this.networkError(error, signal);
      }
      if (!response.ok) {
        throw new HttpError("The generated image could not be retrieved. Please try again.", 502);
      }
      const buffer = Buffer.from(await response.arrayBuffer());
      return { dataBase64: buffer.toString("base64"), mimeType };
    }));
  }

  private async parseJson(response: Response): Promise<Record<string, unknown>> {
    try {
      return await response.json() as Record<string, unknown>;
    } catch {
      throw new HttpError("The image service returned an unexpected response.", 502);
    }
  }

  private networkError(error: unknown, signal?: AbortSignal): Error {
    // Caller-cancelled requests propagate the abort as-is; everything else is
    // mapped to a public-safe error that hides provider internals.
    if (signal?.aborted && error instanceof DOMException && error.name === "AbortError") return error;
    if (error instanceof Error && error.name === "TimeoutError") {
      return new HttpError("Image generation timed out. Please try again.", 504);
    }
    if (error instanceof HttpError) return error;
    return new HttpError("Image generation is temporarily unavailable. Please try again.", 502);
  }
}
