import type { Config, Context } from "@netlify/functions";
import { and, eq } from "drizzle-orm";
import { db } from "../../db/index.js";
import { outreach, searches } from "../../db/schema.js";
import { currentUser } from "../../lib/auth.js";
import { findCompanyDomain, findPeople } from "../../lib/discovery.js";
import { DEFAULT_PATTERN, describePattern, getEmailPattern, patternsOf, predictEmail, type PatternStat } from "../../lib/emailPattern.js";
import { rankCandidates, suggestTitles, type RankedContact } from "../../lib/ai.js";
import { priorityList } from "../../lib/priorities.js";

const CONTACTS_WANTED = 2;
// The hiring manager is the most valuable but least likely to reply, so keep them to one of the picks.
const MAX_HIRING_MANAGERS = 1;
// Team inboxes and company-wide aliases aren't people to coffee-chat with.
const ALIAS_NAME = /\b(team|careers|jobs|recruiting|talent|hr|info|support|hello|contact)\b/i;

/** How the address was predicted and how much to trust it, shown on the draft. */
function patternNote(format: string, domain: string, patterns: PatternStat[]) {
  const used = patterns.find((p) => p.pattern === format);
  const shown = describePattern(format, domain);
  if (!used) return `${shown} — unverified guess, no public examples found`;
  const pct = `${Math.round(used.confidence * 100)}% confidence`;
  const examples = `${used.examples} example${used.examples === 1 ? "" : "s"}${used.sources.length ? ` from ${used.sources.join(", ")}` : ""}`;
  const feedback = [used.replies && `${used.replies} repl${used.replies === 1 ? "y" : "ies"}`, used.bounces && `${used.bounces} bounce${used.bounces === 1 ? "" : "s"}`]
    .filter(Boolean)
    .join(", ");
  const trust = used.trusted ? "" : " · needs a 2nd independent example to trust";
  const others = patterns.filter((p) => p.pattern !== format && p.examples >= 2).slice(0, 2);
  const also = others.length ? ` · also used here: ${others.map((p) => `${describePattern(p.pattern, domain)} (${p.examples})`).join(", ")}` : "";
  return `${shown} — ${pct} · ${examples}${feedback ? ` · ${feedback}` : ""}${trust}${also}`;
}

/** Finds people for a search, predicts their emails from the company's pattern, and saves them as drafts. */
export default async (req: Request, context: Context) => {
  const user = await currentUser(context);
  if (!user) return;
  const { searchId } = await req.json();
  const [search] = await db
    .select()
    .from(searches)
    .where(and(eq(searches.id, Number(searchId)), eq(searches.userId, user.id)));
  if (!search || search.status !== "pending") return;

  const progress = (text: string) => db.update(searches).set({ progress: text }).where(eq(searches.id, search.id));
  const fail = (error: string) => db.update(searches).set({ status: "failed", error, progress: null }).where(eq(searches.id, search.id));

  try {
    const { role, company } = search;
    const prefs = { priorities: priorityList(user.contactPriorities), background: user.senderBackground };

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
      findPeople(resolved.name, { hiringTitles: titles.hiringTitles ?? [], peerTitles: titles.peerTitles ?? [] }, prefs),
      getEmailPattern(resolved.name, resolved.domain),
    ]);

    // Skip people this user has already emailed at this company.
    const sentRows = await db
      .select({ name: outreach.name, email: outreach.email })
      .from(outreach)
      .innerJoin(searches, eq(outreach.searchId, searches.id))
      .where(and(eq(searches.userId, user.id), eq(outreach.status, "sent"), eq(outreach.company, resolved.name)));
    const sentNames = new Set(sentRows.map((r) => r.name.toLowerCase()));
    const pool = people.filter((p) => !sentNames.has(p.name.toLowerCase()) && !ALIAS_NAME.test(p.name));
    if (!pool.length) return fail(`No people found at ${resolved.name} for this role. Try a broader role name.`);

    // 3. Let AI rank them against the priority tiers and keep the best ones.
    await progress("Ranking contacts by your priority tiers…");
    const { ranked } = await rankCandidates(role, resolved.name, pool, { ...prefs, emailVerified: Boolean(patternsOf(pattern)[0]?.trusted) });
    const byId = new Map(pool.map((c) => [c.id, c]));
    const tierOf = (r: RankedContact) => (Number.isInteger(r.tier) && r.tier >= 1 ? Math.min(r.tier, 5) : 5);
    const ordered: RankedContact[] = [
      // Stable sort keeps the AI's order within a tier.
      ...ranked.filter((r) => byId.has(r.id)).sort((a, b) => tierOf(a) - tierOf(b)),
      ...pool
        .filter((c) => !ranked.some((r) => r.id === c.id))
        .map((c): RankedContact => ({ id: c.id, tier: 5, kind: "other", markers: [], reason: `Found as ${c.group}` })),
    ];

    // 4. Predict each email from the best learned pattern that fits the name (or the most common format if none was found).
    const known = patternsOf(pattern);
    const formats = [...known.map((p) => p.pattern), DEFAULT_PATTERN];
    const predict = (name: string) => {
      for (const format of formats) {
        const email = predictEmail(name, resolved.domain, format);
        if (email) return { email, format };
      }
      return { email: null, format: DEFAULT_PATTERN };
    };
    const sentEmails = new Set(sentRows.map((r) => r.email?.toLowerCase()));
    const seenIds = new Set<string>();
    let hiringManagers = 0;
    const picked = ordered
      .filter((r) => !seenIds.has(r.id) && seenIds.add(r.id))
      .map((r) => ({ ...r, person: byId.get(r.id)!, ...predict(byId.get(r.id)!.name) }))
      .filter((r) => r.email && !sentEmails.has(r.email))
      .filter((r) => r.kind !== "hiring_manager" || ++hiringManagers <= MAX_HIRING_MANAGERS)
      .slice(0, CONTACTS_WANTED);
    if (!picked.length) return fail("Found people but couldn't predict any email addresses.");

    // 5. Save the contacts as drafts (emails are written in a separate step).
    await db.insert(outreach).values(
      picked.map(({ reason, person, email, format, tier, markers }) => ({
        searchId: search.id,
        name: person.name,
        title: person.title,
        company: resolved.name,
        email,
        emailPattern: patternNote(format, resolved.domain, known),
        linkedinUrl: person.linkedinUrl,
        reason: `${tier <= 4 ? `Tier ${tier}` : "No priority match"}${markers?.length ? ` · ${markers.join(", ")}` : ""} — ${reason}`,
        resumeId: user.defaultResumeId,
        profile: { firstName: person.name.split(" ")[0], headline: person.headline, history: [], signals: person.signals, tier, markers },
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
