import { randomUUID } from "node:crypto";
import { APPLE_NATIVE_AUTHORIZATION_CODE_PREFIX } from "@persona/shared";
import { APIError, betterAuth } from "better-auth";
import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { expo } from "@better-auth/expo";
import { username } from "better-auth/plugins";
import { eq } from "drizzle-orm";
import { decodeJwt } from "jose";
import { env } from "./config/env.js";
import { getDatabase } from "./db/client.js";
import * as schema from "./db/schema.js";
import { hashPassword, verifyPassword } from "./services/passwordService.js";
import { authEmailEnabled, sendAccountRestoredEmail, sendPasswordChangedEmail, sendPasswordResetEmail, sendVerificationEmail } from "./services/authEmailService.js";
import {
  APPLE_NATIVE_SCOPE_MARKER,
  appleClientIdForScope,
  exchangeAppleAuthorizationCode,
  generateAppleClientSecret,
  revokeAppleToken
} from "./services/appleOAuthService.js";
import { appleSigningKey } from "./services/appleOAuthRuntime.js";
import { authCookieAttributes } from "./utils/authCookieConfig.js";
import { logger } from "./utils/logger.js";

const database = getDatabase();
const apiOrigin = env.BETTER_AUTH_URL ?? `http://localhost:${env.PORT}`;
const configuredAppleSigningKey = appleSigningKey;
type AppleAccountMutation = {
  providerId?: string | undefined;
  accountId?: string | undefined;
  accessToken?: string | null | undefined;
  refreshToken?: string | null | undefined;
  idToken?: string | null | undefined;
  scope?: string | null | undefined;
  accessTokenExpiresAt?: Date | null | undefined;
};

function appleSubjectFromAuthBody(body: unknown): string | undefined {
  if (typeof body !== "object" || body === null || !("idToken" in body)) return undefined;
  const idToken = body.idToken;
  if (typeof idToken !== "object" || idToken === null || !("token" in idToken) || typeof idToken.token !== "string") return undefined;
  try {
    return decodeJwt(idToken.token).sub;
  } catch {
    return undefined;
  }
}

async function exchangeNativeAppleAccountCode<T extends AppleAccountMutation>(account: T, authBody?: unknown): Promise<{ data: T } | undefined> {
  const wrappedCode = account.accessToken;
  if (!wrappedCode?.startsWith(APPLE_NATIVE_AUTHORIZATION_CODE_PREFIX)) return undefined;
  if (!appleSigningKey || !env.APPLE_OAUTH_TEAM_ID || !env.APPLE_OAUTH_KEY_ID) {
    throw new Error("Native Apple authentication is not configured on the API.");
  }
  const tokens = await exchangeAppleAuthorizationCode({
    authorizationCode: wrappedCode.slice(APPLE_NATIVE_AUTHORIZATION_CODE_PREFIX.length),
    clientId: env.APPLE_APP_BUNDLE_IDENTIFIER,
    teamId: env.APPLE_OAUTH_TEAM_ID,
    keyId: env.APPLE_OAUTH_KEY_ID,
    signingKey: appleSigningKey
  });
  const expectedSubject = account.accountId ?? appleSubjectFromAuthBody(authBody);
  if (!expectedSubject || tokens.subject !== expectedSubject) {
    throw new Error("Apple returned credentials for a different account.");
  }
  const scopes = new Set((account.scope ?? "").split(/[ ,]+/).filter(Boolean));
  scopes.add(APPLE_NATIVE_SCOPE_MARKER);
  return {
    data: {
      ...account,
      accessToken: tokens.access_token,
      idToken: tokens.id_token,
      ...(tokens.refresh_token ? { refreshToken: tokens.refresh_token } : {}),
      ...(tokens.expires_in ? { accessTokenExpiresAt: new Date(Date.now() + tokens.expires_in * 1000) } : {}),
      scope: [...scopes].join(",")
    }
  };
}

async function revokeAppleAccount(account: AppleAccountMutation): Promise<void> {
  const token = account.refreshToken ?? account.accessToken;
  if (account.providerId !== "apple" || !token) return;
  if (!appleSigningKey || !env.APPLE_OAUTH_CLIENT_ID || !env.APPLE_OAUTH_TEAM_ID || !env.APPLE_OAUTH_KEY_ID) {
    throw new Error("Apple token revocation is not configured on the API.");
  }
  await revokeAppleToken({
    token,
    tokenTypeHint: account.refreshToken ? "refresh_token" : "access_token",
    clientId: appleClientIdForScope(account.scope, env.APPLE_OAUTH_CLIENT_ID, env.APPLE_APP_BUNDLE_IDENTIFIER),
    teamId: env.APPLE_OAUTH_TEAM_ID,
    keyId: env.APPLE_OAUTH_KEY_ID,
    signingKey: appleSigningKey
  });
}

if (database && !authEmailEnabled) {
  logger.warn(
    "Auth email delivery is not configured (GMAIL_SMTP_USER/GMAIL_SMTP_APP_PASSWORD) — "
    + "password-reset and email-verification messages will not be sent."
  );
}

const socialProviders = {
  ...(env.GOOGLE_OAUTH_CLIENT_ID && env.GOOGLE_OAUTH_CLIENT_SECRET ? {
    google: {
      clientId: env.GOOGLE_OAUTH_CLIENT_ID,
      clientSecret: env.GOOGLE_OAUTH_CLIENT_SECRET,
      ...(env.GOOGLE_DRIVE_LINK_IMPORT_ENABLED ? {
        scope: ["openid", "email", "profile", "https://www.googleapis.com/auth/drive.readonly"],
        accessType: "offline" as const,
        prompt: "select_account consent" as const
      } : {})
    }
  } : {}),
  ...(env.FACEBOOK_OAUTH_CLIENT_ID && env.FACEBOOK_OAUTH_CLIENT_SECRET ? {
    facebook: {
      clientId: env.FACEBOOK_OAUTH_CLIENT_ID,
      clientSecret: env.FACEBOOK_OAUTH_CLIENT_SECRET
    }
  } : {}),
  ...(env.APPLE_OAUTH_CLIENT_ID && env.APPLE_OAUTH_TEAM_ID && env.APPLE_OAUTH_KEY_ID && configuredAppleSigningKey ? {
    apple: async () => ({
      // The first value drives the web authorization-code flow; both values
      // are accepted as ID-token audiences for web and native iOS sign-in.
      clientId: [env.APPLE_OAUTH_CLIENT_ID!, env.APPLE_APP_BUNDLE_IDENTIFIER],
      clientSecret: await generateAppleClientSecret({
        clientId: env.APPLE_OAUTH_CLIENT_ID!,
        teamId: env.APPLE_OAUTH_TEAM_ID!,
        keyId: env.APPLE_OAUTH_KEY_ID!,
        signingKey: configuredAppleSigningKey
      }),
      mapProfileToUser: (profile: { sub: string; email?: string }) => ({
        email: profile.email ?? `apple-${profile.sub}@users.invalid`
      })
    })
  } : {})
};

export const auth = database ? betterAuth({
  appName: "For the Baddiez",
  baseURL: apiOrigin,
  basePath: "/api/auth",
  secret: env.BETTER_AUTH_SECRET ?? "for-the-baddiez-local-better-auth-secret-change-me",
  database: drizzleAdapter(database, {
    provider: "pg",
    schema
  }),
  databaseHooks: {
    user: {
      create: {
        before: async (user, context) => {
          const requestedUsername = typeof user.username === "string" ? user.username.trim() : "";
          const username = requestedUsername ? requestedUsername.toLowerCase() : undefined;
          const data = {
            ...user,
            ...(username ? { username, displayUsername: requestedUsername } : {}),
            name: user.name?.trim() || requestedUsername || "Baddie"
          };
          if (context?.path !== "/sign-up/email") return { data };
          // Registration requires a real, verifiable mailbox. Synthetic
          // @users.invalid addresses were the old username-only sign-up path.
          if (typeof user.email === "string" && user.email.toLowerCase().endsWith("@users.invalid")) {
            throw new APIError("BAD_REQUEST", {
              message: "An email address is required to create an account."
            });
          }
          if (username) {
            const existingUser = await database.query.users.findFirst({
              columns: { id: true },
              where: eq(schema.users.username, username)
            });
            if (existingUser) {
              throw new APIError("BAD_REQUEST", { message: "That username is already taken." });
            }
          }
          if (
            user.termsVersionAccepted !== env.TERMS_POLICY_VERSION
            || user.privacyVersionAccepted !== env.PRIVACY_POLICY_VERSION
          ) {
            throw new APIError("BAD_REQUEST", {
              message: "You must accept the current Terms of Use and Privacy Policy to create an account."
            });
          }
          const acceptedAt = new Date();
          return {
            data: {
              ...data,
              termsVersionAccepted: env.TERMS_POLICY_VERSION,
              termsAcceptedAt: acceptedAt,
              privacyVersionAccepted: env.PRIVACY_POLICY_VERSION,
              privacyAcceptedAt: acceptedAt
            }
          };
        }
      }
    },
    session: {
      create: {
        before: async (session, context) => {
          const user = await database.query.users.findFirst({ where: eq(schema.users.id, session.userId) });
          if (!user) return false;
          const isOAuthAuthentication = context?.path.includes("/callback/") || context?.path === "/sign-in/social";
          if (user.status === "pending_deletion" && isOAuthAuthentication) {
            if (user.deletionScheduledFor && user.deletionScheduledFor.getTime() <= Date.now()) return false;
            await database.update(schema.users).set({
              status: "active",
              deletionRequestedAt: null,
              deletionScheduledFor: null,
              updatedAt: new Date()
            }).where(eq(schema.users.id, user.id));
            void sendAccountRestoredEmail({
              email: user.email,
              displayName: user.displayName ?? user.username ?? ""
            });
          } else if (user.status !== "active") {
            return false;
          }
          const requestedClientType = context?.request?.headers.get("x-client-type");
          const clientType = requestedClientType === "web"
            || requestedClientType === "desktop"
            || requestedClientType === "ios"
            || requestedClientType === "android"
            ? requestedClientType
            : "unknown";
          return { data: { ...session, clientType } };
        }
      }
    },
    account: {
      create: {
        before: (account, context) => exchangeNativeAppleAccountCode(account, context?.body)
      },
      update: {
        before: (account, context) => exchangeNativeAppleAccountCode(account, context?.body),
        after: async (account) => {
          // Credential accounts only change when the password does (change or
          // reset) — notify the account email so a hijack is visible.
          if (account.providerId !== "credential" || !account.password) return;
          const user = await database.query.users.findFirst({ where: eq(schema.users.id, account.userId) });
          if (!user) return;
          void sendPasswordChangedEmail({
            email: user.email,
            displayName: user.displayName ?? user.username ?? ""
          });
        }
      },
      delete: {
        before: revokeAppleAccount
      }
    }
  },
  user: {
    modelName: "users",
    fields: {
      name: "displayName",
      image: "avatarUrl"
    },
    additionalFields: {
      role: { type: "string", required: true, defaultValue: "user", input: false },
      status: { type: "string", required: true, defaultValue: "active", input: false },
      deletionRequestedAt: { type: "date", required: false, input: false },
      deletionScheduledFor: { type: "date", required: false, input: false },
      preferredName: { type: "string", required: false, input: false },
      gender: { type: "string", required: false, input: false },
      birthMonth: { type: "number", required: false, input: false },
      birthDay: { type: "number", required: false, input: false },
      conciseAudioResponses: { type: "boolean", required: true, defaultValue: true, input: false },
      modelProvider: { type: "string", required: true, defaultValue: "openai", input: false },
      imageProvider: { type: "string", required: true, defaultValue: "openai", input: false },
      personaInfluenceLevel: { type: "string", required: true, defaultValue: "uncensored", input: false },
      termsVersionAccepted: { type: "string", required: false, input: true },
      termsAcceptedAt: { type: "date", required: false, input: false },
      privacyVersionAccepted: { type: "string", required: false, input: true },
      privacyAcceptedAt: { type: "date", required: false, input: false }
    }
  },
  session: {
    modelName: "betterAuthSessions",
    expiresIn: env.AUTH_REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60,
    updateAge: 24 * 60 * 60,
    additionalFields: {
      clientType: { type: "string", required: true, defaultValue: "unknown", input: false }
    }
  },
  account: {
    modelName: "betterAuthAccounts",
    accountLinking: {
      enabled: true,
      // Explicit linking already requires an authenticated session and a
      // freshly verified provider credential. Apple private-relay addresses
      // commonly differ from the email on the existing account.
      allowDifferentEmails: true,
      trustedProviders: ["google", "facebook", "apple"]
    }
  },
  verification: {
    modelName: "betterAuthVerifications"
  },
  emailVerification: {
    // Soft verification: the email is sent but sign-in is never blocked, so
    // username-only accounts (synthetic @users.invalid addresses) keep working.
    sendOnSignUp: true,
    // Clicking the verify link signs the user in on whichever browser opens
    // it, so verification from a mail client on another device still lands
    // on an authenticated session.
    autoSignInAfterVerification: true,
    expiresIn: 60 * 60,
    ...(authEmailEnabled ? {
      sendVerificationEmail: async (
        { user, url }: { user: { email: string; name: string }; url: string },
        request?: Request
      ) => {
        if (user.email.endsWith("@users.invalid")) return;
        const clientType = request?.headers.get("x-client-type");
        const mobileClient = clientType === "ios" || clientType === "android";
        // Mobile verification still finishes on HTTPS so email clients can
        // open it reliably. The landing page then returns to the installed app
        // (or presents an explicit Open app button when automatic deep-linking
        // is blocked). Web sign-ups continue to land on the normal app home.
        const callbackUrl = mobileClient
          ? new URL("/auth/mobile-callback?emailVerified=1", env.WEB_APP_URL).toString()
          : new URL("/?emailVerified=1", env.WEB_APP_URL).toString();
        const verificationUrl = new URL(url);
        verificationUrl.searchParams.set("callbackURL", callbackUrl);
        // Verification is soft — a delivery failure must never fail sign-up.
        // deliverAuthEmail already logged the sanitized SMTP error.
        await sendVerificationEmail({
          email: user.email,
          displayName: user.name,
          verificationUrl: verificationUrl.toString()
        }).catch(() => undefined);
      }
    } : {})
  },
  emailAndPassword: {
    enabled: true,
    minPasswordLength: env.AUTH_PASSWORD_MIN_LENGTH,
    maxPasswordLength: 128,
    resetPasswordTokenExpiresIn: 60 * 60,
    revokeSessionsOnPasswordReset: true,
    ...(authEmailEnabled ? {
      sendResetPassword: async ({ user, url }: { user: { email: string; name: string }; url: string }) => {
        // Better Auth should not report completion until Gmail accepted the
        // message. The mail service logs a sanitized SMTP error and throws a
        // public-safe failure if delivery is rejected.
        await sendPasswordResetEmail({
          email: user.email,
          displayName: user.name,
          resetUrl: url
        });
      }
    } : {}),
    password: {
      hash: hashPassword,
      verify: ({ hash, password }) => verifyPassword(password, hash)
    }
  },
  socialProviders,
  trustedOrigins: [
    env.WEB_APP_URL,
    "personawrapper://",
    "https://appleid.apple.com",
    ...(env.NODE_ENV === "production" ? [] : ["exp://**", "http://localhost:**"])
  ],
  advanced: {
    cookiePrefix: "for-the-baddiez",
    defaultCookieAttributes: authCookieAttributes(env.NODE_ENV),
    database: {
      generateId: ({ model }) => `${model === "user" || model === "users" ? "user" : "auth"}_${randomUUID()}`
    }
  },
  plugins: [
    username({ maxUsernameLength: 64 }),
    expo()
  ]
}) : undefined;

export type AppAuth = NonNullable<typeof auth>;
