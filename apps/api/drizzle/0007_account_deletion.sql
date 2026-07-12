ALTER TABLE "users" ADD COLUMN "deletion_requested_at" timestamp with time zone;
ALTER TABLE "users" ADD COLUMN "deletion_scheduled_for" timestamp with time zone;
CREATE INDEX "users_deletion_scheduled_for_idx" ON "users" USING btree ("deletion_scheduled_for");
