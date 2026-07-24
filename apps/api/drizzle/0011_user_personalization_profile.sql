ALTER TABLE "users" ADD COLUMN "preferred_name" text;
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "gender" text;
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "birth_month" integer;
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "birth_day" integer;
--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_gender_check"
  CHECK ("gender" IS NULL OR "gender" IN ('male', 'female', 'nonbinary', 'other'));
--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_birth_month_check"
  CHECK ("birth_month" IS NULL OR "birth_month" BETWEEN 1 AND 12);
--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_birth_day_check"
  CHECK ("birth_day" IS NULL OR "birth_day" BETWEEN 1 AND 31);
--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_birthday_pair_check"
  CHECK (("birth_month" IS NULL AND "birth_day" IS NULL) OR ("birth_month" IS NOT NULL AND "birth_day" IS NOT NULL));
