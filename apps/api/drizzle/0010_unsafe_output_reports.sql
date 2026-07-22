CREATE TABLE IF NOT EXISTS "unsafe_output_reports" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text,
	"conversation_id" text,
	"category" text NOT NULL,
	"output_excerpt" text NOT NULL,
	"details" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "unsafe_output_reports" ADD CONSTRAINT "unsafe_output_reports_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "unsafe_output_reports" ADD CONSTRAINT "unsafe_output_reports_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "unsafe_output_reports_user_id_idx" ON "unsafe_output_reports" USING btree ("user_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "unsafe_output_reports_conversation_id_idx" ON "unsafe_output_reports" USING btree ("conversation_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "unsafe_output_reports_category_idx" ON "unsafe_output_reports" USING btree ("category");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "unsafe_output_reports_created_at_idx" ON "unsafe_output_reports" USING btree ("created_at");
