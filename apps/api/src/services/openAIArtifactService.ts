import { randomUUID } from "node:crypto";
import OpenAI from "openai";
import { env } from "../config/env.js";
import { HttpError } from "../utils/httpError.js";

type Artifact = {
  token: string;
  containerId: string;
  fileId: string;
  fileName: string;
  expiresAt: number;
};

export class OpenAIArtifactService {
  private readonly artifacts = new Map<string, Artifact>();

  register(containerId: string, fileId: string, fileName: string): string {
    this.cleanup();
    const token = randomUUID();
    this.artifacts.set(token, {
      token,
      containerId,
      fileId,
      fileName,
      expiresAt: env.UPLOAD_TTL_HOURS <= 0 ? Number.POSITIVE_INFINITY : Date.now() + env.UPLOAD_TTL_HOURS * 60 * 60 * 1000
    });
    return `/api/openai-artifacts/${token}`;
  }

  async download(token: string): Promise<{ body: Response; fileName: string }> {
    this.cleanup();
    const artifact = this.artifacts.get(token);
    if (!artifact || !env.OPENAI_API_KEY) throw new HttpError("Generated file not found.", 404);
    const client = new OpenAI({ apiKey: env.OPENAI_API_KEY, timeout: env.OPENAI_REQUEST_TIMEOUT_MS });
    const body = await client.containers.files.content.retrieve(artifact.fileId, {
      container_id: artifact.containerId
    });
    return { body, fileName: artifact.fileName };
  }

  private cleanup(): void {
    const now = Date.now();
    for (const artifact of this.artifacts.values()) {
      if (artifact.expiresAt <= now) this.artifacts.delete(artifact.token);
    }
  }
}

export const openAIArtifactService = new OpenAIArtifactService();
