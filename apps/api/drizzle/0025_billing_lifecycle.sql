ALTER TABLE "billing_subscriptions" ADD COLUMN "pending_plan_id" text;
--> statement-breakpoint
ALTER TABLE "billing_subscriptions" ADD COLUMN "cancel_reason" text;
--> statement-breakpoint
ALTER TABLE "billing_subscriptions" ADD COLUMN "expiration_reason" text;
--> statement-breakpoint
ALTER TABLE "billing_subscriptions" ADD COLUMN "grace_period_ends_at" timestamp with time zone;
