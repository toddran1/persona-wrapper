import { Router } from "express";
import {
  getMe,
  getOAuthProviders,
  postLogin,
  postLogout,
  postRefresh,
  postRegister
} from "../controllers/auth.controller.js";

export const authRouter = Router();

authRouter.post("/register", (request, response, next) => {
  postRegister(request, response).catch(next);
});

authRouter.post("/login", (request, response, next) => {
  postLogin(request, response).catch(next);
});

authRouter.post("/refresh", (request, response, next) => {
  postRefresh(request, response).catch(next);
});

authRouter.post("/logout", (request, response, next) => {
  postLogout(request, response).catch(next);
});

authRouter.get("/me", (request, response, next) => {
  getMe(request, response).catch(next);
});

authRouter.get("/oauth/providers", getOAuthProviders);
