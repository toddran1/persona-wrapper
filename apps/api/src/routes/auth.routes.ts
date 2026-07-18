import { Router } from "express";
import { deleteAccount, getOAuthProviders, restoreAccount } from "../controllers/account.controller.js";
import { authRateLimit } from "../middleware/authRateLimit.js";

export const authRouter = Router();

authRouter.post("/restore", authRateLimit, (request, response, next) => {
  restoreAccount(request, response).catch(next);
});

authRouter.delete("/", authRateLimit, (request, response, next) => {
  deleteAccount(request, response).catch(next);
});

authRouter.get("/oauth/providers", getOAuthProviders);
