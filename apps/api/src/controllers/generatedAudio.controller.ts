import type { Request, Response } from "express";
import { generatedAudioService } from "../services/generatedAudioService.js";
import { requestAuthenticatedOwnerId } from "../utils/requestIdentity.js";

export async function getGeneratedAudio(request: Request, response: Response): Promise<void> {
  const audio = await generatedAudioService.download(String(request.params.token), requestAuthenticatedOwnerId(request));
  response.setHeader("Content-Disposition", `inline; filename="${audio.fileName.replaceAll('"', "")}"`);
  response.setHeader("Content-Type", audio.mimeType);
  response.status(200).send(audio.buffer);
}
