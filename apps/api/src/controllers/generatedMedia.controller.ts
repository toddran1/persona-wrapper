import type { Request, Response } from "express";
import { generatedMediaService } from "../services/generatedMediaService.js";
import { requestAuthenticatedOwnerId } from "../utils/requestIdentity.js";
import { contentDisposition } from "../utils/httpHeaders.js";

export async function getGeneratedMedia(request: Request, response: Response): Promise<void> {
  const media = await generatedMediaService.download(String(request.params.fileName), requestAuthenticatedOwnerId(request));
  response.setHeader("Content-Disposition", contentDisposition("inline", media.fileName));
  response.setHeader("Content-Type", media.mimeType);
  response.status(200).send(media.buffer);
}
