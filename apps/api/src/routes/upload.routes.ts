import { Router, type NextFunction, type Request, type Response } from "express";
import multer from "multer";
import { env } from "../config/env.js";
import {
  getUpload,
  postUploads
} from "../controllers/upload.controller.js";

export const uploadRouter = Router();
const upload = multer({
  storage: multer.memoryStorage(),
  // The legacy API fallback buffers files in memory. Clients upload one file
  // per request so a multi-image batch cannot consume hundreds of MB at once.
  limits: { fileSize: env.UPLOAD_MAX_BYTES, files: 1 }
});

function asyncHandler(handler: (request: Request, response: Response) => Promise<void>) {
  return (request: Request, response: Response, next: NextFunction) => handler(request, response).catch(next);
}

uploadRouter.post("/", upload.array("files", 1), asyncHandler(postUploads));
uploadRouter.get("/:id", asyncHandler(getUpload));
