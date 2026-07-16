import type { Request, Response } from "express";
import {
  deleteAccountRequestSchema,
  loginRequestSchema,
  oauthExchangeRequestSchema,
  oauthProviderSchema,
  refreshAuthRequestSchema,
  registerRequestSchema,
  restoreAccountRequestSchema,
  type AuthClientType,
  type OAuthProvider
} from "@persona/shared";
import { env } from "../config/env.js";
import { authService } from "../services/authService.js";
import { requestBearerToken } from "../middleware/authMiddleware.js";
import { HttpError } from "../utils/httpError.js";
import { logger } from "../utils/logger.js";

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
  // Keep the handoff on the static site's root. Static hosts may redirect an
  // unknown /auth/callback route to / and lose the URL fragment containing the
  // short-lived browser handoff tokens in the process.
  const url = new URL("/", env.WEB_APP_URL);
  url.hash = new URLSearchParams(params).toString();
  return url.toString();
}

function mobileAuthCallbackUrl(clientType: AuthClientType, params: Record<string, string>, returnUrl?: string): string | undefined {
  const configuredUrl = returnUrl ?? (clientType === "ios"
    ? env.IOS_OAUTH_REDIRECT_URL
    : clientType === "android"
      ? env.ANDROID_OAUTH_REDIRECT_URL
      : undefined);
  if (!configuredUrl) return undefined;
  const url = new URL(configuredUrl);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  return url.toString();
}

function hasMobileAuthCallbackUrl(clientType: AuthClientType): boolean {
  return Boolean(clientType === "ios"
    ? env.IOS_OAUTH_REDIRECT_URL
    : clientType === "android"
      ? env.ANDROID_OAUTH_REDIRECT_URL
      : undefined);
}

function configuredMobileReturnUrl(clientType: AuthClientType): string | undefined {
  return clientType === "ios"
    ? env.IOS_OAUTH_REDIRECT_URL
    : clientType === "android"
      ? env.ANDROID_OAUTH_REDIRECT_URL
      : undefined;
}

function mobileReturnUrlFromQuery(request: Request, clientType: AuthClientType): string | undefined {
  const value = typeof request.query.returnUrl === "string" ? request.query.returnUrl.trim() : undefined;
  if (!value) return undefined;
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new HttpError("Unsupported mobile OAuth return URL.", 400);
  }

  if (env.NODE_ENV === "production") {
    const configuredUrl = configuredMobileReturnUrl(clientType);
    if (!configuredUrl || parsed.toString() !== new URL(configuredUrl).toString()) {
      throw new HttpError("Unsupported mobile OAuth return URL.", 400);
    }
    return parsed.toString();
  }

  if (parsed.protocol === "personawrapper:" || parsed.protocol === "exp:") return parsed.toString();
  if ((parsed.protocol === "http:" || parsed.protocol === "https:") && ["localhost", "127.0.0.1"].includes(parsed.hostname)) {
    return parsed.toString();
  }
  throw new HttpError("Unsupported mobile OAuth return URL.", 400);
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

export async function postRestoreAccount(request: Request, response: Response): Promise<void> {
  const payload = restoreAccountRequestSchema.parse({
    clientType: clientTypeFromHeader(request),
    ...request.body
  });
  const auth = await authService.restoreAccount(payload, requestMetadata(request));
  response.status(200).json(auth);
}

export async function deleteAccount(request: Request, response: Response): Promise<void> {
  if (!request.auth) throw new HttpError("Not authenticated.", 401);
  const payload = deleteAccountRequestSchema.parse(request.body);
  const deletion = await authService.scheduleAccountDeletion(request.auth.userId, payload);
  response.status(202).json(deletion);
}

export async function postRefresh(request: Request, response: Response): Promise<void> {
  const payload = refreshAuthRequestSchema.parse({
    clientType: clientTypeFromHeader(request),
    ...request.body
  });
  const auth = await authService.refresh(payload, requestMetadata(request));
  response.status(200).json(auth);
}

export async function postOAuthExchange(request: Request, response: Response): Promise<void> {
  const payload = oauthExchangeRequestSchema.parse({
    clientType: clientTypeFromHeader(request),
    ...request.body
  });
  const auth = await authService.exchangeOAuthCode(payload, requestMetadata(request));
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

export async function getActiveSessions(request: Request, response: Response): Promise<void> {
  if (!request.auth) throw new HttpError("Not authenticated.", 401);
  const sessions = await authService.listActiveSessions(request.auth.userId, request.auth.sessionId);
  response.status(200).json({ sessions });
}

export async function deleteActiveSession(request: Request, response: Response): Promise<void> {
  if (!request.auth) throw new HttpError("Not authenticated.", 401);
  const sessionId = request.params.sessionId;
  if (typeof sessionId !== "string" || !sessionId.trim() || sessionId.length > 200) {
    throw new HttpError("A valid session id is required.", 400);
  }
  if (sessionId === request.auth.sessionId) {
    throw new HttpError("Use log out to end the current session.", 409);
  }
  await authService.revokeSession(request.auth.userId, sessionId);
  response.status(204).send();
}

export async function deleteOtherSessions(request: Request, response: Response): Promise<void> {
  if (!request.auth) throw new HttpError("Not authenticated.", 401);
  const revoked = await authService.revokeOtherSessions(request.auth.userId, request.auth.sessionId);
  response.status(200).json({ revoked });
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
  const returnUrl = mobileReturnUrlFromQuery(request, normalizedClientType);
  const authorizationUrl = await authService.createOAuthAuthorizationUrl({
    provider,
    clientType: normalizedClientType,
    ...(deviceId ? { deviceId } : {}),
    ...(returnUrl ? { returnUrl } : {})
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
    if (auth.oauthReturnUrl || hasMobileAuthCallbackUrl(auth.session.clientType)) {
      const exchangeCode = await authService.createOAuthExchangeCode(auth);
      // Production deep links are server configuration, not client input. This
      // keeps a mobile OAuth session from ever being redirected to a web URL.
      const runtimeReturnUrl = env.NODE_ENV === "production" ? undefined : auth.oauthReturnUrl;
      const mobileCallbackUrl = mobileAuthCallbackUrl(auth.session.clientType, {
        code: exchangeCode,
        provider
      }, runtimeReturnUrl);
      if (!mobileCallbackUrl) throw new HttpError("Mobile OAuth callback URL is not configured.", 500);
      logger.info("OAuth callback completed", {
        provider,
        clientType: auth.session.clientType,
        destination: "mobile"
      });
      response.redirect(302, mobileCallbackUrl);
      return;
    }
    logger.info("OAuth callback completed", {
      provider,
      clientType: auth.session.clientType,
      destination: "web"
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
    logger.warn("OAuth callback failed", {
      message,
      provider: typeof request.params.provider === "string" ? request.params.provider : "unknown"
    });
    response.redirect(302, authCallbackUrl({ error: message }));
  }
}
