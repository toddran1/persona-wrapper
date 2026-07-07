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
  type OAuthProviderStatus,
  type RefreshAuthRequest,
  type RegisterRequest
} from "@persona/shared";
import { env } from "../config/env.js";
import { getDatabase } from "../db/client.js";
import { authSessions, userPasswordCredentials, users } from "../db/schema.js";
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
