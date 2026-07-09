CREATE TABLE "oauth_exchange_codes" (
  "id" text PRIMARY KEY NOT NULL,
  "code_hash" text NOT NULL,
  "session_id" text NOT NULL,
  "client_type" text DEFAULT 'unknown' NOT NULL,
  "device_id" text,
  "expires_at" timestamp with time zone NOT NULL,
  "consumed_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "oauth_exchange_codes_session_id_auth_sessions_id_fk"
    FOREIGN KEY ("session_id") REFERENCES "auth_sessions"("id") ON DELETE cascade
);

CREATE UNIQUE INDEX "oauth_exchange_codes_code_hash_unique" ON "oauth_exchange_codes" ("code_hash");
CREATE INDEX "oauth_exchange_codes_session_id_idx" ON "oauth_exchange_codes" ("session_id");
CREATE INDEX "oauth_exchange_codes_expires_at_idx" ON "oauth_exchange_codes" ("expires_at");
