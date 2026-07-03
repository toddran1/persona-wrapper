CREATE TABLE "vector_stores" (
	"id" text PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"name" text,
	"expires_at" timestamp with time zone NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "vector_stores_owner_id_idx" ON "vector_stores" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "vector_stores_expires_at_idx" ON "vector_stores" USING btree ("expires_at");