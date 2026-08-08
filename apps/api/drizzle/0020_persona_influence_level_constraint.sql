UPDATE "users"
SET "persona_influence_level" = 'professional'
WHERE "persona_influence_level" NOT IN ('uncensored', 'professional');

ALTER TABLE "users"
ADD CONSTRAINT "users_persona_influence_level_check"
CHECK ("persona_influence_level" IN ('uncensored', 'professional'));
