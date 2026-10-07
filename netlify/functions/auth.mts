import type { Config, Context } from "@netlify/functions";
import { checkPassword, clearSession, isAuthed, appPassword, setSession } from "../../lib/auth.js";

export default async (req: Request, context: Context) => {
  const path = new URL(req.url).pathname;

  if (path.endsWith("/me")) {
    return Response.json({ authed: isAuthed(context), configured: Boolean(appPassword()) });
  }

  if (path.endsWith("/logout") && req.method === "POST") {
    clearSession(context);
    return Response.json({ ok: true });
  }

  if (path.endsWith("/login") && req.method === "POST") {
    if (!appPassword()) {
      return Response.json({ error: "APP_PASSWORD is not configured on this site." }, { status: 500 });
    }
    const { password } = await req.json().catch(() => ({ password: "" }));
    if (!checkPassword(String(password ?? ""))) {
      return Response.json({ error: "Wrong password" }, { status: 401 });
    }
    setSession(context);
    return Response.json({ ok: true });
  }

  return new Response("Not found", { status: 404 });
};

export const config: Config = {
  path: ["/api/auth/me", "/api/auth/login", "/api/auth/logout"],
};
