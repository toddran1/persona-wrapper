ALTER TABLE "unsafe_output_reports" ADD COLUMN "status" text DEFAULT 'open' NOT NULL;
ALTER TABLE "unsafe_output_reports" ADD COLUMN "resolution" text;
ALTER TABLE "unsafe_output_reports" ADD COLUMN "resolved_by_user_id" text;
ALTER TABLE "unsafe_output_reports" ADD COLUMN "resolved_at" timestamp with time zone;
ALTER TABLE "unsafe_output_reports" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;
ALTER TABLE "unsafe_output_reports" ADD CONSTRAINT "unsafe_output_reports_resolved_by_user_id_users_id_fk" FOREIGN KEY ("resolved_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
ALTER TABLE "unsafe_output_reports" ADD CONSTRAINT "unsafe_output_reports_status_check" CHECK ("unsafe_output_reports"."status" in ('open', 'resolved', 'dismissed'));
CREATE INDEX "unsafe_output_reports_status_created_at_idx" ON "unsafe_output_reports" USING btree ("status", "created_at");

CREATE TABLE "admin_audit_events" (
	"id" text PRIMARY KEY NOT NULL,
	"actor_user_id" text,
	"action" text NOT NULL,
	"target_type" text NOT NULL,
	"target_id" text,
	"reason" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "admin_audit_events_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action
);
CREATE INDEX "admin_audit_events_actor_created_at_idx" ON "admin_audit_events" USING btree ("actor_user_id", "created_at");
CREATE INDEX "admin_audit_events_action_created_at_idx" ON "admin_audit_events" USING btree ("action", "created_at");
CREATE INDEX "admin_audit_events_target_idx" ON "admin_audit_events" USING btree ("target_type", "target_id");

CREATE TABLE "operational_events" (
	"id" text PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"component" text NOT NULL,
	"status" text DEFAULT 'failed' NOT NULL,
	"message" text NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone,
	CONSTRAINT "operational_events_status_check" CHECK ("operational_events"."status" in ('failed', 'resolved'))
);
CREATE INDEX "operational_events_kind_status_created_idx" ON "operational_events" USING btree ("kind", "status", "created_at");

CREATE TABLE "ad_impression_revenue_events" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"reward_session_id" text NOT NULL,
	"provider" text DEFAULT 'admob' NOT NULL,
	"ad_format" text DEFAULT 'rewarded' NOT NULL,
	"ad_unit_id" text,
	"value_micro" integer NOT NULL,
	"currency" text NOT NULL,
	"precision" text NOT NULL,
	"source" text DEFAULT 'client_ilar' NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ad_impression_revenue_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action,
	CONSTRAINT "ad_impression_revenue_events_reward_session_id_ad_reward_sessions_id_fk" FOREIGN KEY ("reward_session_id") REFERENCES "public"."ad_reward_sessions"("id") ON DELETE cascade ON UPDATE no action,
	CONSTRAINT "ad_impression_revenue_value_check" CHECK ("ad_impression_revenue_events"."value_micro" >= 0 and "ad_impression_revenue_events"."value_micro" <= 1000000000)
);
CREATE UNIQUE INDEX "ad_impression_revenue_provider_session_unique" ON "ad_impression_revenue_events" USING btree ("provider", "reward_session_id");
CREATE INDEX "ad_impression_revenue_currency_created_at_idx" ON "ad_impression_revenue_events" USING btree ("currency", "created_at");
