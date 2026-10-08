import type { Config, Context } from "@netlify/functions";
import { randomBytes } from "node:crypto";
import { isEmailAllowed, startSession } from "../../lib/auth.js";
import { buildAuthUrl, exchangeCode, isTrustedOrigin } from "../../lib/google.js";
import { upsertGoogleUser } from "../../lib/settings.js";

const STATE_COOKIE = "acc_oauth_state";

// State is "<random>.<c|n>.<origin>": whether full consent was requested (so the callback can't loop),
// and which deploy started the sign-in (so the main site's callback can hand it back).
function parseState(state: string) {
  const [, consent, origin] = state.split(".");
  let from = "";
  try {
    from = Buffer.from(origin ?? "", "base64url").toString("utf8");
  } catch {}
  return { consented: consent === "c", from };
}

// A plain Response (unlike Response.redirect) has mutable headers, so cookies set on the context attach to it.
function redirect(location: string) {
  return new Response(null, { status: 302, headers: { Location: location } });
}

function backToApp(req: Request, params: Record<string, string>) {
  const url = new URL("/", req.url);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return redirect(url.toString());
}

/** "Sign in with Google" — one consent covers sign-in, sending from Gmail, and logging to Sheets. */
export default async (req: Request, context: Context) => {
  const url = new URL(req.url);

  if (url.pathname.endsWith("/start")) {
    try {
      const consent = url.searchParams.get("consent") === "1";
      const origin = Buffer.from(url.origin, "utf8").toString("base64url");
      const state = `${randomBytes(24).toString("hex")}.${consent ? "c" : "n"}.${origin}`;
      context.cookies.set({ name: STATE_COOKIE, value: state, path: "/api/auth/google", httpOnly: true, secure: true, sameSite: "Lax", maxAge: 600 });
      return redirect(buildAuthUrl(req, state, { consent, loginHint: url.searchParams.get("hint") ?? undefined }));
    } catch (err) {
      return backToApp(req, { google: "error", message: (err as Error).message });
    }
  }

  if (url.pathname.endsWith("/callback")) {
    // Google always returns to the main site. If sign-in started on a deploy preview, forward the
    // response there: its state cookie lives on that domain, and the session must be set there too.
    const { from } = parseState(url.searchParams.get("state") ?? "");
    if (from && from !== url.origin && isTrustedOrigin(req, from)) {
      return redirect(`${from}/api/auth/google/callback${url.search}`);
    }

    const expected = context.cookies.get(STATE_COOKIE);
    context.cookies.delete({ name: STATE_COOKIE, path: "/api/auth/google" });
    const error = url.searchParams.get("error");
    if (error) return backToApp(req, { google: "error", message: error === "access_denied" ? "Sign-in was cancelled." : error });
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    if (!code || !state || !expected || state !== expected) {
      return backToApp(req, { google: "error", message: "Sign-in expired, please try again." });
    }
    try {
      const { tokens, profile, missingScopes } = await exchangeCode(req, code);
      if (!isEmailAllowed(profile.email)) {
        return backToApp(req, { google: "error", message: `${profile.email} isn't allowed to use this app.` });
      }
      if (missingScopes.length) {
        return backToApp(req, {
          google: "error",
          message: "Please allow sending email and editing spreadsheets — AutoCoffeeChat needs both to send and log your outreach.",
        });
      }
      const user = await upsertGoogleUser(profile, tokens);
      // Without a refresh token we can't send once the access token expires, so ask Google for full consent.
      if (!user.googleRefreshToken) {
        if (parseState(state).consented) {
          return backToApp(req, { google: "error", message: "Google didn't grant offline access. Please try signing in again." });
        }
        const retry = new URL("/api/auth/google/start", req.url);
        retry.searchParams.set("consent", "1");
        retry.searchParams.set("hint", profile.email);
        return redirect(retry.toString());
      }
      await startSession(context, user.id);
      return backToApp(req, { google: "connected" });
    } catch (err) {
      return backToApp(req, { google: "error", message: (err as Error).message });
    }
  }

  return new Response("Not found", { status: 404 });
};

export const config: Config = {
  path: ["/api/auth/google/start", "/api/auth/google/callback"],
};
