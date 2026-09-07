CREATE TABLE "ad_reward_events" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"provider" text NOT NULL,
	"transaction_id" text NOT NULL,
	"reward_type" text NOT NULL,
	"reward_amount" integer NOT NULL,
	"status" text DEFAULT 'verified_pending_grant' NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"verified_at" timestamp with time zone,
	"granted_at" timestamp with time zone,
	CONSTRAINT "ad_reward_events_reward_amount_positive_check" CHECK ("ad_reward_events"."reward_amount" > 0)
);
--> statement-breakpoint
ALTER TABLE "ad_reward_events" ADD CONSTRAINT "ad_reward_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "ad_reward_events_provider_transaction_unique" ON "ad_reward_events" USING btree ("provider","transaction_id");
--> statement-breakpoint
CREATE INDEX "ad_reward_events_user_created_at_idx" ON "ad_reward_events" USING btree ("user_id","created_at");
--> statement-breakpoint
CREATE INDEX "ad_reward_events_status_created_at_idx" ON "ad_reward_events" USING btree ("status","created_at");
