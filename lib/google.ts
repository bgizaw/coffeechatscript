import { randomBytes } from "node:crypto";
import type { User } from "./auth.js";
import { updateUser } from "./settings.js";

export const GOOGLE_SCOPES = [
  "openid",
  "email",
  "profile",
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/spreadsheets",
];

const SHEET_HEADERS = [
  "Sent At",
  "Name",
  "Company",
  "Their Role",
  "Email",
  "Role I Applied For",
  "Subject",
  "LinkedIn",
  "Resume Attached",
];

function clientCreds() {
  const clientId = Netlify.env.get("GOOGLE_CLIENT_ID");
  const clientSecret = Netlify.env.get("GOOGLE_CLIENT_SECRET");
  if (!clientId || !clientSecret) {
    throw new Error("GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET must be set in your Netlify environment variables.");
  }
  return { clientId, clientSecret };
}

/**
 * Google only accepts redirect URIs that exactly match one registered on the OAuth client (no wildcards),
 * so every deploy uses the main site's callback. Deploy previews are handed back by `isTrustedOrigin`.
 * Set GOOGLE_REDIRECT_ORIGIN to use a custom domain instead of the site's primary URL.
 */
export function authOrigin(req: Request) {
  const own = new URL(req.url);
  if (own.hostname === "localhost" || own.hostname === "127.0.0.1") return own.origin;
  const configured = Netlify.env.get("GOOGLE_REDIRECT_ORIGIN") || Netlify.env.get("URL");
  return configured ? new URL(configured).origin : own.origin;
}

export function redirectUri(req: Request) {
  return `${authOrigin(req)}/api/auth/google/callback`;
}

/** Whether a sign-in started on `origin` may be handed back there: the main site or one of its Netlify deploys. */
export function isTrustedOrigin(req: Request, origin: string) {
  let host: string;
  try {
    const u = new URL(origin);
    if (u.protocol !== "https:" && u.hostname !== "localhost") return false;
    host = u.hostname;
  } catch {
    return false;
  }
  const main = new URL(authOrigin(req)).hostname;
  const site = Netlify.env.get("URL") ? new URL(Netlify.env.get("URL")!).hostname : main;
  if (host === main || host === site) return true;
  // Deploy previews, branch deploys, and permalinks look like <prefix>--<site>.netlify.app.
  const siteName = Netlify.env.get("SITE_NAME") || (site.endsWith(".netlify.app") ? site.slice(0, -".netlify.app".length) : "");
  return Boolean(siteName) && host.endsWith(`--${siteName}.netlify.app`);
}

/** `consent` forces Google's consent screen, which is the only time it hands out a refresh token. */
export function buildAuthUrl(req: Request, state: string, opts: { consent?: boolean; loginHint?: string } = {}) {
  const { clientId } = clientCreds();
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri(req),
    response_type: "code",
    scope: GOOGLE_SCOPES.join(" "),
    access_type: "offline",
    prompt: opts.consent ? "consent select_account" : "select_account",
    include_granted_scopes: "true",
    state,
    ...(opts.loginHint ? { login_hint: opts.loginHint } : {}),
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
}

async function tokenRequest(body: Record<string, string>) {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`Google token error: ${data.error_description || data.error || res.status}`);
  return data as { access_token: string; expires_in: number; refresh_token?: string; id_token?: string };
}

export async function exchangeCode(req: Request, code: string) {
  const { clientId, clientSecret } = clientCreds();
  const tokens = await tokenRequest({
    code,
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: redirectUri(req),
    grant_type: "authorization_code",
  });
  if (!tokens.id_token) throw new Error("Google didn't return an ID token.");
  // The ID token came straight from Google's token endpoint over TLS, so its claims can be trusted as-is.
  const claims = JSON.parse(Buffer.from(tokens.id_token.split(".")[1], "base64url").toString("utf8"));
  if (claims.aud !== clientCreds().clientId) throw new Error("Google ID token was issued for a different app.");
  if (!claims.sub || !claims.email) throw new Error("Google didn't share your email address.");
  if (claims.email_verified === false) throw new Error("Your Google email address isn't verified.");
  const granted = new Set(String((tokens as { scope?: string }).scope ?? "").split(" "));
  const missing = GOOGLE_SCOPES.filter((s) => s.startsWith("https://") && !granted.has(s));
  return {
    tokens,
    missingScopes: missing,
    profile: { sub: String(claims.sub), email: String(claims.email), name: claims.name as string | undefined, picture: claims.picture as string | undefined },
  };
}

/** Revokes the app's access to the user's Google account (used when deleting an account). */
export async function revokeGoogle(user: User) {
  const token = user.googleRefreshToken || user.googleAccessToken;
  if (!token) return;
  await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(token)}`, { method: "POST" }).catch(() => {});
}

async function getAccessToken(user: User) {
  if (user.googleAccessToken && user.googleTokenExpiresAt && user.googleTokenExpiresAt.getTime() > Date.now() + 60_000) {
    return user.googleAccessToken;
  }
  if (!user.googleRefreshToken) {
    throw new Error("Google access has expired. Sign out and sign back in with Google to reconnect.");
  }
  const { clientId, clientSecret } = clientCreds();
  const tokens = await tokenRequest({
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: user.googleRefreshToken,
    grant_type: "refresh_token",
  }).catch(async (err) => {
    // A revoked or expired refresh token can't be reused; clear it so the UI asks to reconnect.
    if (/invalid_grant|expired|revoked/i.test((err as Error).message)) {
      await updateUser(user.id, { googleRefreshToken: null, googleAccessToken: null, googleTokenExpiresAt: null });
      throw new Error("Google access has expired. Sign out and sign back in with Google to reconnect.");
    }
    throw err;
  });
  user.googleAccessToken = tokens.access_token;
  user.googleTokenExpiresAt = new Date(Date.now() + tokens.expires_in * 1000);
  await updateUser(user.id, { googleAccessToken: user.googleAccessToken, googleTokenExpiresAt: user.googleTokenExpiresAt });
  return tokens.access_token;
}

async function googleFetch(user: User, url: string, init: RequestInit = {}) {
  const token = await getAccessToken(user);
  const res = await fetch(url, {
    ...init,
    headers: { "Content-Type": "application/json", ...init.headers, Authorization: `Bearer ${token}` },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Google API error (${res.status}): ${data?.error?.message || "unknown"}`);
  return data;
}

function encodeHeader(value: string) {
  // RFC 2047 encode anything non-ASCII so names/subjects survive.
  return /^[\x20-\x7e]*$/.test(value) ? value : `=?UTF-8?B?${Buffer.from(value, "utf8").toString("base64")}?=`;
}

function base64Lines(data: Buffer) {
  return data.toString("base64").replace(/.{76}/g, "$&\r\n");
}

export type Attachment = { filename: string; contentType: string; data: Buffer };

export async function sendGmail(
  user: User,
  opts: { fromName: string; to: string; toName: string; subject: string; body: string; attachment?: Attachment | null },
) {
  const from = opts.fromName ? `${encodeHeader(opts.fromName)} <${user.email}>` : user.email;
  const to = opts.toName ? `${encodeHeader(opts.toName)} <${opts.to}>` : opts.to;
  const textPart = [
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: base64",
    "",
    base64Lines(Buffer.from(opts.body.replace(/\r?\n/g, "\r\n"), "utf8")),
  ];
  const headers = [`From: ${from}`, `To: ${to}`, `Subject: ${encodeHeader(opts.subject)}`, "MIME-Version: 1.0"];

  let mime: string[];
  if (opts.attachment) {
    const boundary = `acc_${randomBytes(12).toString("hex")}`;
    const name = encodeHeader(opts.attachment.filename.replace(/["\r\n\\]/g, ""));
    mime = [
      ...headers,
      `Content-Type: multipart/mixed; boundary="${boundary}"`,
      "",
      `--${boundary}`,
      ...textPart,
      `--${boundary}`,
      `Content-Type: ${opts.attachment.contentType}; name="${name}"`,
      `Content-Disposition: attachment; filename="${name}"`,
      "Content-Transfer-Encoding: base64",
      "",
      base64Lines(opts.attachment.data),
      `--${boundary}--`,
      "",
    ];
  } else {
    mime = [...headers, ...textPart];
  }

  // The media upload endpoint accepts messages up to 35 MB, so attachments aren't limited by JSON body size.
  const data = await googleFetch(user, "https://gmail.googleapis.com/upload/gmail/v1/users/me/messages/send?uploadType=media", {
    method: "POST",
    headers: { "Content-Type": "message/rfc822" },
    body: mime.join("\r\n"),
  });
  return data.id as string;
}

/** Ensures a spreadsheet exists (creating one if needed) and returns its ID. */
export async function ensureSpreadsheet(user: User) {
  if (user.spreadsheetId) return user.spreadsheetId;
  const created = await googleFetch(user, "https://sheets.googleapis.com/v4/spreadsheets", {
    method: "POST",
    body: JSON.stringify({
      properties: { title: "AutoCoffeeChat — Outreach Log" },
      sheets: [{ properties: { title: "Outreach", gridProperties: { frozenRowCount: 1 } } }],
    }),
  });
  const id = created.spreadsheetId as string;
  await googleFetch(
    user,
    `https://sheets.googleapis.com/v4/spreadsheets/${id}/values/A1:append?valueInputOption=RAW`,
    { method: "POST", body: JSON.stringify({ values: [SHEET_HEADERS] }) },
  );
  await updateUser(user.id, { spreadsheetId: id });
  user.spreadsheetId = id;
  return id;
}

export async function appendSheetRow(user: User, row: (string | null | undefined)[]) {
  const id = await ensureSpreadsheet(user);
  const base = `https://sheets.googleapis.com/v4/spreadsheets/${id}/values`;
  // Add a header row to user-supplied sheets that are still empty.
  const head = await googleFetch(user, `${base}/A1:I1`);
  if (!head.values?.length) {
    await googleFetch(user, `${base}/A1:append?valueInputOption=RAW`, {
      method: "POST",
      body: JSON.stringify({ values: [SHEET_HEADERS] }),
    });
  }
  await googleFetch(user, `${base}/A1:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`, {
    method: "POST",
    body: JSON.stringify({ values: [row.map((v) => v ?? "")] }),
  });
  return id;
}
