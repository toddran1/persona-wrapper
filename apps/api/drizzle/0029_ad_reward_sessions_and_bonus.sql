ALTER TABLE "customer_usage_balances" ADD COLUMN "bonus_quantity" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "customer_usage_balances" ADD CONSTRAINT "customer_usage_balances_bonus_nonnegative_check" CHECK ("customer_usage_balances"."bonus_quantity" >= 0);
--> statement-breakpoint
CREATE TABLE "ad_reward_sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "ad_reward_sessions" ADD CONSTRAINT "ad_reward_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "ad_reward_sessions_user_status_idx" ON "ad_reward_sessions" USING btree ("user_id","status");
--> statement-breakpoint
CREATE INDEX "ad_reward_sessions_expires_at_idx" ON "ad_reward_sessions" USING btree ("expires_at");
