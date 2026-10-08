import { pgTable, serial, text, timestamp, integer, jsonb, index } from "drizzle-orm/pg-core";

// One row per Google account that has signed in. Holds the profile, template, and Google tokens.
export const users = pgTable("users", {
  id: serial().primaryKey(),
  googleSub: text("google_sub").notNull().unique(),
  email: text().notNull(),
  name: text().notNull().default(""),
  picture: text(),
  senderName: text("sender_name").notNull().default(""),
  senderBackground: text("sender_background").notNull().default(""),
  emailTemplate: text("email_template").notNull().default(""),
  // Tiered list of what makes someone a good contact. Empty = use DEFAULT_PRIORITIES.
  contactPriorities: text("contact_priorities").notNull().default(""),
  spreadsheetId: text("spreadsheet_id"),
  // Resume pre-selected on new drafts (null = no attachment by default).
  defaultResumeId: integer("default_resume_id"),
  googleRefreshToken: text("google_refresh_token"),
  googleAccessToken: text("google_access_token"),
  googleTokenExpiresAt: timestamp("google_token_expires_at"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Signed-in browser sessions. The cookie holds a random token; only its SHA-256 hash is stored.
export const sessions = pgTable("sessions", {
  id: text().primaryKey(),
  userId: integer("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  expiresAt: timestamp("expires_at").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
});

// Uploaded resumes. The file itself lives in Netlify Blobs under `blobKey`.
export const resumes = pgTable(
  "resumes",
  {
    id: serial().primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    label: text().notNull(),
    filename: text().notNull(),
    contentType: text("content_type").notNull(),
    size: integer().notNull(),
    blobKey: text("blob_key").notNull(),
    createdAt: timestamp("created_at").defaultNow(),
  },
  (t) => [index("resumes_user_id_idx").on(t.userId)],
);

// Legacy single-row table (id = 1) from before Google sign-in. Claimed by the matching account on first sign-in.
export const settings = pgTable("settings", {
  id: integer().primaryKey(),
  senderName: text("sender_name").notNull().default(""),
  senderBackground: text("sender_background").notNull().default(""),
  emailTemplate: text("email_template").notNull().default(""),
  spreadsheetId: text("spreadsheet_id"),
  googleEmail: text("google_email"),
  googleRefreshToken: text("google_refresh_token"),
  googleAccessToken: text("google_access_token"),
  googleTokenExpiresAt: timestamp("google_token_expires_at"),
  oauthState: text("oauth_state"),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const searches = pgTable("searches", {
  id: serial().primaryKey(),
  // Null only for searches made before Google sign-in that haven't been claimed yet.
  userId: integer("user_id").references(() => users.id, { onDelete: "cascade" }),
  role: text().notNull(),
  company: text().notNull(),
  companyDomain: text("company_domain"),
  // pending | done | failed — searches run in a background function.
  status: text().notNull().default("done"),
  progress: text(),
  error: text(),
  createdAt: timestamp("created_at").defaultNow(),
});

export const outreach = pgTable("outreach", {
  id: serial().primaryKey(),
  searchId: integer("search_id")
    .notNull()
    .references(() => searches.id, { onDelete: "cascade" }),
  name: text().notNull(),
  title: text(),
  company: text().notNull(),
  email: text(),
  linkedinUrl: text("linkedin_url"),
  reason: text(),
  // Snapshot of what we found about the person, used to personalize the AI draft.
  profile: jsonb(),
  // How the email was predicted, e.g. "first.last" (null when entered by hand).
  emailPattern: text("email_pattern"),
  // Resume to attach when sending (null = none).
  resumeId: integer("resume_id").references(() => resumes.id, { onDelete: "set null" }),
  // Filename of the resume that was actually attached, kept after the resume is deleted.
  attachedResume: text("attached_resume"),
  subject: text().notNull().default(""),
  body: text().notNull().default(""),
  // draft | sent | failed
  status: text().notNull().default("draft"),
  error: text(),
  gmailMessageId: text("gmail_message_id"),
  sheetLogged: integer("sheet_logged").notNull().default(0),
  sentAt: timestamp("sent_at"),
  createdAt: timestamp("created_at").defaultNow(),
});

// One row per company email domain: the address format we learned from public examples.
export const emailPatterns = pgTable("email_patterns", {
  domain: text().primaryKey(),
  company: text(),
  // e.g. "first.last" — null when no usable public examples were found.
  pattern: text(),
  // Number of found examples that match the pattern.
  matches: integer().notNull().default(0),
  // [{ email, name, sourceUrl }]
  examples: jsonb().notNull().default([]),
  checkedAt: timestamp("checked_at").defaultNow(),
});
