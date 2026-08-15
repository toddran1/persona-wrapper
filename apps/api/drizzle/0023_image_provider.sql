ALTER TABLE "users" ADD COLUMN "image_provider" text DEFAULT 'openai' NOT NULL;
ALTER TABLE "users"
ADD CONSTRAINT "users_image_provider_check"
CHECK ("image_provider" IN ('openai', 'flux'));
