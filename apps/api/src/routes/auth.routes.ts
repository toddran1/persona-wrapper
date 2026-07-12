import { Router } from "express";
import { authRateLimit } from "../middleware/authRateLimit.js";
import {
  getMe,
  getOAuthCallback,
  getOAuthProviders,
  getOAuthStart,
  deleteAccount,
  postLogin,
  postLogout,
  postOAuthExchange,
  postRefresh,
  postRegister,
  postRestoreAccount
} from "../controllers/auth.controller.js";

export const authRouter = Router();

authRouter.use(["/login", "/register", "/restore", "/refresh", "/oauth/exchange", "/oauth/:provider/start", "/account"], authRateLimit);

authRouter.post("/register", (request, response, next) => {
  postRegister(request, response).catch(next);
});

authRouter.post("/login", (request, response, next) => {
  postLogin(request, response).catch(next);
});

authRouter.post("/restore", (request, response, next) => {
  postRestoreAccount(request, response).catch(next);
});

authRouter.delete("/account", (request, response, next) => {
  deleteAccount(request, response).catch(next);
});

authRouter.post("/refresh", (request, response, next) => {
  postRefresh(request, response).catch(next);
});

authRouter.post("/oauth/exchange", (request, response, next) => {
  postOAuthExchange(request, response).catch(next);
});

authRouter.post("/logout", (request, response, next) => {
  postLogout(request, response).catch(next);
});

authRouter.get("/me", (request, response, next) => {
  getMe(request, response).catch(next);
});

authRouter.get("/oauth/providers", getOAuthProviders);

authRouter.get("/oauth/:provider/start", (request, response, next) => {
  getOAuthStart(request, response).catch(next);
});

authRouter.get("/oauth/:provider/callback", (request, response, next) => {
  getOAuthCallback(request, response).catch(next);
});
