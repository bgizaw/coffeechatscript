import type { Config, Context } from "@netlify/functions";
import { randomBytes } from "node:crypto";
import { requireAuth } from "../../lib/auth.js";
import { buildAuthUrl, exchangeCode } from "../../lib/google.js";
import { getSettings, updateSettings } from "../../lib/settings.js";

function backToApp(req: Request, params: Record<string, string>) {
  const url = new URL("/", req.url);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return Response.redirect(url.toString(), 302);
}

export default async (req: Request, context: Context) => {
  const url = new URL(req.url);
  const denied = requireAuth(context);

  if (url.pathname.endsWith("/start")) {
    if (denied) return backToApp(req, { google: "error", message: "Sign in first" });
    try {
      const state = randomBytes(24).toString("hex");
      await updateSettings({ oauthState: state });
      return Response.redirect(buildAuthUrl(req, state), 302);
    } catch (err) {
      return backToApp(req, { google: "error", message: (err as Error).message });
    }
  }

  if (url.pathname.endsWith("/callback")) {
    if (denied) return backToApp(req, { google: "error", message: "Sign in first" });
    const error = url.searchParams.get("error");
    if (error) return backToApp(req, { google: "error", message: error });
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    const s = await getSettings();
    if (!code || !state || !s.oauthState || state !== s.oauthState) {
      return backToApp(req, { google: "error", message: "Invalid OAuth state, please try again." });
    }
    try {
      const tokens = await exchangeCode(req, code);
      await updateSettings({
        oauthState: null,
        googleEmail: tokens.email,
        googleAccessToken: tokens.access_token,
        googleTokenExpiresAt: new Date(Date.now() + tokens.expires_in * 1000),
        // Google only returns a refresh token on first consent; keep the old one otherwise.
        ...(tokens.refresh_token ? { googleRefreshToken: tokens.refresh_token } : {}),
      });
      return backToApp(req, { google: "connected" });
    } catch (err) {
      return backToApp(req, { google: "error", message: (err as Error).message });
    }
  }

  if (url.pathname.endsWith("/disconnect") && req.method === "POST") {
    if (denied) return denied;
    await updateSettings({
      googleEmail: null,
      googleRefreshToken: null,
      googleAccessToken: null,
      googleTokenExpiresAt: null,
    });
    return Response.json({ ok: true });
  }

  return new Response("Not found", { status: 404 });
};

export const config: Config = {
  path: ["/api/auth/google/start", "/api/auth/google/callback", "/api/auth/google/disconnect"],
};
