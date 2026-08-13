CREATE TABLE IF NOT EXISTS "public_media_analyses" (
	"id" text PRIMARY KEY NOT NULL,
	"media_kind" text NOT NULL,
	"media_id" text NOT NULL,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"resolution" text NOT NULL,
	"analysis_version" text NOT NULL,
	"analysis_text" text NOT NULL,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"reasoning_tokens" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "public_media_analyses_lookup_unique" ON "public_media_analyses" USING btree ("media_kind","media_id","provider","model","resolution","analysis_version");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "public_media_analyses_expires_at_idx" ON "public_media_analyses" USING btree ("expires_at");
