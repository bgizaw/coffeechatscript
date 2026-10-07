import type { Config, Context } from "@netlify/functions";
import { jsonError, requireAuth } from "../../lib/auth.js";
import { getSettings, publicSettings, updateSettings } from "../../lib/settings.js";

function parseSpreadsheetId(input: unknown) {
  const value = String(input ?? "").trim();
  if (!value) return null;
  // Accept a full Google Sheets URL or a bare ID.
  const match = value.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
  return match ? match[1] : value;
}

export default async (req: Request, context: Context) => {
  const denied = requireAuth(context);
  if (denied) return denied;

  try {
    if (req.method === "GET") {
      return Response.json(publicSettings(await getSettings()));
    }

    if (req.method === "PUT") {
      const body = await req.json();
      const values: Parameters<typeof updateSettings>[0] = {};
      if (typeof body.senderName === "string") values.senderName = body.senderName.trim();
      if (typeof body.senderBackground === "string") values.senderBackground = body.senderBackground;
      if (typeof body.emailTemplate === "string") values.emailTemplate = body.emailTemplate;
      if ("spreadsheetId" in body) values.spreadsheetId = parseSpreadsheetId(body.spreadsheetId);
      return Response.json(publicSettings(await updateSettings(values)));
    }

    return new Response("Method not allowed", { status: 405 });
  } catch (err) {
    return jsonError(err);
  }
};

export const config: Config = {
  path: "/api/settings",
};
