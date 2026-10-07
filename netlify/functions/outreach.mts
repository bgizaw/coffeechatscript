import type { Config, Context } from "@netlify/functions";
import { desc, eq } from "drizzle-orm";
import { db } from "../../db/index.js";
import { outreach, searches } from "../../db/schema.js";
import { jsonError, requireAuth } from "../../lib/auth.js";
import { writeEmail } from "../../lib/ai.js";
import { appendSheetRow, sendGmail } from "../../lib/google.js";
import { getSettings } from "../../lib/settings.js";

async function loadRow(id: number) {
  const [row] = await db
    .select({ outreach, search: searches })
    .from(outreach)
    .innerJoin(searches, eq(outreach.searchId, searches.id))
    .where(eq(outreach.id, id));
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
  const denied = requireAuth(context);
  if (denied) return denied;

  const [, , , idPart, action] = new URL(req.url).pathname.split("/"); // /api/outreach/:id/:action
  const id = idPart ? Number(idPart) : null;

  try {
    // List history
    if (!id && req.method === "GET") {
      const rows = await db
        .select({ outreach, search: searches })
        .from(outreach)
        .innerJoin(searches, eq(outreach.searchId, searches.id))
        .orderBy(desc(outreach.createdAt))
        .limit(200);
      return Response.json(rows.map((r) => ({ ...r.outreach, role: r.search.role })));
    }

    if (!id || Number.isNaN(id)) return new Response("Not found", { status: 404 });
    const row = await loadRow(id);
    if (!row) return Response.json({ error: "Not found" }, { status: 404 });

    // Edit a draft
    if (!action && req.method === "PUT") {
      if (row.outreach.status === "sent") return Response.json({ error: "Already sent" }, { status: 400 });
      const body = await req.json();
      const [updated] = await db
        .update(outreach)
        .set({
          ...(typeof body.subject === "string" ? { subject: body.subject } : {}),
          ...(typeof body.body === "string" ? { body: body.body } : {}),
          ...(typeof body.email === "string" ? { email: body.email.trim() } : {}),
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
      const s = await getSettings();
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

      const s = await getSettings();
      if (!s.googleRefreshToken || !s.googleEmail) {
        return Response.json({ error: "Connect your Google account in Settings first." }, { status: 400 });
      }

      let messageId: string;
      try {
        messageId = await sendGmail({
          fromName: s.senderName,
          fromEmail: s.googleEmail,
          to: o.email,
          toName: o.name,
          subject: o.subject,
          body: o.body,
        });
      } catch (err) {
        await db.update(outreach).set({ status: "failed", error: (err as Error).message }).where(eq(outreach.id, id));
        throw err;
      }

      const sentAt = new Date();
      await db
        .update(outreach)
        .set({ status: "sent", sentAt, gmailMessageId: messageId, error: null })
        .where(eq(outreach.id, id));

      let sheetError: string | null = null;
      try {
        await appendSheetRow([
          formatTime(sentAt, timeZone),
          o.name,
          o.company,
          o.title,
          o.email,
          row.search.role,
          o.subject,
          o.linkedinUrl,
        ]);
        await db.update(outreach).set({ sheetLogged: 1 }).where(eq(outreach.id, id));
      } catch (err) {
        sheetError = (err as Error).message;
        await db.update(outreach).set({ error: `Sent, but sheet logging failed: ${sheetError}` }).where(eq(outreach.id, id));
      }

      const updated = await loadRow(id);
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
