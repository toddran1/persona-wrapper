CREATE TABLE "users" (
  "id" text PRIMARY KEY NOT NULL,
  "email" text,
  "username" text,
  "display_name" text,
  "avatar_url" text,
  "status" text DEFAULT 'active' NOT NULL,
  "email_verified_at" timestamp with time zone,
  "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX "users_email_unique" ON "users" ("email");
CREATE UNIQUE INDEX "users_username_unique" ON "users" ("username");
CREATE INDEX "users_status_idx" ON "users" ("status");

CREATE TABLE "user_password_credentials" (
  "user_id" text PRIMARY KEY NOT NULL,
  "password_hash" text NOT NULL,
  "algorithm" text DEFAULT 'scrypt' NOT NULL,
  "password_updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "user_password_credentials_user_id_users_id_fk"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE cascade
);

CREATE TABLE "user_oauth_accounts" (
  "id" text PRIMARY KEY NOT NULL,
  "user_id" text NOT NULL,
  "provider" text NOT NULL,
  "provider_account_id" text NOT NULL,
  "email" text,
  "display_name" text,
  "avatar_url" text,
  "access_token_hash" text,
  "refresh_token_hash" text,
  "scopes" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "user_oauth_accounts_user_id_users_id_fk"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE cascade
);

CREATE INDEX "user_oauth_accounts_user_id_idx" ON "user_oauth_accounts" ("user_id");
CREATE UNIQUE INDEX "user_oauth_accounts_provider_account_unique"
  ON "user_oauth_accounts" ("provider", "provider_account_id");

CREATE TABLE "auth_sessions" (
  "id" text PRIMARY KEY NOT NULL,
  "user_id" text NOT NULL,
  "access_token_hash" text NOT NULL,
  "refresh_token_hash" text NOT NULL,
  "client_type" text DEFAULT 'web' NOT NULL,
  "device_id" text,
  "user_agent" text,
  "ip_address" text,
  "expires_at" timestamp with time zone NOT NULL,
  "refresh_expires_at" timestamp with time zone NOT NULL,
  "revoked_at" timestamp with time zone,
  "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "auth_sessions_user_id_users_id_fk"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE cascade
);

CREATE INDEX "auth_sessions_user_id_idx" ON "auth_sessions" ("user_id");
CREATE UNIQUE INDEX "auth_sessions_access_token_hash_unique" ON "auth_sessions" ("access_token_hash");
CREATE UNIQUE INDEX "auth_sessions_refresh_token_hash_unique" ON "auth_sessions" ("refresh_token_hash");
CREATE INDEX "auth_sessions_expires_at_idx" ON "auth_sessions" ("expires_at");
CREATE INDEX "auth_sessions_refresh_expires_at_idx" ON "auth_sessions" ("refresh_expires_at");

CREATE TABLE "oauth_states" (
  "id" text PRIMARY KEY NOT NULL,
  "state_hash" text NOT NULL,
  "provider" text NOT NULL,
  "redirect_uri" text,
  "code_verifier" text,
  "expires_at" timestamp with time zone NOT NULL,
  "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX "oauth_states_state_hash_unique" ON "oauth_states" ("state_hash");
CREATE INDEX "oauth_states_expires_at_idx" ON "oauth_states" ("expires_at");
