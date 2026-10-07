CREATE TABLE "outreach" (
	"id" serial PRIMARY KEY,
	"search_id" integer NOT NULL,
	"name" text NOT NULL,
	"title" text,
	"company" text NOT NULL,
	"email" text,
	"linkedin_url" text,
	"reason" text,
	"profile" jsonb,
	"apollo_id" text,
	"subject" text DEFAULT '' NOT NULL,
	"body" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"error" text,
	"gmail_message_id" text,
	"sheet_logged" integer DEFAULT 0 NOT NULL,
	"sent_at" timestamp,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "searches" (
	"id" serial PRIMARY KEY,
	"role" text NOT NULL,
	"company" text NOT NULL,
	"company_domain" text,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "settings" (
	"id" integer PRIMARY KEY,
	"sender_name" text DEFAULT '' NOT NULL,
	"sender_background" text DEFAULT '' NOT NULL,
	"email_template" text DEFAULT '' NOT NULL,
	"spreadsheet_id" text,
	"google_email" text,
	"google_refresh_token" text,
	"google_access_token" text,
	"google_token_expires_at" timestamp,
	"oauth_state" text,
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "outreach" ADD CONSTRAINT "outreach_search_id_searches_id_fkey" FOREIGN KEY ("search_id") REFERENCES "searches"("id") ON DELETE CASCADE;