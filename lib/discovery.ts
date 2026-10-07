import { askJsonWithWeb } from "./ai.js";

export type Candidate = {
  id: string;
  name: string;
  title: string | null;
  linkedinUrl: string | null;
  headline: string | null;
  group: string;
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

/** Find real people at the company with these titles via public LinkedIn profiles in web search. */
export async function findPeople(company: string, titles: { hiringTitles: string[]; peerTitles: string[] }) {
  const result = await askJsonWithWeb<{
    people?: { name?: string; title?: string; linkedinUrl?: string; headline?: string; group?: string }[];
  }>(
    "You help job seekers find real people currently working at a company.",
    `Find people who CURRENTLY work at ${company} in these roles, using web searches of public LinkedIn profiles (e.g. site:linkedin.com/in "${company}" "Engineering Manager"). Also use the company's team pages, blog author pages, or news if helpful.

Group "hiring manager / recruiter": ${titles.hiringTitles.join(", ") || "(none)"}
Group "works in this role": ${titles.peerTitles.join(", ") || "(none)"}

Rules:
- Only include people whose current employer is ${company} according to the result, and whose full first AND last name is shown. Never invent people.
- Up to 12 people total, covering both groups if possible.
- "headline": a short summary of what the result says about them (current role, team, past experience).

Format: {"people":[{"name":"Full Name","title":"Current title","linkedinUrl":"https://www.linkedin.com/in/...","headline":"...","group":"hiring manager / recruiter" | "works in this role"}]}`,
    { searches: 6 },
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
      }),
    );
}
