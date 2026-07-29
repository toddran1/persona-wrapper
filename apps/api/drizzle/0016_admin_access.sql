ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "role" text DEFAULT 'user' NOT NULL;

CREATE INDEX IF NOT EXISTS "users_role_idx"
  ON "users" ("role");

UPDATE "users"
SET "role" = 'admin',
    "updated_at" = now()
WHERE lower(trim("email")) IN (
  'todd@yahoo.com',
  'todd_ran222@yahoo.com',
  'toddran1@gmail.com'
);
