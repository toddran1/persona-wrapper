import type { Request, Response } from "express";
import { openAIArtifactService } from "../services/openAIArtifactService.js";
import { optionalRequestOwnerId } from "../utils/requestIdentity.js";

export async function getOpenAIArtifact(request: Request, response: Response): Promise<void> {
  const artifact = await openAIArtifactService.download(String(request.params.token), optionalRequestOwnerId(request));
  response.setHeader("Content-Disposition", `attachment; filename="${artifact.fileName.replaceAll('"', "")}"`);
  response.setHeader("Content-Type", artifact.mimeType);
  response.status(200).send(artifact.buffer);
}
