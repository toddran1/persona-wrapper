import type { Request, Response } from "express";
import {
  loginRequestSchema,
  oauthProviderSchema,
  refreshAuthRequestSchema,
  registerRequestSchema,
  type AuthClientType,
  type OAuthProvider
} from "@persona/shared";
import { env } from "../config/env.js";
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

function oauthProviderFromParams(request: Request): OAuthProvider {
  const parsed = oauthProviderSchema.safeParse(request.params.provider);
  if (!parsed.success) throw new HttpError("Unsupported OAuth provider.", 400);
  return parsed.data;
}

function authCallbackUrl(params: Record<string, string>): string {
  const url = new URL("/auth/callback", env.WEB_APP_URL);
  url.hash = new URLSearchParams(params).toString();
  return url.toString();
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

export async function getOAuthStart(request: Request, response: Response): Promise<void> {
  const provider = oauthProviderFromParams(request);
  const deviceId = typeof request.query.deviceId === "string" ? request.query.deviceId : undefined;
  const clientType = typeof request.query.clientType === "string" ? request.query.clientType : clientTypeFromHeader(request);
  const normalizedClientType = clientType === "web" || clientType === "desktop" || clientType === "ios" || clientType === "android"
    ? clientType
    : "unknown";
  const authorizationUrl = await authService.createOAuthAuthorizationUrl({
    provider,
    clientType: normalizedClientType,
    ...(deviceId ? { deviceId } : {})
  });
  response.redirect(302, authorizationUrl);
}

export async function getOAuthCallback(request: Request, response: Response): Promise<void> {
  try {
    const provider = oauthProviderFromParams(request);
    const code = typeof request.query.code === "string" ? request.query.code : undefined;
    const state = typeof request.query.state === "string" ? request.query.state : undefined;
    const providerError = typeof request.query.error === "string" ? request.query.error : undefined;
    if (providerError) throw new HttpError(providerError, 400);
    if (!code || !state) throw new HttpError("OAuth callback is missing code or state.", 400);

    const auth = await authService.completeOAuthCallback({
      provider,
      code,
      state,
      metadata: requestMetadata(request)
    });
    response.redirect(302, authCallbackUrl({
      accessToken: auth.tokens.accessToken,
      refreshToken: auth.tokens.refreshToken,
      expiresAt: auth.tokens.expiresAt,
      refreshExpiresAt: auth.tokens.refreshExpiresAt,
      tokenType: auth.tokens.tokenType
    }));
  } catch (error) {
    const message = error instanceof Error ? error.message : "OAuth login failed.";
    response.redirect(302, authCallbackUrl({ error: message }));
  }
}
