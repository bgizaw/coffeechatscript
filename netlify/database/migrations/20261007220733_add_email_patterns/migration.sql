CREATE TABLE "email_patterns" (
	"domain" text PRIMARY KEY,
	"company" text,
	"pattern" text,
	"matches" integer DEFAULT 0 NOT NULL,
	"examples" jsonb DEFAULT '[]' NOT NULL,
	"checked_at" timestamp DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "outreach" ADD COLUMN "email_pattern" text;--> statement-breakpoint
ALTER TABLE "searches" ADD COLUMN "status" text DEFAULT 'done' NOT NULL;--> statement-breakpoint
ALTER TABLE "searches" ADD COLUMN "progress" text;--> statement-breakpoint
ALTER TABLE "searches" ADD COLUMN "error" text;