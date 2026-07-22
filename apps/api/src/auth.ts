import { randomUUID } from "node:crypto";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { expo } from "@better-auth/expo";
import { username } from "better-auth/plugins";
import { eq } from "drizzle-orm";
import { env } from "./config/env.js";
import { getDatabase } from "./db/client.js";
import * as schema from "./db/schema.js";
import { hashPassword, verifyPassword } from "./services/passwordService.js";
import { passwordResetEmailEnabled, sendPasswordResetEmail } from "./services/authEmailService.js";
import { authCookieAttributes } from "./utils/authCookieConfig.js";

const database = getDatabase();
const apiOrigin = env.BETTER_AUTH_URL ?? `http://localhost:${env.PORT}`;

const socialProviders = {
  ...(env.GOOGLE_OAUTH_CLIENT_ID && env.GOOGLE_OAUTH_CLIENT_SECRET ? {
    google: {
      clientId: env.GOOGLE_OAUTH_CLIENT_ID,
      clientSecret: env.GOOGLE_OAUTH_CLIENT_SECRET
    }
  } : {}),
  ...(env.FACEBOOK_OAUTH_CLIENT_ID && env.FACEBOOK_OAUTH_CLIENT_SECRET ? {
    facebook: {
      clientId: env.FACEBOOK_OAUTH_CLIENT_ID,
      clientSecret: env.FACEBOOK_OAUTH_CLIENT_SECRET
    }
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
        before: async (user) => ({
          data: {
            ...user,
            name: user.name?.trim() || user.username?.toString() || "Baddie"
          }
        })
      }
    },
    session: {
      create: {
        before: async (session, context) => {
          const user = await database.query.users.findFirst({ where: eq(schema.users.id, session.userId) });
          if (!user) return false;
          if (user.status === "pending_deletion" && context?.path.includes("/callback/")) {
            if (user.deletionScheduledFor && user.deletionScheduledFor.getTime() <= Date.now()) return false;
            await database.update(schema.users).set({
              status: "active",
              deletionRequestedAt: null,
              deletionScheduledFor: null,
              updatedAt: new Date()
            }).where(eq(schema.users.id, user.id));
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
    }
  },
  user: {
    modelName: "users",
    fields: {
      name: "displayName",
      image: "avatarUrl"
    },
    additionalFields: {
      status: { type: "string", required: true, defaultValue: "active", input: false },
      deletionRequestedAt: { type: "date", required: false, input: false },
      deletionScheduledFor: { type: "date", required: false, input: false }
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
      trustedProviders: ["google", "facebook"]
    }
  },
  verification: {
    modelName: "betterAuthVerifications"
  },
  emailAndPassword: {
    enabled: true,
    minPasswordLength: env.AUTH_PASSWORD_MIN_LENGTH,
    maxPasswordLength: 128,
    resetPasswordTokenExpiresIn: 60 * 60,
    revokeSessionsOnPasswordReset: true,
    ...(passwordResetEmailEnabled ? {
      sendResetPassword: async ({ user, url }: { user: { email: string; name: string }; url: string }) => {
        void sendPasswordResetEmail({
          email: user.email,
          displayName: user.name,
          resetUrl: url
        }).catch(() => undefined);
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
