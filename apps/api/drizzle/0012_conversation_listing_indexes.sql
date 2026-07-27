CREATE EXTENSION IF NOT EXISTS "pg_trgm";
--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "pinned" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
UPDATE "conversations"
SET
  "pinned" = ("metadata" -> 'pinned') = 'true'::jsonb,
  "metadata" = "metadata" - 'pinned'
WHERE "metadata" ? 'pinned';
--> statement-breakpoint
CREATE INDEX "conversations_user_updated_at_desc_idx"
ON "conversations" USING btree ("user_id", "updated_at" DESC, "id" DESC);
--> statement-breakpoint
CREATE INDEX "conversations_user_pinned_updated_at_desc_idx"
ON "conversations" USING btree ("user_id", "pinned" DESC, "updated_at" DESC, "id" DESC);
--> statement-breakpoint
CREATE INDEX "conversations_title_trgm_idx"
ON "conversations" USING gin ("title" gin_trgm_ops);
