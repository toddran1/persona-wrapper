ALTER TABLE "customer_usage_balances" ADD COLUMN "plan_id" text;
--> statement-breakpoint
ALTER TABLE "customer_usage_balances" ADD COLUMN "base_limit_quantity" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "customer_usage_balances" ADD COLUMN "rollover_quantity" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "customer_usage_balances" ADD CONSTRAINT "customer_usage_balances_base_limit_nonnegative_check" CHECK ("base_limit_quantity" >= 0);
--> statement-breakpoint
ALTER TABLE "customer_usage_balances" ADD CONSTRAINT "customer_usage_balances_rollover_range_check" CHECK ("rollover_quantity" >= 0 AND "rollover_quantity" <= "base_limit_quantity");
