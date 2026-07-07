import { createHash, randomBytes, randomUUID, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { and, eq, isNull, or } from "drizzle-orm";
import {
  authClientTypeSchema,
  type AuthClientType,
  type AuthResponse,
  type AuthSession,
  type AuthUser,
  type LoginRequest,
  oauthProviderSchema,
  type OAuthProvider,
  type OAuthProviderStatus,
  type RefreshAuthRequest,
  type RegisterRequest
} from "@persona/shared";
import { env } from "../config/env.js";
import { getDatabase } from "../db/client.js";
import { authSessions, oauthStates, userOAuthAccounts, userPasswordCredentials, users } from "../db/schema.js";
import { HttpError } from "../utils/httpError.js";

const scrypt = promisify(scryptCallback);
const PASSWORD_HASH_BYTES = 64;
const TOKEN_BYTES = 32;

type AuthMetadata = {
  userAgent?: string;
  ipAddress?: string;
};

type SessionWithTokens = {
  session: AuthSession;
  accessToken: string;
  refreshToken: string;
};

type OAuthStartOptions = {
  provider: OAuthProvider;
  clientType: AuthClientType;
  deviceId?: string;
};

type OAuthCallbackOptions = {
  provider: OAuthProvider;
  code: string;
  state: string;
  metadata?: AuthMetadata;
};

type OAuthTokenResponse = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  token_type?: string;
  scope?: string;
  error?: string;
  error_description?: string;
};

type OAuthProfile = {
  providerAccountId: string;
  email?: string;
  displayName?: string;
  avatarUrl?: string;
  emailVerified?: boolean;
  metadata: Record<string, unknown>;
};

function requireDatabase() {
  const db = getDatabase();
  if (!db) throw new HttpError("Authentication requires DATABASE_URL.", 503);
  return db;
}

function normalizeEmail(value?: string | null): string | undefined {
  return value?.trim().toLowerCase() || undefined;
}

function normalizeUsername(value?: string | null): string | undefined {
  return value?.trim().toLowerCase() || undefined;
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function oauthStateExpiry(): Date {
  return new Date(Date.now() + 10 * 60 * 1000);
}

function generateToken(prefix: "access" | "refresh"): string {
  return `${prefix}_${randomBytes(TOKEN_BYTES).toString("base64url")}`;
}

function tokenExpiry(minutes: number): Date {
  return new Date(Date.now() + minutes * 60 * 1000);
}

function refreshTokenExpiry(days: number): Date {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000);
}

async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString("base64url");
  const derived = await scrypt(password, salt, PASSWORD_HASH_BYTES) as Buffer;
  return `scrypt$v=1$${salt}$${derived.toString("base64url")}`;
}

async function verifyPassword(password: string, storedHash: string): Promise<boolean> {
  const parts = storedHash.split("$");
  const salt = parts[2];
  const expectedHash = parts[3];
  if (parts[0] !== "scrypt" || !salt || !expectedHash) return false;

  const actual = await scrypt(password, salt, PASSWORD_HASH_BYTES) as Buffer;
  const expected = Buffer.from(expectedHash, "base64url");
  if (actual.byteLength !== expected.byteLength) return false;
  return timingSafeEqual(actual, expected);
}

function parseClientType(value: unknown): AuthClientType {
  const parsed = authClientTypeSchema.safeParse(value);
  return parsed.success ? parsed.data : "unknown";
}

function parseOAuthProvider(value: unknown): OAuthProvider {
  const parsed = oauthProviderSchema.safeParse(value);
  if (!parsed.success) throw new HttpError("Unsupported OAuth provider.", 400);
  return parsed.data;
}

function oauthRedirectUri(provider: OAuthProvider): string {
  const baseUrl = env.OAUTH_REDIRECT_BASE_URL ?? `http://localhost:${env.PORT}`;
  return new URL(`/api/auth/oauth/${provider}/callback`, baseUrl).toString();
}

function oauthProviderConfig(provider: OAuthProvider) {
  if (provider === "google") {
    return {
      provider,
      clientId: env.GOOGLE_OAUTH_CLIENT_ID,
      clientSecret: env.GOOGLE_OAUTH_CLIENT_SECRET,
      authorizationUrl: "https://accounts.google.com/o/oauth2/v2/auth",
      tokenUrl: "https://oauth2.googleapis.com/token",
      profileUrl: "https://www.googleapis.com/oauth2/v3/userinfo",
      scopes: ["openid", "email", "profile"]
    };
  }

  return {
    provider,
    clientId: env.FACEBOOK_OAUTH_CLIENT_ID,
    clientSecret: env.FACEBOOK_OAUTH_CLIENT_SECRET,
    authorizationUrl: "https://www.facebook.com/v21.0/dialog/oauth",
    tokenUrl: "https://graph.facebook.com/v21.0/oauth/access_token",
    profileUrl: "https://graph.facebook.com/me?fields=id,name,email,picture",
    scopes: ["email", "public_profile"]
  };
}

function assertOAuthProviderEnabled(provider: OAuthProvider) {
  const config = oauthProviderConfig(provider);
  if (!config.clientId || !config.clientSecret) {
    throw new HttpError(`${provider} OAuth is not configured.`, 503);
  }
  return {
    ...config,
    clientId: config.clientId,
    clientSecret: config.clientSecret
  };
}

function buildCodeChallenge(codeVerifier: string): string {
  return createHash("sha256").update(codeVerifier).digest("base64url");
}

function profileFromProvider(provider: OAuthProvider, payload: Record<string, unknown>): OAuthProfile {
  if (provider === "google") {
    const providerAccountId = typeof payload.sub === "string" ? payload.sub : undefined;
    if (!providerAccountId) throw new HttpError("Google profile did not include an account id.", 502);
    const profile: OAuthProfile = {
      providerAccountId,
      emailVerified: payload.email_verified === true,
      metadata: payload
    };
    if (typeof payload.email === "string") {
      const email = normalizeEmail(payload.email);
      if (email) profile.email = email;
    }
    if (typeof payload.name === "string") profile.displayName = payload.name;
    if (typeof payload.picture === "string") profile.avatarUrl = payload.picture;
    return profile;
  }

  const providerAccountId = typeof payload.id === "string" ? payload.id : undefined;
  if (!providerAccountId) throw new HttpError("Facebook profile did not include an account id.", 502);
  const picture = payload.picture;
  let avatarUrl: string | undefined;
  if (typeof picture === "object" && picture !== null && "data" in picture) {
    const data = picture.data;
    if (typeof data === "object" && data !== null && "url" in data && typeof data.url === "string") {
      avatarUrl = data.url;
    }
  }
  const profile: OAuthProfile = {
    providerAccountId,
    metadata: payload
  };
  if (typeof payload.email === "string") {
    const email = normalizeEmail(payload.email);
    if (email) profile.email = email;
  }
  if (typeof payload.name === "string") profile.displayName = payload.name;
  if (avatarUrl) profile.avatarUrl = avatarUrl;
  return profile;
}

async function requestOAuthToken(
  provider: OAuthProvider,
  code: string,
  codeVerifier: string | undefined,
  redirectUri: string
): Promise<OAuthTokenResponse> {
  const config = assertOAuthProviderEnabled(provider);
  const body = new URLSearchParams({
    client_id: config.clientId,
    client_secret: config.clientSecret,
    code,
    grant_type: "authorization_code",
    redirect_uri: redirectUri
  });
  if (codeVerifier) body.set("code_verifier", codeVerifier);

  const response = await fetch(config.tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body
  });
  const payload = await response.json() as OAuthTokenResponse;
  if (!response.ok || payload.error) {
    throw new HttpError(payload.error_description ?? payload.error ?? `${provider} token exchange failed.`, 502);
  }
  if (!payload.access_token) throw new HttpError(`${provider} did not return an access token.`, 502);
  return payload;
}

async function requestOAuthProfile(provider: OAuthProvider, accessToken: string): Promise<OAuthProfile> {
  const config = assertOAuthProviderEnabled(provider);
  const response = await fetch(config.profileUrl, {
    headers: { Authorization: `Bearer ${accessToken}` }
  });
  const payload = await response.json() as Record<string, unknown>;
  if (!response.ok) throw new HttpError(`${provider} profile request failed.`, 502);
  return profileFromProvider(provider, payload);
}

function oauthStateMetadata(value: Record<string, unknown> | null | undefined): { clientType: AuthClientType; deviceId?: string } {
  const metadata = value ?? {};
  const result: { clientType: AuthClientType; deviceId?: string } = {
    clientType: parseClientType(metadata.clientType)
  };
  if (typeof metadata.deviceId === "string" && metadata.deviceId.trim()) result.deviceId = metadata.deviceId.trim();
  return result;
}

async function findOrCreateOAuthUser(profile: OAuthProfile, provider: OAuthProvider): Promise<typeof users.$inferSelect> {
  const db = requireDatabase();
  const existingAccount = await db.query.userOAuthAccounts.findFirst({
    where: and(
      eq(userOAuthAccounts.provider, provider),
      eq(userOAuthAccounts.providerAccountId, profile.providerAccountId)
    )
  });
  if (existingAccount) {
    const existingUser = await db.query.users.findFirst({ where: eq(users.id, existingAccount.userId) });
    if (existingUser && existingUser.status === "active") return existingUser;
  }

  const email = normalizeEmail(profile.email);
  const userByEmail = email ? await db.query.users.findFirst({ where: eq(users.email, email) }) : undefined;
  if (userByEmail && userByEmail.status === "active") return userByEmail;

  const createUserValues: typeof users.$inferInsert = {
    id: `user_${randomUUID()}`,
    displayName: profile.displayName ?? email ?? `${provider} user`,
    metadata: { authProvider: provider }
  };
  if (email) createUserValues.email = email;
  if (profile.avatarUrl) createUserValues.avatarUrl = profile.avatarUrl;
  if (profile.emailVerified) createUserValues.emailVerifiedAt = new Date();

  const [createdUser] = await db.insert(users).values(createUserValues).returning();
  if (!createdUser) throw new HttpError("Could not create OAuth user.", 500);
  return createdUser;
}

function toUserPayload(row: typeof users.$inferSelect): AuthUser {
  return {
    id: row.id,
    email: row.email,
    username: row.username,
    displayName: row.displayName,
    avatarUrl: row.avatarUrl,
    status: row.status,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString()
  };
}

function toSessionPayload(row: typeof authSessions.$inferSelect): AuthSession {
  return {
    id: row.id,
    userId: row.userId,
    clientType: parseClientType(row.clientType),
    expiresAt: row.expiresAt.toISOString(),
    refreshExpiresAt: row.refreshExpiresAt.toISOString()
  };
}

function buildAuthResponse(user: typeof users.$inferSelect, sessionWithTokens: SessionWithTokens): AuthResponse {
  return {
    user: toUserPayload(user),
    session: sessionWithTokens.session,
    tokens: {
      accessToken: sessionWithTokens.accessToken,
      refreshToken: sessionWithTokens.refreshToken,
      tokenType: "Bearer",
      expiresAt: sessionWithTokens.session.expiresAt,
      refreshExpiresAt: sessionWithTokens.session.refreshExpiresAt
    }
  };
}

async function createSession(
  userId: string,
  clientType: AuthClientType,
  deviceId: string | undefined,
  metadata: AuthMetadata
): Promise<SessionWithTokens> {
  const db = requireDatabase();
  const accessToken = generateToken("access");
  const refreshToken = generateToken("refresh");
  const expiresAt = tokenExpiry(env.AUTH_ACCESS_TOKEN_TTL_MINUTES);
  const refreshExpiresAt = refreshTokenExpiry(env.AUTH_REFRESH_TOKEN_TTL_DAYS);
  const [session] = await db.insert(authSessions).values({
    id: `session_${randomUUID()}`,
    userId,
    accessTokenHash: hashToken(accessToken),
    refreshTokenHash: hashToken(refreshToken),
    clientType,
    deviceId,
    userAgent: metadata.userAgent,
    ipAddress: metadata.ipAddress,
    expiresAt,
    refreshExpiresAt
  }).returning();
  if (!session) throw new HttpError("Could not create auth session.", 500);
  return {
    session: toSessionPayload(session),
    accessToken,
    refreshToken
  };
}

function duplicateAccountError(error: unknown): never {
  if (typeof error === "object" && error !== null && "code" in error && error.code === "23505") {
    throw new HttpError("An account with that email or username already exists.", 409);
  }
  throw error;
}

function accountLookupWhere(email?: string, username?: string) {
  if (email && username) return or(eq(users.email, email), eq(users.username, username));
  if (email) return eq(users.email, email);
  if (username) return eq(users.username, username);
  throw new HttpError("Email or username is required.", 400);
}

export class AuthService {
  async register(payload: RegisterRequest, metadata: AuthMetadata = {}): Promise<AuthResponse> {
    const db = requireDatabase();
    if (payload.password.length < env.AUTH_PASSWORD_MIN_LENGTH) {
      throw new HttpError(`Password must be at least ${env.AUTH_PASSWORD_MIN_LENGTH} characters.`, 400);
    }

    const email = normalizeEmail(payload.email);
    const username = normalizeUsername(payload.username);
    if (!email && !username) throw new HttpError("Email or username is required.", 400);

    const existing = await db.query.users.findFirst({ where: accountLookupWhere(email, username) });
    if (existing) throw new HttpError("An account with that email or username already exists.", 409);

    try {
      const [user] = await db.insert(users).values({
        id: `user_${randomUUID()}`,
        email,
        username,
        displayName: payload.displayName?.trim() || username || email
      }).returning();
      if (!user) throw new HttpError("Could not create user.", 500);

      await db.insert(userPasswordCredentials).values({
        userId: user.id,
        passwordHash: await hashPassword(payload.password)
      });

      const session = await createSession(user.id, payload.clientType, payload.deviceId, metadata);
      return buildAuthResponse(user, session);
    } catch (error) {
      duplicateAccountError(error);
    }
  }

  async login(payload: LoginRequest, metadata: AuthMetadata = {}): Promise<AuthResponse> {
    const db = requireDatabase();
    const identifier = payload.identifier.trim().toLowerCase();
    const user = await db.query.users.findFirst({
      where: or(eq(users.email, identifier), eq(users.username, identifier))
    });
    if (!user || user.status !== "active") throw new HttpError("Invalid username/email or password.", 401);

    const credential = await db.query.userPasswordCredentials.findFirst({
      where: eq(userPasswordCredentials.userId, user.id)
    });
    if (!credential || !(await verifyPassword(payload.password, credential.passwordHash))) {
      throw new HttpError("Invalid username/email or password.", 401);
    }

    const session = await createSession(user.id, payload.clientType, payload.deviceId, metadata);
    return buildAuthResponse(user, session);
  }

  async createOAuthAuthorizationUrl(options: OAuthStartOptions): Promise<string> {
    const provider = parseOAuthProvider(options.provider);
    const config = assertOAuthProviderEnabled(provider);
    const state = randomBytes(32).toString("base64url");
    const codeVerifier = randomBytes(64).toString("base64url");
    const redirectUri = oauthRedirectUri(provider);
    const db = requireDatabase();

    const stateMetadata: Record<string, unknown> = {
      clientType: options.clientType
    };
    if (options.deviceId) stateMetadata.deviceId = options.deviceId;

    await db.insert(oauthStates).values({
      id: `oauth_state_${randomUUID()}`,
      stateHash: hashToken(state),
      provider,
      redirectUri,
      codeVerifier,
      expiresAt: oauthStateExpiry(),
      metadata: stateMetadata
    });

    const url = new URL(config.authorizationUrl);
    url.searchParams.set("client_id", config.clientId);
    url.searchParams.set("redirect_uri", redirectUri);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("scope", config.scopes.join(" "));
    url.searchParams.set("state", state);
    url.searchParams.set("code_challenge", buildCodeChallenge(codeVerifier));
    url.searchParams.set("code_challenge_method", "S256");
    if (provider === "google") {
      url.searchParams.set("access_type", "offline");
      url.searchParams.set("prompt", "select_account");
    }
    return url.toString();
  }

  async completeOAuthCallback(options: OAuthCallbackOptions): Promise<AuthResponse> {
    const provider = parseOAuthProvider(options.provider);
    const db = requireDatabase();
    const stateHash = hashToken(options.state);
    const stateRow = await db.query.oauthStates.findFirst({
      where: and(eq(oauthStates.stateHash, stateHash), eq(oauthStates.provider, provider))
    });
    if (!stateRow) throw new HttpError("OAuth state is invalid or expired.", 400);

    await db.delete(oauthStates).where(eq(oauthStates.id, stateRow.id));
    if (stateRow.expiresAt.getTime() <= Date.now()) throw new HttpError("OAuth state is invalid or expired.", 400);

    const redirectUri = stateRow.redirectUri ?? oauthRedirectUri(provider);
    const tokenPayload = await requestOAuthToken(provider, options.code, stateRow.codeVerifier ?? undefined, redirectUri);
    const profile = await requestOAuthProfile(provider, tokenPayload.access_token as string);
    const user = await findOrCreateOAuthUser(profile, provider);
    const scopes = tokenPayload.scope?.split(/\s+/).filter(Boolean) ?? [];
    const existingAccount = await db.query.userOAuthAccounts.findFirst({
      where: and(
        eq(userOAuthAccounts.provider, provider),
        eq(userOAuthAccounts.providerAccountId, profile.providerAccountId)
      )
    });
    const accountValues: Partial<typeof userOAuthAccounts.$inferInsert> = {
      scopes,
      metadata: {
        ...profile.metadata,
        tokenType: tokenPayload.token_type,
        expiresIn: tokenPayload.expires_in
      },
      updatedAt: new Date()
    };
    if (profile.email) accountValues.email = profile.email;
    if (profile.displayName) accountValues.displayName = profile.displayName;
    if (profile.avatarUrl) accountValues.avatarUrl = profile.avatarUrl;
    if (tokenPayload.access_token) accountValues.accessTokenHash = hashToken(tokenPayload.access_token);
    if (tokenPayload.refresh_token) {
      accountValues.refreshTokenHash = hashToken(tokenPayload.refresh_token);
    } else if (existingAccount?.refreshTokenHash) {
      accountValues.refreshTokenHash = existingAccount.refreshTokenHash;
    }

    if (existingAccount) {
      await db.update(userOAuthAccounts)
        .set(accountValues)
        .where(eq(userOAuthAccounts.id, existingAccount.id));
    } else {
      await db.insert(userOAuthAccounts).values({
        id: `oauth_${randomUUID()}`,
        userId: user.id,
        provider,
        providerAccountId: profile.providerAccountId,
        ...accountValues
      } as typeof userOAuthAccounts.$inferInsert);
    }

    const stateMetadata = oauthStateMetadata(stateRow.metadata);
    const session = await createSession(
      user.id,
      stateMetadata.clientType,
      stateMetadata.deviceId,
      options.metadata ?? {}
    );
    return buildAuthResponse(user, session);
  }

  async refresh(payload: RefreshAuthRequest, metadata: AuthMetadata = {}): Promise<AuthResponse> {
    const db = requireDatabase();
    const refreshTokenHash = hashToken(payload.refreshToken);
    const session = await db.query.authSessions.findFirst({
      where: and(
        eq(authSessions.refreshTokenHash, refreshTokenHash),
        isNull(authSessions.revokedAt)
      )
    });
    if (!session || session.refreshExpiresAt.getTime() <= Date.now()) {
      throw new HttpError("Refresh token is invalid or expired.", 401);
    }

    const user = await db.query.users.findFirst({ where: eq(users.id, session.userId) });
    if (!user || user.status !== "active") throw new HttpError("Refresh token is invalid or expired.", 401);

    const accessToken = generateToken("access");
    const refreshToken = generateToken("refresh");
    const expiresAt = tokenExpiry(env.AUTH_ACCESS_TOKEN_TTL_MINUTES);
    const refreshExpiresAt = refreshTokenExpiry(env.AUTH_REFRESH_TOKEN_TTL_DAYS);
    const [updatedSession] = await db.update(authSessions).set({
      accessTokenHash: hashToken(accessToken),
      refreshTokenHash: hashToken(refreshToken),
      clientType: payload.clientType,
      deviceId: payload.deviceId ?? session.deviceId,
      userAgent: metadata.userAgent ?? session.userAgent,
      ipAddress: metadata.ipAddress ?? session.ipAddress,
      expiresAt,
      refreshExpiresAt,
      updatedAt: new Date()
    }).where(eq(authSessions.id, session.id)).returning();
    if (!updatedSession) throw new HttpError("Refresh token is invalid or expired.", 401);

    return buildAuthResponse(user, {
      session: toSessionPayload(updatedSession),
      accessToken,
      refreshToken
    });
  }

  async logout(options: { accessToken?: string; refreshToken?: string }): Promise<void> {
    const db = requireDatabase();
    const now = new Date();
    const clauses = [
      options.accessToken ? eq(authSessions.accessTokenHash, hashToken(options.accessToken)) : undefined,
      options.refreshToken ? eq(authSessions.refreshTokenHash, hashToken(options.refreshToken)) : undefined
    ].filter((clause): clause is NonNullable<typeof clause> => Boolean(clause));
    if (clauses.length === 0) return;
    const where = clauses.length === 1 ? clauses[0] : or(clauses[0], clauses[1]);
    await db.update(authSessions)
      .set({ revokedAt: now, updatedAt: now })
      .where(where);
  }

  async authenticate(accessToken: string): Promise<{ user: AuthUser; session: AuthSession } | undefined> {
    const db = getDatabase();
    if (!db) return undefined;
    const session = await db.query.authSessions.findFirst({
      where: and(
        eq(authSessions.accessTokenHash, hashToken(accessToken)),
        isNull(authSessions.revokedAt)
      )
    });
    if (!session || session.expiresAt.getTime() <= Date.now()) return undefined;
    const user = await db.query.users.findFirst({ where: eq(users.id, session.userId) });
    if (!user || user.status !== "active") return undefined;
    return {
      user: toUserPayload(user),
      session: toSessionPayload(session)
    };
  }

  async getSession(sessionId: string): Promise<{ user: AuthUser; session: AuthSession }> {
    const db = requireDatabase();
    const session = await db.query.authSessions.findFirst({
      where: and(eq(authSessions.id, sessionId), isNull(authSessions.revokedAt))
    });
    if (!session || session.expiresAt.getTime() <= Date.now()) throw new HttpError("Not authenticated.", 401);
    const user = await db.query.users.findFirst({ where: eq(users.id, session.userId) });
    if (!user || user.status !== "active") throw new HttpError("Not authenticated.", 401);
    return {
      user: toUserPayload(user),
      session: toSessionPayload(session)
    };
  }

  oauthProviderStatus(): OAuthProviderStatus[] {
    return [
      { provider: "google", enabled: Boolean(env.GOOGLE_OAUTH_CLIENT_ID && env.GOOGLE_OAUTH_CLIENT_SECRET) },
      { provider: "facebook", enabled: Boolean(env.FACEBOOK_OAUTH_CLIENT_ID && env.FACEBOOK_OAUTH_CLIENT_SECRET) }
    ];
  }
}

export const authService = new AuthService();
