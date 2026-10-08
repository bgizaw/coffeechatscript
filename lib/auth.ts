import { createHash, randomBytes } from "node:crypto";
import type { Context } from "@netlify/functions";
import { and, eq, gt, lt } from "drizzle-orm";
import { db } from "../db/index.js";
import { sessions, users } from "../db/schema.js";

const COOKIE = "acc_session";
const SESSION_DAYS = 30;

export type User = typeof users.$inferSelect;

function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

/** Creates a session for the user and sets the session cookie. */
export async function startSession(context: Context, userId: number) {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000);
  await db.insert(sessions).values({ id: hashToken(token), userId, expiresAt });
  // Opportunistically clean up expired sessions.
  await db.delete(sessions).where(lt(sessions.expiresAt, new Date()));
  context.cookies.set({
    name: COOKIE,
    value: token,
    path: "/",
    httpOnly: true,
    secure: true,
    sameSite: "Lax",
    maxAge: SESSION_DAYS * 24 * 60 * 60,
  });
}

export async function endSession(context: Context) {
  const token = context.cookies.get(COOKIE);
  if (token) await db.delete(sessions).where(eq(sessions.id, hashToken(token)));
  context.cookies.delete({ name: COOKIE, path: "/" });
}

/** Returns the signed-in user, or null. */
export async function currentUser(context: Context): Promise<User | null> {
  const token = context.cookies.get(COOKIE);
  if (!token) return null;
  const [row] = await db
    .select({ user: users })
    .from(sessions)
    .innerJoin(users, eq(sessions.userId, users.id))
    .where(and(eq(sessions.id, hashToken(token)), gt(sessions.expiresAt, new Date())));
  return row?.user ?? null;
}

/** Returns the signed-in user, or a 401 response. */
export async function requireUser(context: Context): Promise<User | Response> {
  const user = await currentUser(context);
  return user ?? Response.json({ error: "Not signed in" }, { status: 401 });
}

/** Optional comma-separated allowlist of emails or @domains that may sign in. Empty = anyone. */
export function isEmailAllowed(email: string) {
  const list = (Netlify.env.get("ALLOWED_EMAILS") || "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  if (!list.length) return true;
  const e = email.toLowerCase();
  return list.some((entry) => (entry.startsWith("@") ? e.endsWith(entry) : e === entry));
}

export function jsonError(err: unknown, status = 500) {
  const message = err instanceof Error ? err.message : String(err);
  console.error(message);
  return Response.json({ error: message }, { status });
}
