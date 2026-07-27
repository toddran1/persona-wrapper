ALTER TABLE "users" ADD COLUMN "terms_version_accepted" text;
ALTER TABLE "users" ADD COLUMN "terms_accepted_at" timestamp with time zone;
ALTER TABLE "users" ADD COLUMN "privacy_version_accepted" text;
ALTER TABLE "users" ADD COLUMN "privacy_accepted_at" timestamp with time zone;
