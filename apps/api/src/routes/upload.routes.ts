import { Router, type NextFunction, type Request, type Response } from "express";
import multer from "multer";
import { env } from "../config/env.js";
import {
  deleteUpload,
  deleteVectorStore,
  getUpload,
  getUploads,
  postUploads,
  postVectorStore
} from "../controllers/upload.controller.js";

export const uploadRouter = Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: env.UPLOAD_MAX_BYTES, files: 10 }
});

function asyncHandler(handler: (request: Request, response: Response) => Promise<void>) {
  return (request: Request, response: Response, next: NextFunction) => handler(request, response).catch(next);
}

uploadRouter.get("/", asyncHandler(getUploads));
uploadRouter.post("/", upload.array("files", 10), asyncHandler(postUploads));
uploadRouter.post("/vector-stores", asyncHandler(postVectorStore));
uploadRouter.delete("/vector-stores/:id", asyncHandler(deleteVectorStore));
uploadRouter.get("/:id", asyncHandler(getUpload));
uploadRouter.delete("/:id", asyncHandler(deleteUpload));
