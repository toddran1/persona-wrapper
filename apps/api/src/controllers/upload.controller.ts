import type { Request, Response } from "express";
import { vectorStoreRequestSchema } from "@persona/shared";
import { uploadService } from "../services/uploadService.js";
import { HttpError } from "../utils/httpError.js";
import { requestAuthenticatedOwnerId, requestOwnerId } from "../utils/requestIdentity.js";
import { contentDisposition } from "../utils/httpHeaders.js";

export async function postUploads(request: Request, response: Response): Promise<void> {
  const files = request.files;
  if (!Array.isArray(files) || files.length === 0) throw new HttpError("At least one file is required.", 400);
  const ownerId = requestOwnerId(request);
  const assets = [];
  try {
    // Process as one logical batch. If a later file fails validation or
    // persistence, roll back files that already succeeded.
    for (const file of files) assets.push(await uploadService.save(ownerId, file));
    response.status(201).json({ assets });
  } catch (error) {
    await Promise.allSettled(assets.map((asset) => uploadService.remove(ownerId, asset.id)));
    throw error;
  }
}

export async function getUploads(request: Request, response: Response): Promise<void> {
  response.status(200).json({ assets: await uploadService.list(requestOwnerId(request)) });
}

export async function getUpload(request: Request, response: Response): Promise<void> {
  const asset = await uploadService.download(requestAuthenticatedOwnerId(request), String(request.params.id));
  response.setHeader("Content-Disposition", contentDisposition("inline", asset.fileName));
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
