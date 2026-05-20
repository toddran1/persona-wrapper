import { Router } from "express";
import { postChat, postStyleTransferEvalCapture } from "../controllers/chat.controller.js";

export const chatRouter = Router();

chatRouter.post("/", postChat);
chatRouter.post("/style-transfer-evals", postStyleTransferEvalCapture);
