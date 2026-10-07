import type { Config, Context } from "@netlify/functions";
import { and, eq } from "drizzle-orm";
import { db } from "../../db/index.js";
import { outreach, searches } from "../../db/schema.js";
import { requireAuth } from "../../lib/auth.js";
import { findCompanyDomain, findPeople } from "../../lib/discovery.js";
import { DEFAULT_PATTERN, describePattern, getEmailPattern, predictEmail } from "../../lib/emailPattern.js";
import { rankCandidates, suggestTitles } from "../../lib/ai.js";

const CONTACTS_WANTED = 2;

/** Finds people for a search, predicts their emails from the company's pattern, and saves them as drafts. */
export default async (req: Request, context: Context) => {
  if (requireAuth(context)) return;
  const { searchId } = await req.json();
  const [search] = await db.select().from(searches).where(eq(searches.id, Number(searchId)));
  if (!search || search.status !== "pending") return;

  const progress = (text: string) => db.update(searches).set({ progress: text }).where(eq(searches.id, search.id));
  const fail = (error: string) => db.update(searches).set({ status: "failed", error, progress: null }).where(eq(searches.id, search.id));

  try {
    const { role, company } = search;

    // 1. Resolve the email domain + target titles in parallel.
    await progress(`Looking up ${company} and who to contact…`);
    const [resolved, titles] = await Promise.all([
      search.companyDomain ? Promise.resolve({ name: company, domain: search.companyDomain }) : findCompanyDomain(company),
      suggestTitles(role, company),
    ]);
    if (!resolved) return fail(`Couldn't identify "${company}". Try adding the company's website domain.`);
    await db.update(searches).set({ company: resolved.name, companyDomain: resolved.domain }).where(eq(searches.id, search.id));

    // 2. Find people and learn the company's email format in parallel.
    await progress(`Searching the web for people at ${resolved.name} and its email format…`);
    const [people, pattern] = await Promise.all([
      findPeople(resolved.name, { hiringTitles: titles.hiringTitles ?? [], peerTitles: titles.peerTitles ?? [] }),
      getEmailPattern(resolved.name, resolved.domain),
    ]);

    // Skip people we've already emailed at this company.
    const sentRows = await db
      .select({ name: outreach.name, email: outreach.email })
      .from(outreach)
      .where(and(eq(outreach.status, "sent"), eq(outreach.company, resolved.name)));
    const sentNames = new Set(sentRows.map((r) => r.name.toLowerCase()));
    const pool = people.filter((p) => !sentNames.has(p.name.toLowerCase()));
    if (!pool.length) return fail(`No people found at ${resolved.name} for this role. Try a broader role name.`);

    // 3. Let AI rank them and keep the best ones.
    await progress("Ranking the best contacts…");
    const { ranked } = await rankCandidates(role, resolved.name, pool);
    const byId = new Map(pool.map((c) => [c.id, c]));
    const ordered = [
      ...ranked.filter((r) => byId.has(r.id)),
      ...pool.filter((c) => !ranked.some((r) => r.id === c.id)).map((c) => ({ id: c.id, reason: `Found as ${c.group}` })),
    ];

    // 4. Predict each email from the learned pattern (or the most common format if none was found).
    const format = pattern.pattern ?? DEFAULT_PATTERN;
    const sentEmails = new Set(sentRows.map((r) => r.email?.toLowerCase()));
    const picked = ordered
      .map((r) => ({ ...r, person: byId.get(r.id)!, email: predictEmail(byId.get(r.id)!.name, resolved.domain, format) }))
      .filter((r) => r.email && !sentEmails.has(r.email))
      .slice(0, CONTACTS_WANTED);
    if (!picked.length) return fail("Found people but couldn't predict any email addresses.");

    const note = pattern.pattern
      ? `${describePattern(format, resolved.domain)} — matches ${pattern.matches} public example${pattern.matches === 1 ? "" : "s"}`
      : `${describePattern(format, resolved.domain)} — unverified guess, no public examples found`;

    // 5. Save the contacts as drafts (emails are written in a separate step).
    await db.insert(outreach).values(
      picked.map(({ reason, person, email }) => ({
        searchId: search.id,
        name: person.name,
        title: person.title,
        company: resolved.name,
        email,
        emailPattern: note,
        linkedinUrl: person.linkedinUrl,
        reason,
        profile: { firstName: person.name.split(" ")[0], headline: person.headline, history: [] },
      })),
    );
    await db.update(searches).set({ status: "done", progress: null }).where(eq(searches.id, search.id));
  } catch (err) {
    console.error(err);
    await fail((err as Error).message || "Search failed.");
  }
};

export const config: Config = {
  background: true,
};
