import { eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { settings } from "../db/schema.js";

export type Settings = typeof settings.$inferSelect;

export async function getSettings(): Promise<Settings> {
  const [row] = await db.select().from(settings).where(eq(settings.id, 1));
  if (row) return row;
  const [created] = await db.insert(settings).values({ id: 1 }).onConflictDoNothing().returning();
  if (created) return created;
  const [again] = await db.select().from(settings).where(eq(settings.id, 1));
  return again;
}

export async function updateSettings(values: Partial<typeof settings.$inferInsert>) {
  await getSettings();
  const [row] = await db
    .update(settings)
    .set({ ...values, updatedAt: new Date() })
    .where(eq(settings.id, 1))
    .returning();
  return row;
}

/** Shape safe to send to the browser — never includes tokens. */
export function publicSettings(s: Settings) {
  return {
    senderName: s.senderName,
    senderBackground: s.senderBackground,
    emailTemplate: s.emailTemplate,
    spreadsheetId: s.spreadsheetId,
    googleEmail: s.googleEmail,
    googleConnected: Boolean(s.googleRefreshToken),
  };
}
