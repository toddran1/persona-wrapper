CREATE TABLE IF NOT EXISTS "openai_artifacts" (
  "id" text PRIMARY KEY NOT NULL,
  "owner_id" text,
  "conversation_id" text,
  "message_id" text,
  "container_id" text NOT NULL,
  "file_id" text NOT NULL,
  "file_name" text NOT NULL,
  "mime_type" text NOT NULL,
  "size_bytes" integer,
  "local_path" text,
  "storage_key" text,
  "public_url" text,
  "expires_at" timestamp with time zone NOT NULL,
  "metadata" jsonb DEFAULT jsonb_build_object() NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "usage_events" (
  "id" text PRIMARY KEY NOT NULL,
  "identity" text NOT NULL,
  "event_type" text NOT NULL,
  "tokens" integer DEFAULT 0 NOT NULL,
  "cost_micro_usd" integer DEFAULT 0 NOT NULL,
  "metadata" jsonb DEFAULT jsonb_build_object() NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "openai_artifacts" ADD CONSTRAINT "openai_artifacts_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "openai_artifacts" ADD CONSTRAINT "openai_artifacts_message_id_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."messages"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "openai_artifacts_owner_id_idx" ON "openai_artifacts" USING btree ("owner_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "openai_artifacts_file_id_idx" ON "openai_artifacts" USING btree ("file_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "openai_artifacts_expires_at_idx" ON "openai_artifacts" USING btree ("expires_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "usage_events_identity_created_at_idx" ON "usage_events" USING btree ("identity","created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "usage_events_event_type_idx" ON "usage_events" USING btree ("event_type");
