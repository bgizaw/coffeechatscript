CREATE TABLE "resumes" (
	"id" serial PRIMARY KEY,
	"user_id" integer NOT NULL,
	"label" text NOT NULL,
	"filename" text NOT NULL,
	"content_type" text NOT NULL,
	"size" integer NOT NULL,
	"blob_key" text NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" text PRIMARY KEY,
	"user_id" integer NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" serial PRIMARY KEY,
	"google_sub" text NOT NULL UNIQUE,
	"email" text NOT NULL,
	"name" text DEFAULT '' NOT NULL,
	"picture" text,
	"sender_name" text DEFAULT '' NOT NULL,
	"sender_background" text DEFAULT '' NOT NULL,
	"email_template" text DEFAULT '' NOT NULL,
	"spreadsheet_id" text,
	"default_resume_id" integer,
	"google_refresh_token" text,
	"google_access_token" text,
	"google_token_expires_at" timestamp,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "outreach" ADD COLUMN "resume_id" integer;--> statement-breakpoint
ALTER TABLE "outreach" ADD COLUMN "attached_resume" text;--> statement-breakpoint
ALTER TABLE "searches" ADD COLUMN "user_id" integer;--> statement-breakpoint
CREATE INDEX "resumes_user_id_idx" ON "resumes" ("user_id");--> statement-breakpoint
ALTER TABLE "outreach" ADD CONSTRAINT "outreach_resume_id_resumes_id_fkey" FOREIGN KEY ("resume_id") REFERENCES "resumes"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "resumes" ADD CONSTRAINT "resumes_user_id_users_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "searches" ADD CONSTRAINT "searches_user_id_users_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE;