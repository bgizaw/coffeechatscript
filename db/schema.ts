import { pgTable, serial, text, timestamp, integer, jsonb, index, real, uniqueIndex } from "drizzle-orm/pg-core";

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
  // What happened after sending: bounced | replied (null = nothing reported yet). Feeds the email pattern confidence.
  outcome: text(),
  outcomeAt: timestamp("outcome_at"),
  createdAt: timestamp("created_at").defaultNow(),
});

// One row per company email domain: the address formats learned from the evidence below (a cache rebuilt on each change).
export const emailPatterns = pgTable("email_patterns", {
  domain: text().primaryKey(),
  company: text(),
  // Best-supported format, e.g. "first.last" — null when no example matched a known format.
  pattern: text(),
  // Number of independent examples (distinct people) behind `pattern`.
  matches: integer().notNull().default(0),
  // 0–1 confidence in `pattern`, from public votes plus reply/bounce feedback.
  confidence: real().notNull().default(0),
  // Every format with support, best first: [{ pattern, votes, examples, sources, replies, bounces, confidence, trusted }].
  // More than one can coexist (acquisitions, legacy formats).
  patterns: jsonb().notNull().default([]),
  // Public examples for display: [{ email, name, sourceUrl, sources, formats }]
  examples: jsonb().notNull().default([]),
  // When public sources were last mined (null = mine again on the next search).
  checkedAt: timestamp("checked_at").defaultNow(),
});

// Every real address seen for a domain, and where. Formats are worked out from these at tally time,
// so better name matching applies to old evidence too. Replies and bounces from sent emails are evidence as well.
export const emailEvidence = pgTable(
  "email_evidence",
  {
    id: serial().primaryKey(),
    domain: text().notNull(),
    email: text().notNull(),
    name: text().notNull().default(""),
    // github | npm | pypi | crates | wayback | commoncrawl | sec | academic | press | web | reply | bounce
    source: text().notNull(),
    sourceUrl: text("source_url"),
    // Set for reply/bounce evidence so it can be undone.
    outreachId: integer("outreach_id").references(() => outreach.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at").defaultNow(),
  },
  (t) => [uniqueIndex("email_evidence_domain_email_source_idx").on(t.domain, t.email, t.source)],
);
