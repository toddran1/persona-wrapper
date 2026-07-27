CREATE TABLE IF NOT EXISTS "user_plan_assignments" (
  "id" text PRIMARY KEY NOT NULL,
  "user_id" text NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "plan_id" text NOT NULL,
  "plan_version" integer NOT NULL,
  "status" text DEFAULT 'active' NOT NULL,
  "source" text DEFAULT 'system' NOT NULL,
  "effective_at" timestamp with time zone DEFAULT now() NOT NULL,
  "expires_at" timestamp with time zone,
  "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "user_plan_assignments_user_effective_idx"
  ON "user_plan_assignments" ("user_id", "effective_at" DESC);
CREATE INDEX IF NOT EXISTS "user_plan_assignments_status_expires_idx"
  ON "user_plan_assignments" ("status", "expires_at");

CREATE TABLE IF NOT EXISTS "customer_usage_balances" (
  "id" text PRIMARY KEY NOT NULL,
  "user_id" text NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "meter_key" text NOT NULL,
  "period_start" timestamp with time zone NOT NULL,
  "period_end" timestamp with time zone NOT NULL,
  "used_quantity" integer DEFAULT 0 NOT NULL,
  "reserved_quantity" integer DEFAULT 0 NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "customer_usage_balances_user_meter_period_unique"
  ON "customer_usage_balances" ("user_id", "meter_key", "period_start");
CREATE INDEX IF NOT EXISTS "customer_usage_balances_period_end_idx"
  ON "customer_usage_balances" ("period_end");

CREATE TABLE IF NOT EXISTS "customer_usage_events" (
  "id" text PRIMARY KEY NOT NULL,
  "operation_id" text NOT NULL,
  "idempotency_key" text NOT NULL,
  "user_id" text NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "meter_key" text NOT NULL,
  "quantity" integer DEFAULT 0 NOT NULL,
  "status" text NOT NULL,
  "plan_id" text NOT NULL,
  "plan_version" integer NOT NULL,
  "provider" text,
  "model" text,
  "estimated_cost_micro_usd" integer DEFAULT 0 NOT NULL,
  "actual_cost_micro_usd" integer DEFAULT 0 NOT NULL,
  "conversation_id" text REFERENCES "conversations"("id") ON DELETE SET NULL,
  "message_id" text REFERENCES "messages"("id") ON DELETE SET NULL,
  "period_start" timestamp with time zone NOT NULL,
  "period_end" timestamp with time zone NOT NULL,
  "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "settled_at" timestamp with time zone
);

CREATE UNIQUE INDEX IF NOT EXISTS "customer_usage_events_user_idempotency_meter_unique"
  ON "customer_usage_events" ("user_id", "idempotency_key", "meter_key");
CREATE INDEX IF NOT EXISTS "customer_usage_events_operation_idx"
  ON "customer_usage_events" ("operation_id");
CREATE INDEX IF NOT EXISTS "customer_usage_events_user_period_idx"
  ON "customer_usage_events" ("user_id", "period_start", "meter_key");
CREATE INDEX IF NOT EXISTS "customer_usage_events_status_created_idx"
  ON "customer_usage_events" ("status", "created_at");
