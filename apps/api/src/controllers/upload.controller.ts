import type { Request, Response } from "express";
import { z } from "zod";
import { uploadService } from "../services/uploadService.js";
import { HttpError } from "../utils/httpError.js";
import { optionalRequestOwnerId, requestOwnerId } from "../utils/requestIdentity.js";

const vectorStoreRequestSchema = z.object({
  assetIds: z.array(z.string()).min(1).max(20),
  name: z.string().max(100).optional()
});

export async function postUploads(request: Request, response: Response): Promise<void> {
  const files = request.files;
  if (!Array.isArray(files) || files.length === 0) throw new HttpError("At least one file is required.", 400);
  const assets = await Promise.all(files.map((file) => uploadService.save(requestOwnerId(request), file)));
  response.status(201).json({ assets });
}

export async function getUploads(request: Request, response: Response): Promise<void> {
  response.status(200).json({ assets: await uploadService.list(requestOwnerId(request)) });
}

export async function getUpload(request: Request, response: Response): Promise<void> {
  const asset = await uploadService.download(optionalRequestOwnerId(request), String(request.params.id));
  response.setHeader("Content-Disposition", `inline; filename="${asset.fileName.replaceAll('"', "")}"`);
  response.type(asset.mimeType).send(asset.buffer);
}

export async function deleteUpload(request: Request, response: Response): Promise<void> {
  await uploadService.remove(requestOwnerId(request), String(request.params.id));
  response.status(204).end();
}

export async function postVectorStore(request: Request, response: Response): Promise<void> {
  const payload = vectorStoreRequestSchema.parse(request.body);
  const vectorStore = await uploadService.createVectorStore(requestOwnerId(request), payload.assetIds, payload.name);
  response.status(201).json({ vectorStore });
}

export async function deleteVectorStore(request: Request, response: Response): Promise<void> {
  await uploadService.removeVectorStore(requestOwnerId(request), String(request.params.id));
  response.status(204).end();
}
