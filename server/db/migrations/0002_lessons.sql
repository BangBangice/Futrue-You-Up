ALTER TABLE "scenarios" ADD COLUMN "author_id" text;--> statement-breakpoint
ALTER TABLE "scenarios" ADD COLUMN "visibility" text DEFAULT 'private' NOT NULL;--> statement-breakpoint
ALTER TABLE "scenarios" ADD COLUMN "tags" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "scenarios" ADD COLUMN "summary" text;--> statement-breakpoint
ALTER TABLE "scenarios" ADD CONSTRAINT "scenarios_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "scenarios_tags_index" ON "scenarios" USING gin ("tags");--> statement-breakpoint
-- Every scenario so far is a built-in: the published ones stay playable and belong in the public library.
UPDATE "scenarios" SET "visibility" = 'public' WHERE EXISTS (SELECT 1 FROM "scenario_versions" v WHERE v."scenario_id" = "scenarios"."id" AND v."status" = 'published');
