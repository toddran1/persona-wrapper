import type { Request, Response } from "express";
import { openAIArtifactService } from "../services/openAIArtifactService.js";

export async function getOpenAIArtifact(request: Request, response: Response): Promise<void> {
  const artifact = await openAIArtifactService.download(String(request.params.token));
  response.setHeader("Content-Disposition", `attachment; filename="${artifact.fileName.replaceAll('"', "")}"`);
  response.setHeader("Content-Type", artifact.body.headers.get("content-type") ?? "application/octet-stream");
  response.status(200).send(Buffer.from(await artifact.body.arrayBuffer()));
}
