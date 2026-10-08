import type { Config, Context } from "@netlify/functions";
import { and, desc, eq } from "drizzle-orm";
import { db } from "../../db/index.js";
import { outreach, searches } from "../../db/schema.js";
import { jsonError, requireUser, type User } from "../../lib/auth.js";
import { writeEmail } from "../../lib/ai.js";
import { appendSheetRow, sendGmail, type Attachment } from "../../lib/google.js";
import { getResume, readResumeFile } from "../../lib/resumes.js";

async function loadRow(user: User, id: number) {
  const [row] = await db
    .select({ outreach, search: searches })
    .from(outreach)
    .innerJoin(searches, eq(outreach.searchId, searches.id))
    .where(and(eq(outreach.id, id), eq(searches.userId, user.id)));
  return row;
}

function formatTime(date: Date, timeZone?: string) {
  try {
    return date.toLocaleString("en-US", { timeZone: timeZone || "UTC", dateStyle: "medium", timeStyle: "short" });
  } catch {
    return date.toISOString();
  }
}

export default async (req: Request, context: Context) => {
  const user = await requireUser(context);
  if (user instanceof Response) return user;

  const [, , , idPart, action] = new URL(req.url).pathname.split("/"); // /api/outreach/:id/:action
  const id = idPart ? Number(idPart) : null;

  try {
    // List history
    if (!id && req.method === "GET") {
      const rows = await db
        .select({ outreach, search: searches })
        .from(outreach)
        .innerJoin(searches, eq(outreach.searchId, searches.id))
        .where(eq(searches.userId, user.id))
        .orderBy(desc(outreach.createdAt))
        .limit(200);
      return Response.json(rows.map((r) => ({ ...r.outreach, role: r.search.role })));
    }

    if (!id || Number.isNaN(id)) return new Response("Not found", { status: 404 });
    const row = await loadRow(user, id);
    if (!row) return Response.json({ error: "Not found" }, { status: 404 });

    // Edit a draft
    if (!action && req.method === "PUT") {
      if (row.outreach.status === "sent") return Response.json({ error: "Already sent" }, { status: 400 });
      const body = await req.json();
      let resumeId: number | null | undefined;
      if ("resumeId" in body) {
        resumeId = body.resumeId ? Number(body.resumeId) : null;
        if (resumeId && !(await getResume(user.id, resumeId))) return Response.json({ error: "Resume not found" }, { status: 404 });
      }
      const [updated] = await db
        .update(outreach)
        .set({
          ...(typeof body.subject === "string" ? { subject: body.subject } : {}),
          ...(typeof body.body === "string" ? { body: body.body } : {}),
          ...(typeof body.email === "string" ? { email: body.email.trim() } : {}),
          ...(resumeId !== undefined ? { resumeId } : {}),
        })
        .where(eq(outreach.id, id))
        .returning();
      return Response.json(updated);
    }

    // Discard a draft
    if (!action && req.method === "DELETE") {
      if (row.outreach.status === "sent") return Response.json({ error: "Already sent" }, { status: 400 });
      await db.delete(outreach).where(eq(outreach.id, id));
      return Response.json({ ok: true });
    }

    // (Re)generate the AI draft
    if (action === "draft" && req.method === "POST") {
      const s = user;
      const person = row.outreach.profile as { firstName?: string; headline?: string | null; history?: unknown } | null;
      const draft = await writeEmail({
        role: row.search.role,
        company: row.outreach.company,
        senderName: s.senderName,
        senderBackground: s.senderBackground,
        template: s.emailTemplate,
        recipient: {
          name: row.outreach.name,
          firstName: person?.firstName || row.outreach.name.split(" ")[0],
          title: row.outreach.title,
          headline: person?.headline ?? null,
          reason: row.outreach.reason,
          history: person?.history ?? [],
        },
      });
      const [updated] = await db
        .update(outreach)
        .set({ subject: draft.subject, body: draft.body, status: "draft", error: null })
        .where(eq(outreach.id, id))
        .returning();
      return Response.json(updated);
    }

    // Send via Gmail, then log to Google Sheets
    if (action === "send" && req.method === "POST") {
      const { timeZone } = await req.json().catch(() => ({}));
      const o = row.outreach;
      if (o.status === "sent") return Response.json({ error: "Already sent" }, { status: 400 });
      if (!o.email) return Response.json({ error: "This contact has no email address." }, { status: 400 });
      if (!o.subject.trim() || !o.body.trim()) return Response.json({ error: "Subject and body are required." }, { status: 400 });

      if (!user.googleRefreshToken) {
        return Response.json({ error: "Google access has expired. Sign out and sign back in with Google." }, { status: 400 });
      }

      let attachment: Attachment | null = null;
      if (o.resumeId) {
        const resume = await getResume(user.id, o.resumeId);
        const data = resume && (await readResumeFile(resume));
        if (!resume || !data) {
          return Response.json({ error: "The selected resume couldn't be found. Pick another or choose no resume." }, { status: 400 });
        }
        attachment = { filename: resume.filename, contentType: resume.contentType, data };
      }

      let messageId: string;
      try {
        messageId = await sendGmail(user, {
          fromName: user.senderName,
          to: o.email,
          toName: o.name,
          subject: o.subject,
          body: o.body,
          attachment,
        });
      } catch (err) {
        await db.update(outreach).set({ status: "failed", error: (err as Error).message }).where(eq(outreach.id, id));
        throw err;
      }

      const sentAt = new Date();
      await db
        .update(outreach)
        .set({ status: "sent", sentAt, gmailMessageId: messageId, error: null, attachedResume: attachment?.filename ?? null })
        .where(eq(outreach.id, id));

      let sheetError: string | null = null;
      try {
        await appendSheetRow(user, [
          formatTime(sentAt, timeZone),
          o.name,
          o.company,
          o.title,
          o.email,
          row.search.role,
          o.subject,
          o.linkedinUrl,
          attachment?.filename ?? "",
        ]);
        await db.update(outreach).set({ sheetLogged: 1 }).where(eq(outreach.id, id));
      } catch (err) {
        sheetError = (err as Error).message;
        await db.update(outreach).set({ error: `Sent, but sheet logging failed: ${sheetError}` }).where(eq(outreach.id, id));
      }

      const updated = await loadRow(user, id);
      return Response.json({ ...updated.outreach, sheetError });
    }

    return new Response("Not found", { status: 404 });
  } catch (err) {
    return jsonError(err);
  }
};

export const config: Config = {
  path: ["/api/outreach", "/api/outreach/:id", "/api/outreach/:id/:action"],
};
