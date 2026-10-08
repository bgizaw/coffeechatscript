/** Used when an account hasn't written its own contact priorities in Settings. */
export const DEFAULT_PRIORITIES = `Tier 1: Shared affiliation (highest response rates)
- Pomona and the Claremont Colleges (Pomona, Pitzer, CMC, Scripps, Harvey Mudd), plus anyone who was in the same clubs, sports, or dorm programs.
- MLT (Management Leadership for Tomorrow) alumni or fellows. MLT has a built-in "pay it forward" culture, and its network is full of people in finance, tech, and consulting.
- Thrive Scholars alumni and other first-gen or underrepresented-talent programs.
- OBSA or other Black professional networks, and any affinity group tied to a program I'm in.

Tier 2: Similar path (they remember being me)
- Pomona CS or art majors who ended up in data or fashion-tech.
- Recent graduates (0-5 years out) in the role I want. They're more reachable and more willing to talk than senior leaders.
- People who moved from CS into fashion or the reverse, which matches my dual background.
- Same hometown or region (Houston/Texas) or shared roots.

Tier 3: Role relevance
- The hiring manager or team lead for the exact role. This has the highest value but the lowest reply rate, so keep it to one of the two.
- A peer in the exact role (same title, one to three levels above me). This is often the best coffee-chat target.
- Recruiters or talent partners, who are paid to respond.
- People who recently changed roles or joined the company. New hires remember the process and are less guarded.
- Employees who are active on LinkedIn, with recent posts or comments, since they actually check messages.

Tier 4: Signals they'll respond
- They've given talks, written posts, or mentored publicly, which suggests they enjoy sharing advice.
- Their profile says "open to mentoring" or they're on platforms like ADPList.
- Small teams or startups, where people are easier to reach than at large companies.
- Shared interests visible on their profile, like fashion, sustainability, or specific tech.

Penalize or skip:
- Executives (VP and above) at large companies.
- People with no recent activity or an incomplete profile.
- Anyone I'd contact through a company-wide email alias.
- Contacts whose email pattern can't be verified.`;

export function priorityList(custom: string | null | undefined) {
  return custom?.trim() || DEFAULT_PRIORITIES;
}
