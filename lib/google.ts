import { getSettings, updateSettings, type Settings } from "./settings.js";

export const GOOGLE_SCOPES = [
  "openid",
  "email",
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
];

function clientCreds() {
  const clientId = Netlify.env.get("GOOGLE_CLIENT_ID");
  const clientSecret = Netlify.env.get("GOOGLE_CLIENT_SECRET");
  if (!clientId || !clientSecret) {
    throw new Error("GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET must be set in your Netlify environment variables.");
  }
  return { clientId, clientSecret };
}

export function redirectUri(req: Request) {
  return `${new URL(req.url).origin}/api/auth/google/callback`;
}

export function buildAuthUrl(req: Request, state: string) {
  const { clientId } = clientCreds();
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri(req),
    response_type: "code",
    scope: GOOGLE_SCOPES.join(" "),
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    state,
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
  let email: string | null = null;
  if (tokens.id_token) {
    const payload = JSON.parse(Buffer.from(tokens.id_token.split(".")[1], "base64url").toString("utf8"));
    email = payload.email ?? null;
  }
  return { ...tokens, email };
}

async function getAccessToken(s?: Settings) {
  s ??= await getSettings();
  if (!s.googleRefreshToken) throw new Error("Google account is not connected. Connect it in Settings.");
  if (s.googleAccessToken && s.googleTokenExpiresAt && s.googleTokenExpiresAt.getTime() > Date.now() + 60_000) {
    return s.googleAccessToken;
  }
  const { clientId, clientSecret } = clientCreds();
  const tokens = await tokenRequest({
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: s.googleRefreshToken,
    grant_type: "refresh_token",
  });
  await updateSettings({
    googleAccessToken: tokens.access_token,
    googleTokenExpiresAt: new Date(Date.now() + tokens.expires_in * 1000),
  });
  return tokens.access_token;
}

async function googleFetch(url: string, init: RequestInit = {}) {
  const token = await getAccessToken();
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

export async function sendGmail(opts: { fromName: string; fromEmail: string; to: string; toName: string; subject: string; body: string }) {
  const from = opts.fromName ? `${encodeHeader(opts.fromName)} <${opts.fromEmail}>` : opts.fromEmail;
  const to = opts.toName ? `${encodeHeader(opts.toName)} <${opts.to}>` : opts.to;
  const mime = [
    `From: ${from}`,
    `To: ${to}`,
    `Subject: ${encodeHeader(opts.subject)}`,
    "MIME-Version: 1.0",
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: base64",
    "",
    Buffer.from(opts.body.replace(/\r?\n/g, "\r\n"), "utf8").toString("base64"),
  ].join("\r\n");
  const data = await googleFetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
    method: "POST",
    body: JSON.stringify({ raw: Buffer.from(mime, "utf8").toString("base64url") }),
  });
  return data.id as string;
}

/** Ensures a spreadsheet exists (creating one if needed) and returns its ID. */
export async function ensureSpreadsheet() {
  const s = await getSettings();
  if (s.spreadsheetId) return s.spreadsheetId;
  const created = await googleFetch("https://sheets.googleapis.com/v4/spreadsheets", {
    method: "POST",
    body: JSON.stringify({
      properties: { title: "AutoCoffeeChat — Outreach Log" },
      sheets: [{ properties: { title: "Outreach", gridProperties: { frozenRowCount: 1 } } }],
    }),
  });
  const id = created.spreadsheetId as string;
  await googleFetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${id}/values/A1:append?valueInputOption=RAW`,
    { method: "POST", body: JSON.stringify({ values: [SHEET_HEADERS] }) },
  );
  await updateSettings({ spreadsheetId: id });
  return id;
}

export async function appendSheetRow(row: (string | null | undefined)[]) {
  const id = await ensureSpreadsheet();
  const base = `https://sheets.googleapis.com/v4/spreadsheets/${id}/values`;
  // Add a header row to user-supplied sheets that are still empty.
  const head = await googleFetch(`${base}/A1:H1`);
  if (!head.values?.length) {
    await googleFetch(`${base}/A1:append?valueInputOption=RAW`, {
      method: "POST",
      body: JSON.stringify({ values: [SHEET_HEADERS] }),
    });
  }
  await googleFetch(`${base}/A1:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`, {
    method: "POST",
    body: JSON.stringify({ values: [row.map((v) => v ?? "")] }),
  });
  return id;
}
