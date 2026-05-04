import { Router } from "express";
import { postChat } from "../controllers/chat.controller.js";

export const chatRouter = Router();

chatRouter.post("/", postChat);

