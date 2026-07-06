import { Router, type NextFunction, type Request, type Response } from "express";
import {
  cancelChatJob,
  deleteConversation,
  deleteStyleTransferReviewRecord,
  getConversation,
  getChatJob,
  getStyleTransferReview,
  listConversations,
  patchConversation,
  patchStyleTransferReviewRecord,
  postStyleTransferReviewRecord,
  postPromoteRejectedStylePair,
  postChat,
  postChatStream,
  postStyleTransferEvalCapture
} from "../controllers/chat.controller.js";
import { env } from "../config/env.js";
import { HttpError } from "../utils/httpError.js";

export const chatRouter = Router();

function asyncHandler(handler: (request: Request, response: Response) => Promise<void>) {
  return (request: Request, response: Response, next: NextFunction) => {
    handler(request, response).catch(next);
  };
}

export function requireTestMode(request: Request, _response: Response, next: NextFunction): void {
  if (env.APP_TEST_MODE) {
    next();
    return;
  }

  next(new HttpError(`${request.path} is only available in test mode.`, 404));
}

chatRouter.post("/", asyncHandler(postChat));
chatRouter.post("/stream", asyncHandler(postChatStream));
chatRouter.get("/conversations", asyncHandler(listConversations));
chatRouter.get("/conversations/:conversationId", asyncHandler(getConversation));
chatRouter.patch("/conversations/:conversationId", asyncHandler(patchConversation));
chatRouter.delete("/conversations/:conversationId", asyncHandler(deleteConversation));
chatRouter.get("/jobs/:jobId", asyncHandler(getChatJob));
chatRouter.post("/jobs/:jobId/cancel", asyncHandler(cancelChatJob));
chatRouter.get("/style-transfer-review", requireTestMode, asyncHandler(getStyleTransferReview));
chatRouter.post("/style-transfer-review", requireTestMode, asyncHandler(postStyleTransferReviewRecord));
chatRouter.patch("/style-transfer-review", requireTestMode, asyncHandler(patchStyleTransferReviewRecord));
chatRouter.delete("/style-transfer-review", requireTestMode, asyncHandler(deleteStyleTransferReviewRecord));
chatRouter.post("/style-transfer-review/promote-rejected", requireTestMode, asyncHandler(postPromoteRejectedStylePair));
chatRouter.post("/style-transfer-evals", requireTestMode, asyncHandler(postStyleTransferEvalCapture));
