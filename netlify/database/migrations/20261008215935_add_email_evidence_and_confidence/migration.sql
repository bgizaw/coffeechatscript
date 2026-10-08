CREATE TABLE "email_evidence" (
	"id" serial PRIMARY KEY,
	"domain" text NOT NULL,
	"email" text NOT NULL,
	"name" text DEFAULT '' NOT NULL,
	"source" text NOT NULL,
	"source_url" text,
	"outreach_id" integer,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "email_patterns" ADD COLUMN "confidence" real DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "email_patterns" ADD COLUMN "patterns" jsonb DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE "outreach" ADD COLUMN "outcome" text;--> statement-breakpoint
ALTER TABLE "outreach" ADD COLUMN "outcome_at" timestamp;--> statement-breakpoint
CREATE UNIQUE INDEX "email_evidence_domain_email_source_idx" ON "email_evidence" ("domain","email","source");--> statement-breakpoint
ALTER TABLE "email_evidence" ADD CONSTRAINT "email_evidence_outreach_id_outreach_id_fkey" FOREIGN KEY ("outreach_id") REFERENCES "outreach"("id") ON DELETE SET NULL;--> statement-breakpoint
-- Keep the examples found by the old web search as evidence, then re-mine those domains with the new sources.
INSERT INTO "email_evidence" ("domain", "email", "name", "source", "source_url")
SELECT p."domain", lower(e->>'email'), coalesce(e->>'name', ''), 'web', e->>'sourceUrl'
FROM "email_patterns" p, jsonb_array_elements(p."examples") e
WHERE e->>'email' IS NOT NULL
ON CONFLICT DO NOTHING;--> statement-breakpoint
UPDATE "email_patterns" SET "checked_at" = NULL;
