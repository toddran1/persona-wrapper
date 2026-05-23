import { Router } from "express";
import {
  deleteStyleTransferReviewRecord,
  getStyleTransferReview,
  patchStyleTransferReviewRecord,
  postStyleTransferReviewRecord,
  postChat,
  postStyleTransferEvalCapture
} from "../controllers/chat.controller.js";

export const chatRouter = Router();

chatRouter.post("/", postChat);
chatRouter.get("/style-transfer-review", getStyleTransferReview);
chatRouter.post("/style-transfer-review", postStyleTransferReviewRecord);
chatRouter.patch("/style-transfer-review", patchStyleTransferReviewRecord);
chatRouter.delete("/style-transfer-review", deleteStyleTransferReviewRecord);
chatRouter.post("/style-transfer-evals", postStyleTransferEvalCapture);
