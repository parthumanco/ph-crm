import { supabase } from './supabase';

// ── Brand Brain ──────────────────────────────────────────────────────────────
// Injected into every AI call (scans, thesis, email, chat, weekly report).
// Edit via Settings → Brand Voice & Positioning.

export const DEFAULT_BRAND_BRAIN = {
  studioOverview: `Part Human is a human-centered brand design studio based in Andover, MA. Founded by Peter Andrews and Michael Lennon. A small, senior team — no account pyramids, no handoffs. The people you meet are the people doing the work.

We work with businesses bold enough to be honest in a world that's forgotten how. Our work spans brand strategy, identity, naming, packaging, digital experience, and market entry. Entry point is typically a Brand Sprint — a focused, low-risk engagement designed to build trust and get clarity fast before a larger retainer commitment.`,

  brandVoice: `Direct, conversational, occasionally irreverent. Short punchy sentences that land emotionally before they explain logically. Skeptical of algorithmic thinking and industry defaults. Concrete over abstract — observable behavior over theoretical personas. Honest to the point of uncomfortable.

Write like a smart peer who sees something the prospect might have missed — not a salesperson pitching. No jargon. No generic superlatives ("best-in-class," "full-service," "award-winning"). Lead with a specific, named observation. Challenge assumptions gently. Never use em dashes (—). Feel something.`,

  corePhilosophy: `"The algorithm made you efficient. It also made you invisible."
"Humans feel first, decide second, and rationalize third."
"The real decision happens before the decision."
"Conviction is the Strategy."
"Connection Converts."

Our Human Response™ system is the intellectual backbone behind everything we do — built around the actual human, not the clean version. Emotion runs upstream of logic. Most brands work backward, starting with logic and hoping feeling follows. We don't.

Three things that determine whether a brand works: Mechanism (how people actually decide), Texture (distinctive voice, taste, and point of view), and Cultural Field (reading the room — the same move can be brilliant in one moment and tone-deaf in another).`,

  services: `Brand Strategy — positioning, messaging architecture, competitive differentiation, brand platform
Brand Identity & Design — visual systems, logos, typography, color, art direction
Naming — company, product, and service naming
Packaging Design — CPG, craft beverage, spirits, product packaging
Digital Experiences — websites, landing pages, digital brand presence
Market Entry Strategy — go-to-market planning for new categories and markets
Research & Insights — human behavior research, audience understanding, cultural analysis
Brand Guidelines — comprehensive standards documentation and brand management

Entry point: Brand Sprint — focused 2-4 week engagement to get clarity fast. Scoped as a standalone project, not a commitment to a full retainer.`,

  clientSegments: `Challengers: Companies creating markets nobody sees yet. Early-stage, conviction-led, need a brand that can carry the weight of their vision before revenue validates it.

Scale-ups: Companies outgrowing their origin story. Revenue is there, identity isn't. The founders' intuition that built the business can't scale alone — they need language, system, and soul.

Market Leaders: Established players refusing to fade into wallpaper. Fighting irrelevance, defending a premium position, or entering an adjacent category where their old brand doesn't follow.`,

  messagingRules: `DO:
- Lead with a specific, named trigger (funding round, new leadership, product launch, expansion, rebrand signal, award)
- Reference their specific situation — not generic category pain
- Position Part Human as the antidote to algorithm-driven, generic brand work
- Anchor to the Sprint as the low-risk entry point — never lead with the full retainer
- Sound like someone who's been paying attention, not someone who just found them
- Acknowledge the tension between growth pressure and authentic identity

DON'T:
- Use generic agency language or superlatives of any kind
- Lead with our credentials before their problem
- Talk about "deliverables" without talking about outcomes
- Send anything without a specific, named trigger — no trigger, no send
- Pitch the full scope on first contact
- Sound like a marketing email`,

  proofPoints: `Wither + Rise — Category challenger brand (wine/spirits category entry)
Boston Boatworks — Established player rebrand + apparel line
meQuilibrium — Digital health scale-up, brand anthems and messaging platform
Praxis — Scale-up brand guidelines and identity system
Chattermark Distillers — Craft spirits identity and packaging
High Minded Brewing — Craft beverage identity and packaging
Seven Saws Brewing Co. — Full brand system: strategy, identity, packaging, digital, point-of-purchase
Denison Yachting — Editorial design and brand expression
Soul Objective — Strategy, naming, identity, digital`,
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
