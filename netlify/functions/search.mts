import type { Config, Context } from "@netlify/functions";
import { and, eq } from "drizzle-orm";
import { db } from "../../db/index.js";
import { outreach, searches } from "../../db/schema.js";
import { jsonError, requireUser } from "../../lib/auth.js";

function cleanDomain(input: string) {
  return input.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0];
}

export default async (req: Request, context: Context) => {
  const user = await requireUser(context);
  if (user instanceof Response) return user;

  try {
    // Poll a running search.
    if (req.method === "GET" && context.params.id) {
      const id = Number(context.params.id);
      const [search] = Number.isNaN(id) ? [] : await db.select().from(searches).where(and(eq(searches.id, id), eq(searches.userId, user.id)));
      if (!search) return Response.json({ error: "Not found" }, { status: 404 });
      const contacts = search.status === "done" ? await db.select().from(outreach).where(eq(outreach.searchId, id)) : [];
      return Response.json({ search, contacts });
    }

    if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });

    const body = await req.json();
    const role = String(body.role ?? "").trim();
    const company = String(body.company ?? "").trim();
    if (!role || !company) return Response.json({ error: "Role and company are required." }, { status: 400 });
    const domain = body.domain ? cleanDomain(String(body.domain)) : null;

    // Web research takes a minute or two, so it runs in a background function and the page polls.
    const [search] = await db
      .insert(searches)
      .values({ userId: user.id, role, company, companyDomain: domain, status: "pending", progress: "Starting…" })
      .returning();

    const res = await fetch(new URL("/.netlify/functions/search-worker", req.url), {
      method: "POST",
      headers: { "Content-Type": "application/json", cookie: req.headers.get("cookie") ?? "" },
      body: JSON.stringify({ searchId: search.id }),
    });
    if (!res.ok) {
      await db.update(searches).set({ status: "failed", error: "Couldn't start the search." }).where(eq(searches.id, search.id));
      return Response.json({ error: `Couldn't start the search (${res.status}).` }, { status: 502 });
    }

    return Response.json({ search }, { status: 202 });
  } catch (err) {
    return jsonError(err);
  }
};

export const config: Config = {
  path: ["/api/search", "/api/search/:id"],
};
