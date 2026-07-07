import type { Request, Response } from "express";
import {
  loginRequestSchema,
  refreshAuthRequestSchema,
  registerRequestSchema,
  type AuthClientType
} from "@persona/shared";
import { authService } from "../services/authService.js";
import { requestBearerToken } from "../middleware/authMiddleware.js";
import { HttpError } from "../utils/httpError.js";

function requestMetadata(request: Request): { userAgent?: string; ipAddress?: string } {
  const metadata: { userAgent?: string; ipAddress?: string } = {};
  const userAgent = request.header("user-agent");
  if (userAgent) metadata.userAgent = userAgent;
  if (request.ip) metadata.ipAddress = request.ip;
  return metadata;
}

function clientTypeFromHeader(request: Request): AuthClientType {
  const value = request.header("x-client-type");
  if (value === "web" || value === "desktop" || value === "ios" || value === "android") return value;
  return "unknown";
}

export async function postRegister(request: Request, response: Response): Promise<void> {
  const payload = registerRequestSchema.parse({
    clientType: clientTypeFromHeader(request),
    ...request.body
  });
  const auth = await authService.register(payload, requestMetadata(request));
  response.status(201).json(auth);
}

export async function postLogin(request: Request, response: Response): Promise<void> {
  const payload = loginRequestSchema.parse({
    clientType: clientTypeFromHeader(request),
    ...request.body
  });
  const auth = await authService.login(payload, requestMetadata(request));
  response.status(200).json(auth);
}

export async function postRefresh(request: Request, response: Response): Promise<void> {
  const payload = refreshAuthRequestSchema.parse({
    clientType: clientTypeFromHeader(request),
    ...request.body
  });
  const auth = await authService.refresh(payload, requestMetadata(request));
  response.status(200).json(auth);
}

export async function postLogout(request: Request, response: Response): Promise<void> {
  const refreshToken = typeof request.body?.refreshToken === "string" ? request.body.refreshToken : undefined;
  const accessToken = requestBearerToken(request);
  const payload: { accessToken?: string; refreshToken?: string } = {};
  if (accessToken) payload.accessToken = accessToken;
  if (refreshToken) payload.refreshToken = refreshToken;
  await authService.logout(payload);
  response.status(204).send();
}

export async function getMe(request: Request, response: Response): Promise<void> {
  if (!request.auth) throw new HttpError("Not authenticated.", 401);
  const payload = await authService.getSession(request.auth.sessionId);
  response.status(200).json(payload);
}

export function getOAuthProviders(_request: Request, response: Response): void {
  response.status(200).json({ providers: authService.oauthProviderStatus() });
}
