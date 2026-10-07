const BASE = "https://api.apollo.io/api/v1";

function apiKey() {
  const key = Netlify.env.get("APOLLO_API_KEY");
  if (!key) throw new Error("APOLLO_API_KEY must be set in your Netlify environment variables.");
  return key;
}

type QueryValue = string | number | boolean | string[] | undefined;

async function apollo(path: string, query: Record<string, QueryValue>) {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v === undefined) continue;
    if (Array.isArray(v)) v.forEach((item) => params.append(`${k}[]`, item));
    else params.set(k, String(v));
  }
  const res = await fetch(`${BASE}${path}?${params}`, {
    method: "POST",
    headers: { "x-api-key": apiKey(), "Content-Type": "application/json", "Cache-Control": "no-cache" },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = data?.error_details?.message || data?.error || data?.message || res.statusText;
    throw new Error(`Apollo error (${res.status}) on ${path}: ${msg}`);
  }
  return data;
}

export async function findCompanyDomain(company: string) {
  const data = await apollo("/mixed_companies/search", { q_organization_name: company, per_page: 5 });
  const orgs: { name: string; primary_domain?: string; website_url?: string }[] = data.organizations ?? [];
  const exact = orgs.find((o) => o.name?.toLowerCase() === company.toLowerCase()) ?? orgs[0];
  if (!exact) return null;
  const domain = exact.primary_domain || exact.website_url?.replace(/^https?:\/\/(www\.)?/, "").split("/")[0];
  return domain ? { name: exact.name, domain } : null;
}

export type Candidate = {
  id: string;
  firstName: string;
  title: string | null;
  company: string | null;
  hasEmail: boolean;
  group: string;
};

export async function searchPeople(domain: string, titles: string[], group: string, perPage = 25): Promise<Candidate[]> {
  if (!titles.length) return [];
  const data = await apollo("/mixed_people/api_search", {
    q_organization_domains_list: [domain],
    person_titles: titles,
    per_page: perPage,
  });
  return (data.people ?? []).map((p: any) => ({
    id: p.id,
    firstName: p.first_name,
    title: p.title ?? null,
    company: p.organization?.name ?? null,
    hasEmail: Boolean(p.has_email),
    group,
  }));
}

export async function enrichPerson(id: string) {
  const data = await apollo("/people/match", { id, reveal_personal_emails: false });
  const p = data.person;
  if (!p) return null;
  return {
    name: p.name || [p.first_name, p.last_name].filter(Boolean).join(" "),
    firstName: p.first_name as string,
    title: (p.title as string) ?? null,
    company: (p.organization?.name as string) ?? null,
    email: (p.email as string) || null,
    emailStatus: (p.email_status as string) ?? null,
    linkedinUrl: (p.linkedin_url as string) ?? null,
    headline: (p.headline as string) ?? null,
    employmentHistory: ((p.employment_history ?? []) as any[]).slice(0, 4).map((e) => ({
      title: e.title,
      org: e.organization_name,
      current: e.current,
      start: e.start_date,
    })),
  };
}
