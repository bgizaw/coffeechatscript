import Anthropic from "@anthropic-ai/sdk";

const MODEL = "claude-sonnet-5-5";

async function askJson<T>(system: string, prompt: string, maxTokens = 1500): Promise<T> {
  const anthropic = new Anthropic();
  const msg = await anthropic.messages.create({
    model: MODEL,
    max_tokens: maxTokens,
    system: `${system}\nRespond with a single JSON object only — no prose, no code fences.`,
    messages: [{ role: "user", content: prompt }],
  });
  const text = msg.content.map((b) => (b.type === "text" ? b.text : "")).join("");
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error("AI returned an unexpected response.");
  return JSON.parse(match[0]) as T;
}

export function suggestTitles(role: string, company: string) {
  return askJson<{ hiringTitles: string[]; peerTitles: string[] }>(
    "You help job seekers find the right people to contact at a company.",
    `I'm applying for the role "${role}" at ${company}.
Give two lists of job titles to search for on a people database:
- "hiringTitles": 5-7 titles of people who would likely be the hiring manager for this role or recruit for it (e.g. the manager/director/head of the team, and technical/department recruiters). 
- "peerTitles": 3-5 titles of people currently doing this role or a closely related, slightly more senior one.
Use short, common LinkedIn-style titles. Format: {"hiringTitles": [...], "peerTitles": [...]}`,
    600,
  );
}

export function rankCandidates(role: string, company: string, candidates: { id: string; title: string | null; group: string }[]) {
  return askJson<{ ranked: { id: string; reason: string }[] }>(
    "You help job seekers pick who to reach out to about a job opening.",
    `I'm applying for "${role}" at ${company}. Rank the best people to email, most valuable first.
Strongly prefer the likely hiring manager (the person this role would report to), then a recruiter focused on this kind of role, then someone with direct experience in this exact role. Avoid C-suite at large companies and unrelated departments.
Return up to 6 people as {"ranked":[{"id":"...","reason":"one short sentence on why they're a good contact"}]}.

Candidates:
${candidates.map((c) => `- id=${c.id} | title=${c.title ?? "unknown"} | found_as=${c.group}`).join("\n")}`,
    1200,
  );
}

export function writeEmail(input: {
  role: string;
  company: string;
  senderName: string;
  senderBackground: string;
  template: string;
  recipient: { name: string; firstName: string; title: string | null; headline: string | null; reason: string | null; history: unknown };
}) {
  const r = input.recipient;
  return askJson<{ subject: string; body: string }>(
    "You write short, warm, genuine cold outreach emails for job seekers. Never invent facts about the sender or recipient. Plain text only, no markdown.",
    `Write an email from ${input.senderName || "the sender"} to ${r.name} about the "${input.role}" role at ${input.company}.

Sender background:
${input.senderBackground || "(not provided — keep it general)"}

Recipient:
- Name: ${r.name} (address them as ${r.firstName || r.name})
- Title: ${r.title ?? "unknown"}
- Headline: ${r.headline ?? "n/a"}
- Recent experience: ${JSON.stringify(r.history ?? [])}
- Why they're relevant: ${r.reason ?? "n/a"}

Template to loosely follow (keep its structure, tone and key points, but rewrite naturally and personalize to this recipient — adapt the ask to whether they're a hiring manager, recruiter, or someone in the role). Fill in or drop any placeholders:
"""
${input.template || "Hi {{first_name}},\n\nI recently applied for the {{role}} role at {{company}} and wanted to reach out. [1-2 sentences on my relevant background.] I'd love to hear about your experience on the team and would really appreciate 15 minutes to chat.\n\nThanks,\n{{my_name}}"}
"""

Keep it under 160 words. Sign off with the sender's name. Format: {"subject":"...","body":"..."}`,
    1200,
  );
}
