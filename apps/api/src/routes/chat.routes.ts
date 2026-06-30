import { Router, type NextFunction, type Request, type Response } from "express";
import {
  cancelChatJob,
  deleteStyleTransferReviewRecord,
  getChatJob,
  getStyleTransferReview,
  patchStyleTransferReviewRecord,
  postStyleTransferReviewRecord,
  postPromoteRejectedStylePair,
  postChat,
  postChatStream,
  postStyleTransferEvalCapture
} from "../controllers/chat.controller.js";

export const chatRouter = Router();

function asyncHandler(handler: (request: Request, response: Response) => Promise<void>) {
  return (request: Request, response: Response, next: NextFunction) => {
    handler(request, response).catch(next);
  };
}

chatRouter.post("/", asyncHandler(postChat));
chatRouter.post("/stream", asyncHandler(postChatStream));
chatRouter.get("/jobs/:jobId", asyncHandler(getChatJob));
chatRouter.post("/jobs/:jobId/cancel", asyncHandler(cancelChatJob));
chatRouter.get("/style-transfer-review", asyncHandler(getStyleTransferReview));
chatRouter.post("/style-transfer-review", asyncHandler(postStyleTransferReviewRecord));
chatRouter.patch("/style-transfer-review", asyncHandler(patchStyleTransferReviewRecord));
chatRouter.delete("/style-transfer-review", asyncHandler(deleteStyleTransferReviewRecord));
chatRouter.post("/style-transfer-review/promote-rejected", asyncHandler(postPromoteRejectedStylePair));
chatRouter.post("/style-transfer-evals", asyncHandler(postStyleTransferEvalCapture));
