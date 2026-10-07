import type { Config, Context } from "@netlify/functions";
import { and, eq, isNotNull } from "drizzle-orm";
import { db } from "../../db/index.js";
import { outreach, searches } from "../../db/schema.js";
import { jsonError, requireAuth } from "../../lib/auth.js";
import { enrichPerson, findCompanyDomain, searchPeople, type Candidate } from "../../lib/apollo.js";
import { rankCandidates, suggestTitles } from "../../lib/ai.js";

const CONTACTS_WANTED = 2;

function cleanDomain(input: string) {
  return input.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0];
}

export default async (req: Request, context: Context) => {
  const denied = requireAuth(context);
  if (denied) return denied;
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });

  try {
    const body = await req.json();
    const role = String(body.role ?? "").trim();
    const company = String(body.company ?? "").trim();
    if (!role || !company) return Response.json({ error: "Role and company are required." }, { status: 400 });

    // 1. Resolve company domain + target titles in parallel.
    const [resolved, titles] = await Promise.all([
      body.domain ? Promise.resolve({ name: company, domain: cleanDomain(String(body.domain)) }) : findCompanyDomain(company),
      suggestTitles(role, company),
    ]);
    if (!resolved) {
      return Response.json(
        { error: `Couldn't find "${company}" on Apollo. Try adding the company's website domain.` },
        { status: 404 },
      );
    }

    // 2. Find candidates (Apollo people search is free; it only returns first names + titles).
    const [hiring, peers] = await Promise.all([
      searchPeople(resolved.domain, titles.hiringTitles ?? [], "hiring manager / recruiter"),
      searchPeople(resolved.domain, titles.peerTitles ?? [], "works in this role"),
    ]);

    // Skip people we've already emailed.
    const alreadyContacted = new Set(
      (
        await db
          .select({ apolloId: outreach.apolloId })
          .from(outreach)
          .where(and(eq(outreach.status, "sent"), isNotNull(outreach.apolloId)))
      ).map((r) => r.apolloId),
    );
    const seen = new Set<string>();
    const pool: Candidate[] = [...hiring, ...peers].filter((c) => {
      if (!c.hasEmail || seen.has(c.id) || alreadyContacted.has(c.id)) return false;
      seen.add(c.id);
      return true;
    });
    if (!pool.length) {
      return Response.json(
        { error: `No contacts with emails found at ${resolved.domain} for this role. Try a broader role name.` },
        { status: 404 },
      );
    }

    // 3. Let AI rank them, then reveal emails until we have enough.
    const { ranked } = await rankCandidates(role, company, pool);
    const byId = new Map(pool.map((c) => [c.id, c]));
    const ordered = [
      ...ranked.filter((r) => byId.has(r.id)),
      ...pool.filter((c) => !ranked.some((r) => r.id === c.id)).map((c) => ({ id: c.id, reason: `Found as ${c.group}` })),
    ];

    const picked: { id: string; reason: string; person: NonNullable<Awaited<ReturnType<typeof enrichPerson>>> }[] = [];
    for (let i = 0; i < ordered.length && picked.length < CONTACTS_WANTED && i < 8; i += 2) {
      const batch = ordered.slice(i, i + 2);
      const enriched = await Promise.all(batch.map((r) => enrichPerson(r.id).catch(() => null)));
      enriched.forEach((person, idx) => {
        if (person?.email && picked.length < CONTACTS_WANTED) picked.push({ ...batch[idx], person });
      });
    }
    if (!picked.length) {
      return Response.json({ error: "Found candidates but couldn't reveal any email addresses." }, { status: 404 });
    }

    // 4. Save the search and contacts as drafts (emails are written in a separate step).
    const [search] = await db
      .insert(searches)
      .values({ role, company: resolved.name || company, companyDomain: resolved.domain })
      .returning();
    const rows = await db
      .insert(outreach)
      .values(
        picked.map(({ id, reason, person }) => ({
          searchId: search.id,
          apolloId: id,
          name: person.name,
          title: person.title,
          company: person.company || resolved.name || company,
          email: person.email,
          linkedinUrl: person.linkedinUrl,
          reason,
          profile: { firstName: person.firstName, headline: person.headline, history: person.employmentHistory },
        })),
      )
      .returning();

    return Response.json({ search, contacts: rows });
  } catch (err) {
    return jsonError(err);
  }
};

export const config: Config = {
  path: "/api/search",
};
