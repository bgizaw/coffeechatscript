import { count, eq, isNull } from "drizzle-orm";
import { db } from "../db/index.js";
import { searches, settings, users } from "../db/schema.js";
import type { User } from "./auth.js";
import { priorityList } from "./priorities.js";

export async function updateUser(userId: number, values: Partial<typeof users.$inferInsert>) {
  const [row] = await db
    .update(users)
    .set({ ...values, updatedAt: new Date() })
    .where(eq(users.id, userId))
    .returning();
  return row;
}

/** Shape safe to send to the browser — never includes tokens. */
export function publicSettings(u: User) {
  return {
    email: u.email,
    name: u.name,
    picture: u.picture,
    senderName: u.senderName,
    senderBackground: u.senderBackground,
    emailTemplate: u.emailTemplate,
    contactPriorities: priorityList(u.contactPriorities),
    spreadsheetId: u.spreadsheetId,
    defaultResumeId: u.defaultResumeId,
    googleEmail: u.email,
    googleConnected: Boolean(u.googleRefreshToken),
  };
}

type GoogleProfile = { sub: string; email: string; name?: string; picture?: string };
type GoogleTokens = { access_token: string; expires_in: number; refresh_token?: string };

/** Creates or updates the account for a Google sign-in and returns it. */
export async function upsertGoogleUser(profile: GoogleProfile, tokens: GoogleTokens) {
  const tokenValues = {
    email: profile.email,
    name: profile.name ?? "",
    picture: profile.picture ?? null,
    googleAccessToken: tokens.access_token,
    googleTokenExpiresAt: new Date(Date.now() + tokens.expires_in * 1000),
    // Google only returns a refresh token on consent; keep the old one otherwise.
    ...(tokens.refresh_token ? { googleRefreshToken: tokens.refresh_token } : {}),
  };
  const [existing] = await db.select().from(users).where(eq(users.googleSub, profile.sub));
  if (existing) return updateUser(existing.id, tokenValues);

  const [created] = await db
    .insert(users)
    .values({ googleSub: profile.sub, senderName: profile.name ?? "", ...tokenValues })
    .onConflictDoUpdate({ target: users.googleSub, set: { ...tokenValues, updatedAt: new Date() } })
    .returning();
  return (await claimLegacyData(created)) ?? created;
}

/**
 * Before Google sign-in the app had one shared profile. Hand it (and its searches) to the account whose
 * Gmail matches it — or to the first account, if Gmail was never connected — then retire it.
 */
async function claimLegacyData(user: User) {
  const [legacy] = await db.select().from(settings).where(eq(settings.id, 1));
  if (!legacy) return null;
  const matches = legacy.googleEmail
    ? legacy.googleEmail.toLowerCase() === user.email.toLowerCase()
    : (await db.select({ n: count() }).from(users))[0].n === 1;
  if (!matches) return null;

  const [deleted] = await db.delete(settings).where(eq(settings.id, 1)).returning();
  if (!deleted) return null; // another request claimed it first
  await db.update(searches).set({ userId: user.id }).where(isNull(searches.userId));
  return updateUser(user.id, {
    senderName: legacy.senderName || user.senderName,
    senderBackground: legacy.senderBackground,
    emailTemplate: legacy.emailTemplate,
    spreadsheetId: legacy.spreadsheetId,
  });
}
