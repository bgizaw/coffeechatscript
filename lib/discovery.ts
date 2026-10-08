import { askJsonWithWeb } from "./ai.js";

export type Candidate = {
  id: string;
  name: string;
  title: string | null;
  linkedinUrl: string | null;
  headline: string | null;
  group: string;
  // Priority markers the search spotted, e.g. "Pomona College '21", "MLT Fellow", "joined 3 months ago".
  signals: string[];
};

/** Work out the domain the company uses for employee email addresses. */
export async function findCompanyDomain(company: string) {
  const result = await askJsonWithWeb<{ name?: string; domain?: string | null }>(
    "You identify companies and the domain their employees use for work email.",
    `What domain do employees of "${company}" use for their work email (e.g. "stripe.com")? Search only if you aren't sure.
For "name", use the name the company commonly goes by (no "Inc.", "LLC", etc.). If the company can't be identified, return null for the domain.
Format: {"name":"Company Name","domain":"example.com"}`,
    { searches: 2 },
  );
  const domain = result.domain?.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0];
  return domain && domain.includes(".") ? { name: result.name || company, domain } : null;
}

/**
 * Find real people at the company with these titles via public LinkedIn profiles in web search.
 * Searches also target the user's priority markers (shared schools, programs, hometown, similar path)
 * so those people make it into the pool, and records any markers seen for each person.
 */
export async function findPeople(
  company: string,
  titles: { hiringTitles: string[]; peerTitles: string[] },
  prefs: { priorities: string; background: string },
) {
  const result = await askJsonWithWeb<{
    people?: { name?: string; title?: string; linkedinUrl?: string; headline?: string; group?: string; signals?: string[] }[];
  }>(
    "You help job seekers find real people currently working at a company who are most likely to reply to them.",
    `Find people who CURRENTLY work at ${company} in these roles, using web searches of public LinkedIn profiles (e.g. site:linkedin.com/in "${company}" "Engineering Manager"). Also use the company's team pages, blog author pages, talks, or news if helpful.

Group "hiring manager / recruiter": ${titles.hiringTitles.join(", ") || "(none)"}
Group "works in this role": ${titles.peerTitles.join(", ") || "(none)"}

The job seeker ranks contacts by this tiered priority list (Tier 1 matters most):
"""
${prefs.priorities}
"""

About the job seeker:
"""
${prefs.background || "(not provided)"}
"""

Search strategy:
- Spend at least half of your searches on the Tier 1 and Tier 2 markers — combine ${company} with the specific schools, programs, networks, and hometown/region named above (e.g. site:linkedin.com/in "${company}" "Pomona College"). People in the target roles or adjacent teams who match these are the most valuable finds.
- Use the remaining searches for the role titles above.

Rules:
- Only include people whose current employer is ${company} according to the result, and whose full first AND last name is shown. Never invent people or markers.
- Skip team inboxes, company-wide aliases, and anyone without a real personal name.
- Up to 15 people total, covering both groups if possible.
- "headline": a short summary of what the result says about them (current role, team, seniority, past experience, education).
- "signals": every priority marker the results actually show for them, short and specific (e.g. "Pomona College '21", "MLT Career Prep Fellow", "From Houston, TX", "Graduated 2022", "Joined ${company} 2026", "Posts on LinkedIn weekly", "ADPList mentor", "Moved from SWE to fashion-tech", "VP"). Use [] if none are shown.

Format: {"people":[{"name":"Full Name","title":"Current title","linkedinUrl":"https://www.linkedin.com/in/...","headline":"...","group":"hiring manager / recruiter" | "works in this role","signals":["..."]}]}`,
    { searches: 10 },
  );

  const seen = new Set<string>();
  return (result.people ?? [])
    .filter((p) => p.name && p.name.trim().split(/\s+/).length >= 2)
    .filter((p) => {
      const key = p.name!.trim().toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map(
      (p, i): Candidate => ({
        id: `p${i + 1}`,
        name: p.name!.trim(),
        title: p.title?.trim() || null,
        linkedinUrl: p.linkedinUrl?.startsWith("https://") ? p.linkedinUrl : null,
        headline: p.headline?.trim() || null,
        group: p.group === "works in this role" ? "works in this role" : "hiring manager / recruiter",
        signals: Array.isArray(p.signals) ? p.signals.filter((x) => typeof x === "string" && x.trim()).map((x) => x.trim()) : [],
      }),
    );
}
