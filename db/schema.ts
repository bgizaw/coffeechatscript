import { pgTable, serial, text, timestamp, integer, jsonb } from "drizzle-orm/pg-core";

// Single-row table (id = 1) holding the user's profile, template, and Google connection.
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
