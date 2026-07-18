ALTER TABLE "users" ADD COLUMN "display_username" text;
ALTER TABLE "users" ADD COLUMN "email_verified" boolean NOT NULL DEFAULT false;

UPDATE "users"
SET
  "email" = COALESCE(NULLIF("email", ''), "id" || '@users.invalid'),
  "display_name" = COALESCE(NULLIF("display_name", ''), NULLIF("username", ''), NULLIF("email", ''), 'Baddie'),
  "display_username" = COALESCE("display_username", "username"),
  "email_verified" = ("email_verified_at" IS NOT NULL);

ALTER TABLE "users" ALTER COLUMN "email" SET NOT NULL;
ALTER TABLE "users" ALTER COLUMN "display_name" SET NOT NULL;

CREATE TABLE "better_auth_accounts" (
  "id" text PRIMARY KEY NOT NULL,
  "account_id" text NOT NULL,
  "provider_id" text NOT NULL,
  "user_id" text NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "access_token" text,
  "refresh_token" text,
  "id_token" text,
  "access_token_expires_at" timestamp with time zone,
  "refresh_token_expires_at" timestamp with time zone,
  "scope" text,
  "password" text,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX "better_auth_accounts_provider_account_unique"
  ON "better_auth_accounts" ("provider_id", "account_id");
CREATE INDEX "better_auth_accounts_user_id_idx" ON "better_auth_accounts" ("user_id");

CREATE TABLE "better_auth_sessions" (
  "id" text PRIMARY KEY NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  "token" text NOT NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  "ip_address" text,
  "user_agent" text,
  "user_id" text NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "client_type" text NOT NULL DEFAULT 'unknown'
);

CREATE UNIQUE INDEX "better_auth_sessions_token_unique" ON "better_auth_sessions" ("token");
CREATE INDEX "better_auth_sessions_user_id_idx" ON "better_auth_sessions" ("user_id");
CREATE INDEX "better_auth_sessions_expires_at_idx" ON "better_auth_sessions" ("expires_at");

CREATE TABLE "better_auth_verifications" (
  "id" text PRIMARY KEY NOT NULL,
  "identifier" text NOT NULL,
  "value" text NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX "better_auth_verifications_identifier_idx" ON "better_auth_verifications" ("identifier");
CREATE INDEX "better_auth_verifications_expires_at_idx" ON "better_auth_verifications" ("expires_at");

INSERT INTO "better_auth_accounts" (
  "id", "account_id", "provider_id", "user_id", "password", "created_at", "updated_at"
)
SELECT
  'legacy_credential_' || "user_id",
  "user_id",
  'credential',
  "user_id",
  "password_hash",
  "created_at",
  "updated_at"
FROM "user_password_credentials"
ON CONFLICT ("provider_id", "account_id") DO NOTHING;

INSERT INTO "better_auth_accounts" (
  "id", "account_id", "provider_id", "user_id", "scope", "created_at", "updated_at"
)
SELECT
  'legacy_oauth_' || "id",
  "provider_account_id",
  "provider",
  "user_id",
  array_to_string(ARRAY(SELECT jsonb_array_elements_text("scopes")), ' '),
  "created_at",
  "updated_at"
FROM "user_oauth_accounts"
ON CONFLICT ("provider_id", "account_id") DO NOTHING;
