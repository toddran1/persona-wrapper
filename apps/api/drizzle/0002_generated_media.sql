CREATE TABLE "generated_media" (
	"id" text PRIMARY KEY NOT NULL,
	"owner_id" text,
	"conversation_id" text,
	"message_id" text,
	"file_name" text NOT NULL,
	"mime_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"local_path" text,
	"storage_key" text,
	"public_url" text,
	"expires_at" timestamp with time zone NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "generated_media" ADD CONSTRAINT "generated_media_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "generated_media" ADD CONSTRAINT "generated_media_message_id_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."messages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "generated_media_owner_id_idx" ON "generated_media" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "generated_media_conversation_id_idx" ON "generated_media" USING btree ("conversation_id");--> statement-breakpoint
CREATE INDEX "generated_media_expires_at_idx" ON "generated_media" USING btree ("expires_at");
