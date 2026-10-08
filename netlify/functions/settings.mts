import type { Config, Context } from "@netlify/functions";
import { jsonError, requireUser } from "../../lib/auth.js";
import { DEFAULT_PRIORITIES } from "../../lib/priorities.js";
import { getResume } from "../../lib/resumes.js";
import { publicSettings, updateUser } from "../../lib/settings.js";

function parseSpreadsheetId(input: unknown) {
  const value = String(input ?? "").trim();
  if (!value) return null;
  // Accept a full Google Sheets URL or a bare ID.
  const match = value.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
  return match ? match[1] : value;
}

export default async (req: Request, context: Context) => {
  const user = await requireUser(context);
  if (user instanceof Response) return user;

  try {
    if (req.method === "GET") {
      return Response.json(publicSettings(user));
    }

    if (req.method === "PUT") {
      const body = await req.json();
      const values: Parameters<typeof updateUser>[1] = {};
      if (typeof body.senderName === "string") values.senderName = body.senderName.trim();
      if (typeof body.senderBackground === "string") values.senderBackground = body.senderBackground;
      if (typeof body.emailTemplate === "string") values.emailTemplate = body.emailTemplate;
      if (typeof body.contactPriorities === "string") {
        // Saving the default unchanged (or clearing it) keeps following the default.
        const text = body.contactPriorities.trim();
        values.contactPriorities = text === DEFAULT_PRIORITIES ? "" : text;
      }
      if ("spreadsheetId" in body) values.spreadsheetId = parseSpreadsheetId(body.spreadsheetId);
      if ("defaultResumeId" in body) {
        const id = body.defaultResumeId ? Number(body.defaultResumeId) : null;
        if (id && !(await getResume(user.id, id))) return Response.json({ error: "Resume not found" }, { status: 404 });
        values.defaultResumeId = id;
      }
      return Response.json(publicSettings(await updateUser(user.id, values)));
    }

    return new Response("Method not allowed", { status: 405 });
  } catch (err) {
    return jsonError(err);
  }
};

export const config: Config = {
  path: "/api/settings",
};
