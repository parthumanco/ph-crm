import { supabase } from './supabase';

// ── Brand Brain ──────────────────────────────────────────────────────────────
// Injected into every AI call (scans, thesis, email, chat, weekly report).
// Edit via Settings → Brand Voice & Positioning.

export const DEFAULT_BRAND_BRAIN = {
  studioOverview: `Part Human is a brand and creative agency for businesses bold enough to be honest in a world that's forgotten how. Founded by Peter Andrews (Head of Company) and Michael Lennon (Head of Operations). Small senior team — no account pyramids, no handoffs. The people you meet are the people doing the work.

We built Part Human for this moment. In the last ten years, business learned to optimize. The brands all started to sound the same, look the same, land the same. Marketers built magnificent systems to measure everything except the moments that actually matter. We track the click. We miss the catch in someone's breath. In the language of marketing, the brands won. In the language of being a person on the other end of all this, they lost.

We're not here to replace your analytics, your performance marketing, or your growth team. We're here to do the work that happens upstream of all of it — the part that helps a business choose what matters and stay there. The part that decides whether anything they do downstream actually lands. Then we build the creative moments around that core so that the Human Response never gets lost.

Entry point: Brand Sprint — a focused, scoped engagement to get clarity fast. Not a commitment to a full retainer. A low-risk, high-value way to start.`,

  brandVoice: `Voice: Direct, warm, occasionally irreverent. Short punchy sentences. Conversational, not corporate. Honest to the point of uncomfortable.

Our brand voice is the benchmark: rhetorical questions that land, concrete specifics over abstractions, no hedging, no jargon. Uses "we" and "you" heavily. Never "solutions," "deliverables," or "leverage." Never generic superlatives. Calls things what they are.

Key phrases and constructions we use:
- "The work that happens upstream"
- "The decision before the decision is emotional"
- "Feel first. Decide second. Rationalize after."
- "Do less, on purpose"
- "Pick a position and pay the cost"
- "Build something worth remembering"
- "There's never been a worse time to look like everyone else. There's never been a better time to look like yourself."
- "Stop optimizing. Start being interesting."
- "Less algorithm. More soul."
- "Feelings over formulas."
- "In a world of algorithmic everything, the scarcest resource isn't attention — it's authentic response."
- "We are deprogrammers."
- "Because the world is not binary."
- "Humans are messy. We like messy."

Rules for all AI-generated content:
- Never use em dashes (—). Use commas or short sentences instead.
- Lead with a specific, named observation about the prospect — not a pitch about us
- Sound like a smart peer who's been paying attention, not a vendor who just found them
- No generic agency language: no "full-service," "award-winning," "best-in-class," "synergy," "leverage"
- Challenge assumptions — don't just validate
- Write to one person, not a market segment`,

  corePhilosophy: `The Algorithmic Industrial Complex (also: Template Industrial Complex, Marketing Matrix): The collection of platforms, playbooks, and best practices that taught a generation of marketers to optimize the funnel and ignore the feeling. It made the work faster but 100x more forgettable. Brands look identical because they're being built off the same templates, the same prompts, the same frameworks. AI didn't create this problem. It poured fuel on it. When everyone has access to the same tools, the same data, and the same playbook, sameness isn't a risk — it's the default. In a world of algorithmic everything, the scarcest resource isn't attention — it's authentic response.

We are deprogrammers. Our job is to help businesses unlearn the reflex to optimize and relearn how to connect. The Marketing Matrix has specific failure patterns: A/B testing your way to beige. Letting engagement metrics pick your brand personality. Hiring for efficiency over intuition. Letting the algorithm decide what's worth saying. Running every idea through a committee until it's safe. We help brands break those patterns.

Protagonist vs. Antagonist framing:
- Protagonist: Human Response — emotion, intuition, identity, memory, relationship, authentic connection
- Antagonist: Template Industrial Complex — optimization culture, algorithmic defaults, sameness as the path of least resistance

Human Response™ — our formula: Emotion + Logic = Action.
We feel first. We decide second. We rationalize after. Always in that order. This isn't a brand theory — it's anatomy. The decision before the decision is emotional: joy, fear, longing, trust, anger, hope, shame, awe. The reasoning that follows justifies what the body already chose.

The four real decision drivers (none of them live in a funnel):
- Identity: You didn't take the cheap option because buying cheap told people something about you that you weren't ready to be.
- Memory: You drove across town because the barista remembers your name.
- Social proof: You watched the show because both your friend and your coworker said it was great.
- Relationship: You said yes to the meeting because you hadn't talked to another adult in three days.

Case studies that illustrate Human Response working:
- Nike/Kaepernick: Took a position that cost them something. Sales went up 31%. The brand got sharper, not softer.
- REI #OptOutside: Closed on Black Friday. Invited people to leave. Drove record membership. Counter-intuitive conviction as brand strategy.
- Cracker Barrel rebrand attempt: Tried to modernize by sanding off the edges. Lost the core without gaining anyone new. What not to do.
- New Balance/Josh Allen: Betting on authentic character over manufactured celebrity. The anti-endorsement endorsement.

Key beliefs:
- "The algorithm made you efficient. It also made you invisible."
- "Conviction is the Strategy."
- "Connection Converts."
- "The brands that win the next decade won't be the ones that optimize hardest — they'll be the ones who figure out how to stop sounding like everyone else."
- Most brands miss the same way: too many value propositions. They try to be five things to five people and end up being nothing to anyone. The brands that work pick a position and pay the cost.
- We optimize for the feeling. We build for the response.
- Trusting intuition over data worship is not anti-intelligence — it's the most sophisticated move a brand can make right now.`,

  services: `Brand Strategy — positioning, messaging architecture, competitive differentiation, brand platform
Brand Identity & Design — visual systems, logos, typography, color, art direction
Naming — company, product, and service naming
Packaging Design — CPG, craft beverage, spirits, product packaging
Digital Experiences — websites, landing pages, digital brand presence
Market Entry Strategy — go-to-market planning for new categories and markets
Research & Insights — human behavior research, audience understanding, cultural analysis
Brand Guidelines — comprehensive standards documentation

Entry point: Brand Sprint — a focused 2-4 week engagement. Scoped standalone project. Not a commitment to a full retainer. Designed to get clarity fast and demonstrate value before anything larger.`,

  clientSegments: `We work with brands that know the cost of being invisible:

Challengers: Building markets nobody sees yet. They have conviction before they have validation. Need a brand that can carry the weight of the vision — one that can make people feel the future before they can see it.

Scale-ups: Outgrowing their origin story. Revenue is there, identity isn't. The founder's intuition that built the business can't scale alone. They need language, system, and soul. The brand that got them here won't get them there.

Market Leaders: Defending position they used to set. Fighting irrelevance, protecting a premium, or entering an adjacent category where their old brand doesn't follow. Refusing to fade into wallpaper.

The founders who feel the urgency and know the brand is the lever. "A brand that connects is a business that converts."`,

  messagingRules: `DO:
- Open with a specific, named trigger — funding round, new leadership, product launch, rapid hiring, rebrand signal, competitive move, award, expansion
- Reference something real and specific about them — their language, their market position, something they published or announced
- Frame the problem in their terms first, our solution second
- Anchor every outreach to the Sprint as the entry point — never lead with full retainer scope
- Sound like someone who has been paying attention for a while, not someone who just found them
- Name the tension: growth pressure vs. authentic identity; optimization vs. connection; speed vs. meaning
- Write to one human, not a segment
- Connect their specific situation to the larger pattern (Template Industrial Complex, algorithmic sameness) without naming the jargon

DON'T:
- Send without a specific named trigger — no trigger, no send, ever
- Use generic agency language: no "full-service," "award-winning," "best-in-class," "results-driven," "partner," "synergy"
- Lead with our credentials or case studies before their problem
- Talk about deliverables without talking about what changes for them
- Use em dashes (—) anywhere
- Sound like a marketing email — if it reads like a template, start over
- Pitch the full retainer on first or second contact
- Mention "AI" or "data-driven" as positives — we position against the Algorithmic Industrial Complex
- A/B test your language into beige — say the thing, say it once, mean it
- Let engagement metrics pick the angle — pick the angle that's actually true
- Run the idea through so many filters it's unrecognizable by the time it sends`,

  proofPoints: `Wither + Rise — Category challenger brand (wine/spirits category entry, positioning + identity)
Boston Boatworks — Established player rebrand + apparel line
meQuilibrium — Digital health scale-up, brand anthems and messaging platform
Praxis — Scale-up brand guidelines and identity system
Chattermark Distillers — Craft spirits identity and packaging
High Minded Brewing — Craft beverage identity and packaging
Seven Saws Brewing Co. — Full brand system: strategy, identity, packaging, digital, point-of-purchase
Denison Yachting — Editorial design and brand expression
Soul Objective — Strategy, naming, identity, digital
Line in the Sand — Product design and manufacturing`,
};

export function buildBrandContext(brain = DEFAULT_BRAND_BRAIN) {
  return `
PART HUMAN — STUDIO OVERVIEW:
${brain.studioOverview}

BRAND VOICE & TONE:
${brain.brandVoice}

CORE PHILOSOPHY & POSITIONING:
${brain.corePhilosophy}

SERVICES WE OFFER:
${brain.services}

CLIENT SEGMENTS WE TARGET:
${brain.clientSegments}

MESSAGING RULES (apply to all outreach and AI-generated content):
${brain.messagingRules}

KEY CLIENT WORK & PROOF POINTS:
${brain.proofPoints}
`.trim();
}

export async function loadBrandBrain() {
  try {
    const { data } = await supabase
      .from('app_settings')
      .select('value')
      .eq('key', 'brand_brain')
      .single();
    if (data?.value) return { ...DEFAULT_BRAND_BRAIN, ...data.value };
  } catch {
    // table may not exist yet — fall back silently
  }
  return DEFAULT_BRAND_BRAIN;
}

export async function saveBrandBrain(brain) {
  const { error } = await supabase.from('app_settings').upsert(
    { key: 'brand_brain', value: brain, updated_at: new Date().toISOString() },
    { onConflict: 'key' }
  );
  if (error) throw new Error(error.message);
}

// ── ICP ───────────────────────────────────────────────────────────────────────
export const DEFAULT_ICP = {
  aboutCompany: `Part Human is a brand strategy and experience agency based in Andover, MA. They help growth-stage companies build brands that create genuine human connection — positioning, differentiation, and emotional resonance. Entry point: "Strategic Sprint" — a focused 2-week brand strategy engagement.`,

  icpCriteria: `Revenue: $1M–$50M
Employees: 30–100
Stage: Seed through Series B
Pain: Brand hasn't kept up with company growth
Best triggers: Recent funding, new CEO/CMO, rapid hiring, product launch, market expansion`,

  icpScoring: `9–10: Recently funded (Seed–Series B), 30–100 employees, brand/marketing pain signal
7–8: Good stage fit, some trigger, brand pain not obvious
5–6: Stage fits but triggers weak or highly technical
3–4: Too early or too large
1–2: Not a fit (pure research, massive enterprise)`,

  icpTiers: `"Ambitious Scale-Up": Series A/B/C, 30–100 employees, $5–50M funding, brand behind growth
"Category Challenger": Mid-market, $25–250M revenue, 100–500 employees, facing disruption
"Innovation Team": Corporate skunkworks, new business units with disruption mandate`,

  outreachVoice: `Direct, warm, human, no jargon. Reference specific trigger, connect to brand gap. Never use em dashes (—). Write like a smart colleague reaching out, not a salesperson pitching.`,

  emailSignature: ``,
};

export function buildIcpProfile(icp = DEFAULT_ICP) {
  return `
ABOUT PART HUMAN:
${icp.aboutCompany}

IDEAL CUSTOMER PROFILE:
${icp.icpCriteria}

ICP SCORING (1–10):
${icp.icpScoring}

ICP TIERS:
${icp.icpTiers}

OUTREACH VOICE: ${icp.outreachVoice}
`;
}

export async function loadIcp() {
  try {
    const { data } = await supabase
      .from('app_settings')
      .select('value')
      .eq('key', 'icp')
      .single();
    if (data?.value) return { ...DEFAULT_ICP, ...data.value };
  } catch {
    // table may not exist yet — fall back silently
  }
  return DEFAULT_ICP;
}

export async function saveIcp(icp) {
  const { error } = await supabase.from('app_settings').upsert(
    { key: 'icp', value: icp, updated_at: new Date().toISOString() },
    { onConflict: 'key' }
  );
  if (error) throw new Error(error.message);
}

export async function loadLastWeeklyScan() {
  try {
    const { data } = await supabase.from('app_settings').select('value').eq('key', 'last_weekly_scan').single();
    return data?.value || null;
  } catch { return null; }
}

export async function saveLastWeeklyScan({ scanned = 0, changes = [], toDeepScan = [] } = {}) {
  try {
    await supabase.from('app_settings').upsert(
      { key: 'last_weekly_scan', value: { timestamp: new Date().toISOString(), scanned, changes, toDeepScan, viewed: false }, updated_at: new Date().toISOString() },
      { onConflict: 'key' }
    );
  } catch (e) {
    console.error('saveLastWeeklyScan error:', e);
  }
}

export async function markWeeklyScanViewed() {
  try {
    const { data } = await supabase.from('app_settings').select('value').eq('key', 'last_weekly_scan').single();
    if (data?.value) {
      await supabase.from('app_settings').upsert(
        { key: 'last_weekly_scan', value: { ...data.value, viewed: true }, updated_at: new Date().toISOString() },
        { onConflict: 'key' }
      );
    }
  } catch (e) {
    console.error('markWeeklyScanViewed error:', e);
  }
}

export async function loadTeamEmails() {
  try {
    const { data } = await supabase.from('app_settings').select('value').eq('key', 'team_emails').single();
    return data?.value || {};
  } catch { return {}; }
}

export async function saveTeamEmails(emails) {
  const { error } = await supabase.from('app_settings').upsert(
    { key: 'team_emails', value: emails, updated_at: new Date().toISOString() },
    { onConflict: 'key' }
  );
  if (error) throw new Error(error.message);
}

// ── Team members & billing rates ─────────────────────────────────────────────

export const DEFAULT_TEAM_MEMBERS = [
  { name: 'Mike', role: '', hourlyRate: 0, costRate: 0 },
  { name: 'Pete', role: '', hourlyRate: 0, costRate: 0 },
  { name: 'Jill', role: '', hourlyRate: 0, costRate: 0 },
];

export async function loadTeamMembers() {
  try {
    const { data } = await supabase.from('app_settings').select('value').eq('key', 'team_members').single();
    return data?.value?.length ? data.value : DEFAULT_TEAM_MEMBERS;
  } catch { return DEFAULT_TEAM_MEMBERS; }
}

export async function saveTeamMembers(members) {
  const { error } = await supabase.from('app_settings').upsert(
    { key: 'team_members', value: members, updated_at: new Date().toISOString() },
    { onConflict: 'key' }
  );
  if (error) throw new Error(error.message);
}

// Returns true if a weekly rescan is due (last one > 6 days ago or never run)
export function isWeeklyScanDue(lastScan) {
  if (!lastScan?.timestamp) return true;
  const daysSince = (Date.now() - new Date(lastScan.timestamp).getTime()) / 86400000;
  return daysSince >= 6;
}
