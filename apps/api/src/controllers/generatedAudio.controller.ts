import type { Request, Response } from "express";
import { generatedAudioService } from "../services/generatedAudioService.js";
import { requestAuthenticatedOwnerId } from "../utils/requestIdentity.js";
import { contentDisposition } from "../utils/httpHeaders.js";

export async function getGeneratedAudio(request: Request, response: Response): Promise<void> {
  const audio = await generatedAudioService.download(String(request.params.token), requestAuthenticatedOwnerId(request));
  response.setHeader("Content-Disposition", contentDisposition("inline", audio.fileName));
  response.setHeader("Content-Type", audio.mimeType);
  response.status(200).send(audio.buffer);
}
