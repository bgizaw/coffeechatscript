import { createHmac, timingSafeEqual } from "node:crypto";
import type { Context } from "@netlify/functions";

const COOKIE = "acc_session";

function sessionToken(password: string) {
  return createHmac("sha256", password).update("autocoffeechat-session-v1").digest("hex");
}

function safeEqual(a: string, b: string) {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

export function appPassword() {
  return Netlify.env.get("APP_PASSWORD") || "";
}

export function checkPassword(candidate: string) {
  const pw = appPassword();
  return Boolean(pw) && safeEqual(candidate, pw);
}

export function setSession(context: Context) {
  context.cookies.set({
    name: COOKIE,
    value: sessionToken(appPassword()),
    path: "/",
    httpOnly: true,
    secure: true,
    sameSite: "Lax",
    maxAge: 60 * 60 * 24 * 30,
  });
}

export function clearSession(context: Context) {
  context.cookies.delete({ name: COOKIE, path: "/" });
}

export function isAuthed(context: Context) {
  const pw = appPassword();
  const value = context.cookies.get(COOKIE);
  return Boolean(pw && value) && safeEqual(value!, sessionToken(pw));
}

/** Returns a 401 response if the request isn't authenticated, otherwise null. */
export function requireAuth(context: Context): Response | null {
  if (!appPassword()) {
    return Response.json(
      { error: "APP_PASSWORD is not configured. Set it in your Netlify environment variables." },
      { status: 500 },
    );
  }
  if (!isAuthed(context)) return Response.json({ error: "Not signed in" }, { status: 401 });
  return null;
}

export function jsonError(err: unknown, status = 500) {
  const message = err instanceof Error ? err.message : String(err);
  console.error(message);
  return Response.json({ error: message }, { status });
}
