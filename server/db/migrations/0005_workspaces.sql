CREATE TABLE "run_workspaces" (
	"run_id" uuid PRIMARY KEY NOT NULL,
	"bundle" "bytea" NOT NULL,
	"bytes" integer NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "run_workspaces" ADD CONSTRAINT "run_workspaces_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE cascade ON UPDATE no action;