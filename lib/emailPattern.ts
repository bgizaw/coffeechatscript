import { and, eq, inArray } from "drizzle-orm";
import { db } from "../db/index.js";
import { emailEvidence, emailPatterns } from "../db/schema.js";
import { isRoleAddress, mineStructuredSources, searchWebForEmails, type Hit } from "./emailSources.js";

export type EmailPattern = typeof emailPatterns.$inferSelect;
type Evidence = typeof emailEvidence.$inferSelect;
export type PatternStat = {
  pattern: string;
  // Net weighted votes: public examples count 1 (a bit more when several sources agree), replies 2, bounces −1.5.
  votes: number;
  // Distinct people whose real address fits this format.
  examples: number;
  sources: string[];
  replies: number;
  bounces: number;
  confidence: number;
  // At least two independent examples and confidence of 50%+.
  trusted: boolean;
};
export type ExampleSummary = { email: string; name: string; sourceUrl: string | null; sources: string[]; formats: string[] };

type Name = { first: string; last: string; middle: string };
// Formats in rough order of how common they are; earlier wins ties.
const FORMATS: Record<string, (n: Name) => string | null> = {
  "first.last": (n) => `${n.first}.${n.last}`,
  flast: (n) => `${n.first[0]}${n.last}`,
  first: (n) => n.first,
  firstlast: (n) => `${n.first}${n.last}`,
  "f.last": (n) => `${n.first[0]}.${n.last}`,
  first_last: (n) => `${n.first}_${n.last}`,
  "first-last": (n) => `${n.first}-${n.last}`,
  firstl: (n) => `${n.first}${n.last[0]}`,
  "first.l": (n) => `${n.first}.${n.last[0]}`,
  "last.first": (n) => `${n.last}.${n.first}`,
  lastfirst: (n) => `${n.last}${n.first}`,
  lastf: (n) => `${n.last}${n.first[0]}`,
  last: (n) => n.last,
  fmlast: (n) => (n.middle ? `${n.first[0]}${n.middle[0]}${n.last}` : null),
  "first.m.last": (n) => (n.middle ? `${n.first}.${n.middle[0]}.${n.last}` : null),
  fml: (n) => (n.middle ? `${n.first[0]}${n.middle[0]}${n.last[0]}` : null),
};
export const DEFAULT_PATTERN = "first.last";

const TTL_DAYS = { trusted: 90, tentative: 30, none: 7 };
const WEIGHT = { reply: 2, bounce: 1.5, extraSource: 0.25, unmatched: 0.25 };
const MIN_EXAMPLES = 2;
// Below this many independent examples after mining structured sources, also run the (slower) AI web search.
const WEB_SEARCH_BELOW = 3;

const SUFFIXES = new Set(["jr", "sr", "ii", "iii", "iv", "v", "phd", "md", "mba", "cpa", "pe", "esq", "dds", "rn", "cfa", "pmp"]);
const PREFIXES = new Set(["dr", "mr", "mrs", "ms", "mx", "prof", "sir", "dame"]);
const PARTICLES = new Set(["van", "von", "der", "den", "de", "del", "della", "la", "le", "du", "da", "di", "dos", "das", "ten", "ter", "bin", "binti", "al", "el", "st", "mac"]);

// Nickname groups: any name in a group may appear in place of any other (Mike ↔ Michael).
const NICKNAME_GROUPS = [
  ["michael", "mike", "mikey", "mick", "mickey"], ["william", "will", "bill", "billy", "liam", "willy"], ["robert", "rob", "bob", "bobby", "robbie", "bert"],
  ["richard", "rick", "rich", "dick", "ricky"], ["james", "jim", "jimmy", "jamie"], ["john", "jack", "johnny", "jon"], ["jonathan", "jon", "johnny", "nathan"],
  ["joseph", "joe", "joey"], ["thomas", "tom", "tommy"], ["charles", "charlie", "chuck", "chas"], ["christopher", "chris", "topher", "kit"],
  ["daniel", "dan", "danny"], ["matthew", "matt", "matty"], ["anthony", "tony"], ["andrew", "andy", "drew"], ["joshua", "josh"], ["nicholas", "nick", "nicky", "nico"],
  ["benjamin", "ben", "benji", "benny"], ["samuel", "sam", "sammy"], ["samantha", "sam", "sammy"], ["alexander", "alex", "xander", "sasha"], ["alexandra", "alex", "lexi", "sasha", "sandra"],
  ["edward", "ed", "eddie", "ted", "ned"], ["stephen", "steve", "stevie"], ["steven", "steve", "stevie"], ["timothy", "tim", "timmy"], ["gregory", "greg"], ["patrick", "pat", "paddy"],
  ["patricia", "pat", "patty", "trish", "tricia"], ["peter", "pete"], ["kenneth", "ken", "kenny"], ["ronald", "ron", "ronnie"], ["donald", "don", "donnie"], ["jeffrey", "jeff"],
  ["geoffrey", "geoff", "jeff"], ["david", "dave", "davey"], ["elizabeth", "liz", "beth", "betsy", "eliza", "lizzie", "libby", "betty"], ["katherine", "kate", "katie", "kathy", "kat", "kathryn"],
  ["catherine", "cathy", "kate", "cat", "katie"], ["margaret", "maggie", "meg", "peggy", "margo"], ["jennifer", "jen", "jenny"], ["jessica", "jess", "jessie"], ["rebecca", "becca", "becky"],
  ["susan", "sue", "susie"], ["deborah", "deb", "debbie"], ["victoria", "vicky", "tori"], ["abigail", "abby", "gail"], ["kimberly", "kim"], ["nathaniel", "nate", "nat"], ["nathan", "nate"],
  ["zachary", "zach", "zack"], ["frederick", "fred", "freddie"], ["lawrence", "larry"], ["gerald", "jerry"], ["raymond", "ray"], ["philip", "phil"], ["phillip", "phil"],
  ["douglas", "doug"], ["leonard", "leo", "len", "lenny"], ["vincent", "vince", "vinny"], ["theodore", "ted", "theo", "teddy"], ["jacob", "jake"], ["christina", "chris", "tina", "christy"],
  ["christine", "chris", "christy"], ["amanda", "mandy"], ["melissa", "mel", "missy"], ["pamela", "pam"], ["cynthia", "cindy"], ["sandra", "sandy"], ["barbara", "barb", "barbie"],
  ["judith", "judy"], ["gabriel", "gabe"], ["gabriela", "gabby"], ["gabrielle", "gabby"], ["maximilian", "max"], ["maxwell", "max"], ["eugene", "gene"], ["terrence", "terry"], ["terence", "terry"],
  ["walter", "walt"], ["albert", "al", "bert"], ["alfred", "al", "alfie", "fred"], ["allison", "ali", "allie"], ["alison", "ali", "allie"], ["madeline", "maddie", "maddy"], ["madison", "maddie", "maddy"],
  ["natalie", "nat"], ["natalia", "nat", "talia"], ["olivia", "liv", "livvy"], ["sophia", "sophie"], ["isabella", "bella", "izzy"], ["isabel", "izzy", "bel"], ["emily", "em", "emmy"],
  ["emma", "em"], ["eleanor", "ellie", "nell", "nora"], ["evelyn", "evie"], ["frances", "fran", "frankie"], ["francis", "frank", "fran"], ["franklin", "frank"], ["harold", "harry", "hal"],
  ["henry", "hank", "harry", "hal"], ["howard", "howie"], ["jacqueline", "jackie"], ["josephine", "jo", "josie"], ["joanna", "jo"], ["louis", "lou"], ["louise", "lou"], ["mitchell", "mitch"],
  ["nicole", "nikki", "nicky"], ["randall", "randy"], ["russell", "russ"], ["stanley", "stan"], ["sydney", "syd"], ["valerie", "val"], ["veronica", "ronnie", "vera"], ["wesley", "wes"],
  ["dominic", "dom"], ["dominique", "dom"], ["jeremy", "jerry"], ["jeremiah", "jerry"], ["kristopher", "kris"], ["kristen", "kris", "kristy"], ["kristina", "kris", "tina"],
  ["cameron", "cam"], ["camille", "cam"], ["benedict", "ben"], ["bradley", "brad"], ["bryan", "bry"], ["clifford", "cliff"], ["curtis", "curt"], ["dorothy", "dot", "dottie"],
  ["ernest", "ernie"], ["gwendolyn", "gwen"], ["herbert", "herb"], ["marjorie", "margie"], ["matthias", "matt"], ["mathew", "matt"], ["montgomery", "monty"], ["oliver", "ollie"],
  ["penelope", "penny"], ["rachel", "rach"], ["ronald", "ron"], ["sebastian", "seb", "bash"], ["solomon", "sol"], ["tabitha", "tabby"], ["tobias", "toby"], ["vivian", "viv"],
  ["yolanda", "yoli"], ["zoe", "zo"], ["adrienne", "adri"], ["mohammed", "mohamed", "muhammad", "mohammad", "mo"], ["muhammad", "mohammed", "mohamed", "mohammad", "mo"],
];
const NICKNAMES = new Map<string, Set<string>>();
for (const group of NICKNAME_GROUPS) for (const n of group) NICKNAMES.set(n, new Set([...(NICKNAMES.get(n) ?? []), ...group]));

/** Lowercase, strip accents and punctuation (keeping hyphens for compound names). */
function clean(part: string) {
  return part
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/ß/g, "ss")
    .replace(/[æ]/gi, "ae")
    .replace(/[øœ]/gi, "o")
    .replace(/ł/gi, "l")
    .toLowerCase()
    .replace(/[^a-z-]/g, "")
    .replace(/^-+|-+$/g, "");
}

/** Tokens of a display name without titles, suffixes, or parenthetical nicknames; "Doe, Jane" becomes "Jane Doe". */
function tokens(fullName: string) {
  let name = fullName.replace(/\(.*?\)|".*?"|“.*?”/g, " ");
  const commaParts = name.split(",").map((p) => p.trim()).filter(Boolean);
  const rest = commaParts.slice(1).join(" ").split(/\s+/).map(clean);
  if (commaParts.length > 1 && !rest.every((t) => !t || SUFFIXES.has(t.replace(/-/g, "")))) name = `${commaParts.slice(1).join(" ")} ${commaParts[0]}`;
  else name = commaParts[0] ?? "";
  const parts = name
    .split(/\s+/)
    .map(clean)
    .filter((p) => p && !SUFFIXES.has(p.replace(/-/g, "")));
  while (parts.length > 2 && PREFIXES.has(parts[0])) parts.shift();
  // "J. Robert Oppenheimer" goes by the second name.
  if (parts.length > 2 && parts[0].length === 1) parts.shift();
  return parts;
}

/** Nicknames written into the name, e.g. Robert "Bob" Smith or Margaret (Peggy) Lee. */
function quotedNicknames(fullName: string) {
  return [...fullName.matchAll(/\((.*?)\)|"(.*?)"|“(.*?)”/g)].map((m) => clean(m[1] ?? m[2] ?? m[3] ?? "")).filter((n) => n && !n.includes(" "));
}

/** Split a display name into the first, middle, and last name used to predict an address. */
export function nameParts(fullName: string): Name | null {
  const parts = tokens(fullName);
  if (parts.length < 2) return null;
  const strip = (s: string) => s.replace(/-/g, "");
  return { first: strip(parts[0]), last: strip(parts[parts.length - 1]), middle: parts.length > 2 ? strip(parts[1]) : "" };
}

/** Every plausible (first, middle, last) reading of a name: nicknames, hyphenated and compound surnames, two given names. */
function nameVariants(fullName: string): Name[] {
  const parts = tokens(fullName);
  if (parts.length < 2) return [];
  const given = parts[0];
  const lastTok = parts[parts.length - 1];
  const firsts = new Set<string>([given.replace(/-/g, ""), ...given.split("-"), ...quotedNicknames(fullName)]);
  for (const f of [...firsts]) for (const n of NICKNAMES.get(f) ?? []) firsts.add(n);
  if (parts.length >= 3) firsts.add(`${given}${parts[1]}`.replace(/-/g, ""));

  const lasts = new Set<string>([lastTok.replace(/-/g, ""), lastTok, ...lastTok.split("-")]);
  // Surname particles: "Ana de la Cruz" → delacruz / cruz; two surnames: "Juan Pérez García" → perez.
  const firstParticle = parts.findIndex((p, i) => i > 0 && i < parts.length - 1 && PARTICLES.has(p));
  if (firstParticle > 0) lasts.add(parts.slice(firstParticle).join("").replace(/-/g, ""));
  if (parts.length >= 3 && !PARTICLES.has(parts[parts.length - 2])) lasts.add(parts[parts.length - 2].replace(/-/g, ""));

  const middle = parts.length > 2 && firstParticle !== 1 ? parts[1].replace(/-/g, "") : "";
  const out: Name[] = [];
  for (const first of firsts) for (const last of lasts) if (first && last && first !== last) out.push({ first, last, middle });
  return out;
}

/** Which formats explain this address for this person (empty if none). */
export function formatsMatching(email: string, fullName: string) {
  // Ignore +tags and the digits companies append to resolve collisions (jdoe2@).
  const local = email.split("@")[0].toLowerCase().replace(/\+.*$/, "").replace(/\d+$/, "");
  if (!local || isRoleAddress(local)) return [];
  const matched = new Set<string>();
  for (const n of nameVariants(fullName)) for (const [key, make] of Object.entries(FORMATS)) if (make(n) === local) matched.add(key);
  return Object.keys(FORMATS).filter((k) => matched.has(k));
}

export function predictEmail(fullName: string, domain: string, pattern: string) {
  const names = nameParts(fullName);
  const local = names && FORMATS[pattern]?.(names);
  return local ? `${local}@${domain}` : null;
}

/** Example rendering of a pattern for display, e.g. "jane.doe@acme.com". */
export function describePattern(pattern: string, domain: string) {
  return predictEmail("Jane Q Doe", domain, pattern) ?? pattern;
}

/** The patterns worth predicting with for this domain, best first. */
export function patternsOf(row: EmailPattern) {
  return (row.patterns as PatternStat[]).filter((p) => p.votes > 0);
}

/**
 * Count votes. Each person (distinct address) is one independent example; it votes for every format it fits,
 * split evenly. The same address found in several sources counts once, slightly boosted. Replies are verified
 * examples, bounces count against the format of the bounced address, and addresses that fit no format
 * (usernames, aliases) dilute every format's share.
 */
export function tally(evidence: Evidence[]) {
  const byEmail = new Map<string, Evidence[]>();
  for (const e of evidence) byEmail.set(e.email, [...(byEmail.get(e.email) ?? []), e]);

  const stats = new Map<string, PatternStat>();
  const stat = (pattern: string) => {
    if (!stats.has(pattern)) stats.set(pattern, { pattern, votes: 0, examples: 0, sources: [], replies: 0, bounces: 0, confidence: 0, trusted: false });
    return stats.get(pattern)!;
  };
  const examples: ExampleSummary[] = [];
  let unmatched = 0;

  for (const [email, rows] of byEmail) {
    const name = rows.find((r) => r.name)?.name ?? "";
    const formats = name ? formatsMatching(email, name) : [];
    const publicSources = [...new Set(rows.map((r) => r.source).filter((s) => s !== "reply" && s !== "bounce"))];
    const replied = rows.some((r) => r.source === "reply");
    const bounced = rows.some((r) => r.source === "bounce");
    const positive = replied || publicSources.length > 0;

    if (publicSources.length) {
      examples.push({ email, name, sourceUrl: rows.find((r) => r.sourceUrl && publicSources.includes(r.source))?.sourceUrl ?? null, sources: publicSources, formats });
    }
    if (!formats.length) {
      if (positive && !bounced) unmatched++;
      continue;
    }
    const share = 1 / formats.length;
    const weight = replied ? WEIGHT.reply : publicSources.length ? 1 + Math.min(publicSources.length - 1, 2) * WEIGHT.extraSource : 0;
    for (const f of formats) {
      const s = stat(f);
      s.votes += weight * share - (bounced ? WEIGHT.bounce * share : 0);
      if (positive && !bounced) s.examples++;
      if (replied) s.replies++;
      if (bounced) s.bounces++;
      for (const src of publicSources) if (!s.sources.includes(src)) s.sources.push(src);
    }
  }

  const list = [...stats.values()];
  const total = list.reduce((sum, s) => sum + Math.max(s.votes, 0), 0) + unmatched * WEIGHT.unmatched;
  const order = Object.keys(FORMATS);
  for (const s of list) {
    const net = Math.max(s.votes, 0);
    // How much evidence there is (1 vote → 40%, 2 → 64%, 3 → 78%, 5 → 92%), scaled by this format's share of it.
    // The share is softened (square root) because two formats can legitimately coexist on one domain.
    s.confidence = total ? Math.round(Math.sqrt(net / total) * (1 - 0.6 ** net) * 100) / 100 : 0;
    s.votes = Math.round(s.votes * 100) / 100;
    s.trusted = s.examples >= MIN_EXAMPLES && s.confidence >= 0.5;
  }
  list.sort((a, b) => b.confidence - a.confidence || b.examples - a.examples || order.indexOf(a.pattern) - order.indexOf(b.pattern));
  return { patterns: list, examples: examples.slice(0, 25), unmatched };
}

/** Rebuild a domain's cached pattern row from all of its evidence. */
async function recompute(domain: string, company: string | null, opts: { mined?: boolean } = {}) {
  const evidence = await db.select().from(emailEvidence).where(eq(emailEvidence.domain, domain));
  const { patterns, examples } = tally(evidence);
  const best = patterns.find((p) => p.votes > 0);
  const values = {
    domain,
    pattern: best?.pattern ?? null,
    matches: best?.examples ?? 0,
    confidence: best?.confidence ?? 0,
    patterns,
    examples,
    ...(company ? { company } : {}),
  };
  const [prev] = await db.select().from(emailPatterns).where(eq(emailPatterns.domain, domain));
  // Re-mine soon when feedback knocks the best pattern out of trusted territory.
  const lostTrust = prev && (prev.patterns as PatternStat[])[0]?.trusted && !best?.trusted;
  const checkedAt = opts.mined ? new Date() : lostTrust ? null : (prev?.checkedAt ?? null);
  const [row] = await db
    .insert(emailPatterns)
    .values({ ...values, checkedAt })
    .onConflictDoUpdate({ target: emailPatterns.domain, set: { ...values, checkedAt } })
    .returning();
  return row;
}

async function saveHits(domain: string, hits: Hit[]) {
  const seen = new Set<string>();
  const rows = hits.filter((h) => {
    const key = `${h.email}|${h.source}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  if (rows.length) {
    await db
      .insert(emailEvidence)
      .values(rows.map((h) => ({ domain, email: h.email, name: h.name, source: h.source, sourceUrl: h.sourceUrl })))
      .onConflictDoNothing();
  }
}

function isFresh(row: EmailPattern) {
  const best = patternsOf(row)[0];
  const ttl = TTL_DAYS[best?.trusted ? "trusted" : best ? "tentative" : "none"] * 86_400_000;
  return row.checkedAt != null && Date.now() - row.checkedAt.getTime() < ttl;
}

/**
 * Return the company's email formats. Cached per domain; when stale, mine public sources again and add
 * whatever turns up to the evidence already collected, so each lookup builds on the last.
 */
export async function getEmailPattern(company: string, domain: string): Promise<EmailPattern> {
  const [cached] = await db.select().from(emailPatterns).where(eq(emailPatterns.domain, domain));
  if (cached && isFresh(cached)) return cached;

  try {
    await saveHits(domain, await mineStructuredSources(company, domain));
    let row = await recompute(domain, company, { mined: true });
    // Papers, conference pages, and press releases need a full web search; only pay for it when the cheaper sources fall short.
    if (!patternsOf(row)[0]?.trusted || row.matches < WEB_SEARCH_BELOW) {
      const web = await searchWebForEmails(company, domain).catch((err) => {
        console.error(`Email web search failed for ${domain}: ${(err as Error).message}`);
        return [];
      });
      if (web.length) {
        await saveHits(domain, web);
        row = await recompute(domain, company, { mined: true });
      }
    }
    return row;
  } catch (err) {
    console.error(`Email pattern lookup failed for ${domain}: ${(err as Error).message}`);
    if (cached) return cached;
    throw err;
  }
}

/**
 * Record what happened to a sent email. A reply proves the address is real; a bounce counts against its
 * format. Passing null undoes earlier feedback for this outreach.
 */
export async function recordOutcome(o: { id: number; name: string; email: string | null; company: string }, outcome: "replied" | "bounced" | null) {
  const email = o.email?.trim().toLowerCase();
  const domain = email?.split("@")[1];
  if (!email || !domain) return null;
  await db.delete(emailEvidence).where(and(eq(emailEvidence.outreachId, o.id), inArray(emailEvidence.source, ["reply", "bounce"])));
  if (outcome) {
    await db
      .insert(emailEvidence)
      .values({ domain, email, name: o.name, source: outcome === "replied" ? "reply" : "bounce", outreachId: o.id })
      .onConflictDoNothing();
  }
  const [existing] = await db.select({ company: emailPatterns.company }).from(emailPatterns).where(eq(emailPatterns.domain, domain));
  return recompute(domain, existing?.company ?? o.company);
}

/** Forget everything learned about a domain, including evidence, so the next search starts over. */
export async function forgetDomain(domain: string) {
  await db.delete(emailEvidence).where(eq(emailEvidence.domain, domain));
  await db.delete(emailPatterns).where(eq(emailPatterns.domain, domain));
}
