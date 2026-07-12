import { Router, type NextFunction, type Request, type Response } from "express";
import { getAccountDataExport, postConversationDataExport, postDataImport } from "../controllers/dataTransfer.controller.js";

export const dataTransferRouter = Router();

function asyncHandler(handler: (request: Request, response: Response) => Promise<void>) {
  return (request: Request, response: Response, next: NextFunction) => handler(request, response).catch(next);
}

dataTransferRouter.get("/export/account", asyncHandler(getAccountDataExport));
dataTransferRouter.post("/export/conversations", asyncHandler(postConversationDataExport));
dataTransferRouter.post("/import", asyncHandler(postDataImport));
