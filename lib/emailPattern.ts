import { eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { emailPatterns } from "../db/schema.js";
import { askJsonWithWeb } from "./ai.js";

export type EmailExample = { email: string; name: string; sourceUrl: string | null };
export type EmailPattern = typeof emailPatterns.$inferSelect;

// Formats in rough order of how common they are; earlier wins ties.
const FORMATS: Record<string, (f: string, l: string) => string> = {
  "first.last": (f, l) => `${f}.${l}`,
  flast: (f, l) => `${f[0]}${l}`,
  first: (f) => f,
  firstlast: (f, l) => `${f}${l}`,
  "f.last": (f, l) => `${f[0]}.${l}`,
  first_last: (f, l) => `${f}_${l}`,
  "first-last": (f, l) => `${f}-${l}`,
  firstl: (f, l) => `${f}${l[0]}`,
  "first.l": (f, l) => `${f}.${l[0]}`,
  "last.first": (f, l) => `${l}.${f}`,
  lastfirst: (f, l) => `${l}${f}`,
  lastf: (f, l) => `${l}${f[0]}`,
  last: (_f, l) => l,
};
export const DEFAULT_PATTERN = "first.last";

const FOUND_TTL_DAYS = 90;
const NOT_FOUND_TTL_DAYS = 7;
const SUFFIXES = new Set(["jr", "sr", "ii", "iii", "iv", "phd", "md", "mba", "cpa", "pe", "esq"]);
const PREFIXES = new Set(["dr", "mr", "mrs", "ms", "mx", "prof", "sir"]);
const GENERIC = /^(info|contact|hello|hi|support|help|press|media|pr|news|sales|admin|office|team|careers|jobs|recruiting|hr|privacy|legal|security|abuse|billing|accounts?|marketing|partners?|investors?|ir|webmaster|noreply|no-reply|feedback|service|events?)$/;

function clean(part: string) {
  return part.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z]/g, "");
}

/** Split a display name into the first and last name parts used in email addresses. */
export function nameParts(fullName: string) {
  const parts = fullName
    .replace(/\(.*?\)|".*?"/g, " ")
    .split(/[\s,]+/)
    .map(clean)
    .filter((p) => p && !SUFFIXES.has(p));
  while (parts.length > 2 && PREFIXES.has(parts[0])) parts.shift();
  if (parts.length < 2) return null;
  return { first: parts[0], last: parts[parts.length - 1] };
}

function formatsMatching(example: EmailExample) {
  const names = nameParts(example.name);
  if (!names) return [];
  const local = example.email.split("@")[0].toLowerCase();
  return Object.entries(FORMATS)
    .filter(([, make]) => make(names.first, names.last) === local)
    .map(([key]) => key);
}

/** Pick the format that explains the most examples. */
export function inferPattern(examples: EmailExample[]) {
  const counts = new Map<string, number>();
  for (const ex of examples) for (const key of formatsMatching(ex)) counts.set(key, (counts.get(key) ?? 0) + 1);
  const order = Object.keys(FORMATS);
  const [best] = [...counts.entries()].sort((a, b) => b[1] - a[1] || order.indexOf(a[0]) - order.indexOf(b[0]));
  return best ? { pattern: best[0], matches: best[1] } : null;
}

export function predictEmail(fullName: string, domain: string, pattern: string) {
  const names = nameParts(fullName);
  const make = FORMATS[pattern];
  if (!names || !make) return null;
  return `${make(names.first, names.last)}@${domain}`;
}

/** Example rendering of a pattern for display, e.g. "jane.doe@acme.com". */
export function describePattern(pattern: string, domain: string) {
  return predictEmail("Jane Doe", domain, pattern) ?? pattern;
}

/** Ask Claude to scour the public web (PDFs, press releases, papers…) for real addresses at this domain. */
export async function findEmailExamples(company: string, domain: string): Promise<EmailExample[]> {
  const result = await askJsonWithWeb<{ examples?: { email?: string; name?: string; sourceUrl?: string }[] }>(
    "You research publicly posted work email addresses so a job seeker can learn a company's email format.",
    `Find real, publicly posted email addresses of individual employees at ${company} that end in exactly "@${domain}", along with the full name of the person each address belongs to.

Search strategy — try these searches in order and stop once you have 3 solid examples:
1. "@${domain}" -site:${domain} filetype:pdf
2. "@${domain}" -site:${domain}
3. "@${domain}" "${company}" (press release OR conference OR paper OR presentation OR contact)
Open the most promising results (PDFs, press releases, conference programs, research papers, filings) with web_fetch to read the actual addresses next to people's names.

Rules:
- Only include addresses you literally saw on a page, paired with the person's full name as written there. Never guess or construct an address.
- Skip shared inboxes (press@, info@, careers@, support@, etc.) and addresses on other domains or subdomains.
- Up to 6 examples.

Format: {"examples":[{"email":"...","name":"Full Name","sourceUrl":"https://..."}]}`,
    { searches: 5, fetches: 4 },
  );

  const seen = new Set<string>();
  return (result.examples ?? [])
    .map((e) => ({ email: String(e.email ?? "").trim().toLowerCase(), name: String(e.name ?? "").trim(), sourceUrl: e.sourceUrl ? String(e.sourceUrl) : null }))
    .filter((e) => {
      const [local, host] = e.email.split("@");
      if (host !== domain || !local || !/^[a-z0-9._%+-]+$/.test(local) || GENERIC.test(local) || !e.name) return false;
      if (seen.has(e.email)) return false;
      seen.add(e.email);
      return true;
    });
}

function isFresh(row: EmailPattern) {
  const ttl = (row.pattern ? FOUND_TTL_DAYS : NOT_FOUND_TTL_DAYS) * 86_400_000;
  return row.checkedAt != null && Date.now() - row.checkedAt.getTime() < ttl;
}

/** Return the company's email format, discovering and saving it the first time a domain is seen. */
export async function getEmailPattern(company: string, domain: string): Promise<EmailPattern> {
  const [cached] = await db.select().from(emailPatterns).where(eq(emailPatterns.domain, domain));
  if (cached && isFresh(cached)) return cached;

  let examples: EmailExample[] = [];
  try {
    examples = await findEmailExamples(company, domain);
  } catch (err) {
    console.error(`Email example search failed for ${domain}: ${(err as Error).message}`);
    if (cached) return cached;
  }
  const inferred = inferPattern(examples);
  // Keep a previously learned pattern if this round turned up nothing better.
  const keepOld = !inferred && cached?.pattern;
  const values = {
    domain,
    company,
    pattern: keepOld ? cached!.pattern : (inferred?.pattern ?? null),
    matches: keepOld ? cached!.matches : (inferred?.matches ?? 0),
    examples: keepOld ? cached!.examples : examples,
    checkedAt: new Date(),
  };
  const [row] = await db
    .insert(emailPatterns)
    .values(values)
    .onConflictDoUpdate({ target: emailPatterns.domain, set: values })
    .returning();
  return row;
}
