CREATE TABLE "lesson_reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"scenario_id" text NOT NULL,
	"reporter_id" text NOT NULL,
	"reason" text NOT NULL,
	"note" varchar(500),
	"status" text DEFAULT 'open' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_by" text,
	"resolved_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "scenarios" ADD COLUMN "hidden_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "scenarios" ADD COLUMN "hidden_reason" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "banned_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "lesson_reports" ADD CONSTRAINT "lesson_reports_scenario_id_scenarios_id_fk" FOREIGN KEY ("scenario_id") REFERENCES "public"."scenarios"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lesson_reports" ADD CONSTRAINT "lesson_reports_reporter_id_users_id_fk" FOREIGN KEY ("reporter_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lesson_reports" ADD CONSTRAINT "lesson_reports_resolved_by_users_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "lesson_reports_one_open" ON "lesson_reports" USING btree ("scenario_id","reporter_id") WHERE "lesson_reports"."status" = 'open';--> statement-breakpoint
CREATE INDEX "lesson_reports_reporter_id_created_at_index" ON "lesson_reports" USING btree ("reporter_id","created_at");--> statement-breakpoint
CREATE INDEX "lesson_reports_status_index" ON "lesson_reports" USING btree ("status");