CREATE TABLE "billing_webhook_events" (
	"id" text PRIMARY KEY NOT NULL,
	"provider" text NOT NULL,
	"event_type" text NOT NULL,
	"app_user_id" text,
	"environment" text,
	"status" text DEFAULT 'received' NOT NULL,
	"error" text,
	"payload" jsonb NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "billing_subscriptions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"provider" text NOT NULL,
	"external_subscription_id" text NOT NULL,
	"plan_assignment_id" text NOT NULL,
	"product_id" text NOT NULL,
	"plan_id" text NOT NULL,
	"status" text NOT NULL,
	"store" text,
	"environment" text NOT NULL,
	"current_period_ends_at" timestamp with time zone,
	"last_event_id" text NOT NULL,
	"last_event_at" timestamp with time zone NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "billing_subscriptions" ADD CONSTRAINT "billing_subscriptions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "billing_subscriptions" ADD CONSTRAINT "billing_subscriptions_plan_assignment_id_user_plan_assignments_id_fk" FOREIGN KEY ("plan_assignment_id") REFERENCES "public"."user_plan_assignments"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "billing_subscriptions_provider_external_unique" ON "billing_subscriptions" USING btree ("provider","external_subscription_id");
--> statement-breakpoint
CREATE INDEX "billing_subscriptions_user_status_idx" ON "billing_subscriptions" USING btree ("user_id","status");
--> statement-breakpoint
CREATE INDEX "billing_subscriptions_period_end_idx" ON "billing_subscriptions" USING btree ("current_period_ends_at");
--> statement-breakpoint
CREATE INDEX "billing_webhook_events_status_received_idx" ON "billing_webhook_events" USING btree ("status","received_at");
--> statement-breakpoint
CREATE INDEX "billing_webhook_events_app_user_idx" ON "billing_webhook_events" USING btree ("app_user_id");
