const API_KEY = import.meta.env.VITE_ANTHROPIC_API_KEY;
const BASE_URL = 'https://api.anthropic.com/v1/messages';
const TIMEOUT_MS = 90000;

function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`Request timed out after ${ms / 1000}s`)), ms)),
  ]);
}

async function callClaude({ model = 'claude-haiku-4-5-20251001', system, messages, max_tokens = 4000, tools }) {
  const body = { model, max_tokens, system, messages };
  if (tools) body.tools = tools;

  const res = await fetch(BASE_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': API_KEY,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify(body),
  });

  const raw = await res.text();
  let data;
  try { data = JSON.parse(raw); } catch {
    throw new Error(`Bad JSON (HTTP ${res.status}): ${raw.slice(0, 200)}`);
  }
  if (!res.ok) {
    if (res.status === 429) throw new Error('Rate limited — please wait a moment and try again');
    throw new Error(`API error ${res.status}: ${data?.error?.message || raw.slice(0, 200)}`);
  }
  return data;
}

// ── Engagement types ──────────────────────────────────────────────────────────

export const ENGAGEMENT_META = {
  Sprint:       { name: 'Strategic Sprint',    price: '$12K',       duration: '2 weeks',     color: '#10b981', cta: '20-minute call to scope a focused sprint',                   hook: 'fast, low-risk, one focused outcome in two weeks' },
  Foundation:   { name: 'Foundation',          price: '$25–50K',    duration: '2–3 months',  color: '#3b82f6', cta: '30-minute conversation about getting brand foundations right', hook: 'strategic groundwork — clarity on positioning and messaging before anything else' },
  Growth:       { name: 'Growth',              price: '$75–150K',   duration: '4–6 months',  color: '#8b5cf6', cta: 'conversation about a full brand build',                       hook: 'strategy and execution — building a brand that keeps up with the company' },
  Acceleration: { name: 'Acceleration',        price: '$200–500K',  duration: '6–12 months', color: '#f59e0b', cta: 'strategy conversation about brand as a growth driver',        hook: 'full brand ecosystem and go-to-market activation for companies scaling fast' },
  Enterprise:   { name: 'Enterprise Partnership', price: '$500K+', duration: '12+ months',  color: '#ef4444', cta: 'discovery conversation about long-term brand transformation',  hook: 'ongoing strategic partnership built around multi-workstream brand transformation' },
};

export const ENGAGEMENT_OPTIONS = ['Sprint', 'Foundation', 'Growth', 'Acceleration', 'Enterprise'];

function getRoleContext(title) {
  const t = (title || '').toLowerCase();
  if (/\b(cfo|chief financial|vp finance|finance director)\b/.test(t))
    return 'Frame brand as a growth asset — unclear positioning costs deals, inflates CAC, and slows fundraising.';
  if (/\b(ceo|founder|co-founder|president|owner|managing director)\b/.test(t))
    return 'Frame around market differentiation, investor narrative, and the compounding value of brand clarity at this stage of growth.';
  if (/\b(cmo|chief marketing|vp market|head of market|brand|marketing director)\b/.test(t))
    return 'Frame around brand strategy, positioning clarity, and building a complete brand presence the team can execute against.';
  if (/\b(cpo|chief product|vp product|product|cto|chief tech)\b/.test(t))
    return 'Frame around product-market fit storytelling, launch positioning, and translating technical value into language the market understands.';
  if (/\b(cro|chief revenue|vp sales|sales|revenue|business dev)\b/.test(t))
    return 'Frame around how brand clarity shortens sales cycles, improves win rates, and gives the team stronger tools to close.';
  if (/\b(people|hr|talent|culture|chief people)\b/.test(t))
    return 'Frame around employer brand and how clear brand identity drives talent attraction and culture cohesion during rapid growth.';
  if (/\b(coo|chief operating|operations)\b/.test(t))
    return 'Frame around how brand clarity reduces internal misalignment, speeds up decisions, and creates consistency at scale.';
  return 'Frame around brand strategy, positioning, and the value of getting the message right at this stage of growth.';
}

const ENGAGEMENT_SCAN_GUIDE = `recommendedEngagement: Use a two-step process — establish a BASELINE from headcount, then adjust UP based on need-state signals.

STEP 1 — BASELINE from employeeCountNum (estimate confidently if unknown):
- < 15 employees → Sprint
- 15–49 → Foundation
- 50–149 → Growth
- 150–499 → Acceleration
- 500+ → Enterprise

STEP 2 — NEED-STATE UPLIFT (triggers that signal larger brand work is required):
Each of the following shifts the baseline UP by one tier (stack up to +2 tiers max):
- New CEO, CMO, CCO, Chief Brand Officer, or VP Marketing hired → repositioning signal (+1)
- Series B or higher funding round closed → brand catching up to growth (+1)
- Entering a new market, geography, or customer segment → GTM positioning needed (+1)
- Major product launch, platform rebrand, or new vertical announced → positioning work (+1)
- Rapid commercial team expansion (multiple sales/marketing hires) → scaling signal (+1)
- Acquisition, merger, or spin-off → brand consolidation needed (+1 or +2)
- Drug approval, FDA clearance, CE mark, or major regulatory milestone → commercial acceleration (+2)
- IPO filed or announced → full brand transformation needed (+2)

EXAMPLES:
- 30-person SaaS co (baseline: Foundation) + new CMO hired → Growth
- 80-person biotech (baseline: Growth) + FDA approval → Enterprise
- 45-person Series B fintech (baseline: Foundation) + entering US market → Acceleration
- 200-person company (baseline: Acceleration) + no major triggers → Acceleration

Sprint is valid for small early-stage companies with no major signals. But for any company with a meaningful trigger, Sprint is rarely the right answer regardless of size.
IMPORTANT: Write recommendedAngle and all contactAngles specifically for the recommendedEngagement you chose. Do NOT use Sprint-specific language unless Sprint is the recommendedEngagement.`;

// ── ICP / Signal Watch scanning ──────────────────────────────────────────────

import { buildIcpProfile, DEFAULT_ICP, buildBrandContext, DEFAULT_BRAND_BRAIN, loadBrandBrain } from './settings';

// ── Brand Brain cache ─────────────────────────────────────────────────────────
// Loaded once per app session and reused across all AI calls.
let _brainCache = null;
async function getBrandContext() {
  if (!_brainCache) _brainCache = await loadBrandBrain().catch(() => DEFAULT_BRAND_BRAIN);
  return buildBrandContext(_brainCache);
}
// Call this from Settings after a save so the next scan picks up changes.
export function invalidateBrandCache() { _brainCache = null; }

const INDUSTRY_GUIDE = `industry: Classify using exactly one of these values:
"Agriculture" (farming, forestry, fishing, hunting)
"Mining & Energy" (mining, quarrying, oil and gas extraction)
"Utilities" (electric, water, gas utilities)
"Construction" (building, infrastructure, specialty trades)
"Manufacturing" (food, textiles, chemicals, machinery, electronics, hardware)
"Wholesale & Retail" (automotive, building materials, e-commerce, consumer goods)
"Transportation" (airlines, trucking, postal, warehousing, logistics)
"Information & Tech" (software, SaaS, broadcasting, publishing, telecommunications)
"Finance & Insurance" (banking, investment, wealth management, insurance, fintech)
"Real Estate" (property management, rental, leasing)
"Professional Services" (legal, accounting, architecture, engineering, consulting, marketing agencies)
"Management" (holding companies, corporate management)
"Administrative Services" (staffing, facilities management, waste management)
"Education" (schools, training, e-learning, edtech)
"Healthcare" (hospitals, nursing, childcare, medical devices, healthtech, biotech)
"Arts & Entertainment" (performing arts, museums, sports, media production)
"Hospitality & Food" (hotels, restaurants, catering, food service)
"Other Services" (repair, personal care, religious, civic organizations)
"Government" (public administration, military, public safety)`;

function buildBatchSystem(icp, brandCtx = '') {
  const profile = buildIcpProfile(icp);
  return `Sales intelligence analyst scoring companies for Part Human outreach.
${brandCtx ? `${brandCtx}\n\n` : ''}${profile}
NEVER use em dashes (—) anywhere in your response. Use commas or periods instead.
Return ONLY a JSON array, same order as input. Short strings only.
Each object schema:
{"companyName":"str","website":"https://domain.com or null — only include if you are confident this is correct, never guess","hq":"City, State or City, Country — the company headquarters location","industry":"str","recommendedEngagement":"Sprint|Foundation|Growth|Acceleration|Enterprise","overallScore":1-10,"icpScore":1-10,"icpReason":"max 15 words","icpTier":"Ambitious Scale-Up|Category Challenger|Innovation Team","fundingStage":"Seed|Series A|Series B|Series C|Series D+|Unknown","employeeCountNum":integer_or_null,"summary":"max 25 words","triggers":[{"category":"leadership|funding|expansion|product|pain|hiring","headline":"max 8 words","detail":"max 20 words","urgency":"high|medium|low","source":"str","date":"str"}],"recommendedAngle":"max 30 words","contactAngles":[{"name":"str","title":"str","angle":"max 30 words"}],"lat":number_or_null,"lng":number_or_null,"noNewsFound":false}
${ENGAGEMENT_SCAN_GUIDE}
For hq: if a headquarters location is provided in the input, use it exactly. If not provided, identify the company's headquarters city from your knowledge (e.g. "Austin, TX" or "London, UK"). Return your best guess — do not leave blank.
For lat/lng: geocode the hq field you just determined. ALWAYS base lat/lng on the hq location, not the company's general reputation or country of origin. Return null only if truly unknown.
For website: return the company's primary domain if you know it with confidence. Return null if unsure — do not guess.
${INDUSTRY_GUIDE}
If contacts listed, populate contactAngles per contact tailored to their role.
If unknown company: noNewsFound:true, triggers:[], overallScore:3, icpScore:3, lat:null, lng:null.
CRITICAL: JSON array only. No markdown.`;
}

function buildDeepSystem(icp, brandCtx = '') {
  const profile = buildIcpProfile(icp);
  return `B2B sales intelligence analyst. Search the web AND social media for very recent signals about this company.
${brandCtx ? `\n${brandCtx}\n` : ''}

Sources to check:
- LinkedIn: company page posts, executive posts, job postings, follower growth
- Twitter/X: company and executive account posts, mentions
- News: press releases, TechCrunch, Forbes, local business press
- Job boards: Greenhouse, Lever, LinkedIn Jobs — rapid hiring signals brand/marketing need

Trigger categories to surface:
- leadership: new CEO/CMO/CCO/VP Marketing hired or departed
- funding: seed, Series A/B/C/D, acquisition, merger
- expansion: new office, new market, headcount growth
- product: launch, rebrand, major update, new vertical
- hiring: open brand/marketing/comms roles — strong signal they need help
- pain: layoffs, restructuring, missed targets, negative press
- social: exec posts about brand challenges, growth goals, or culture shifts

${profile}
For each contact listed, search for their LinkedIn profile URL (linkedin.com/in/...) and check it for recent posts. Also find the company's LinkedIn page URL (linkedin.com/company/...) and check it for recent posts, announcements, or hiring activity. While on the company LinkedIn page, look for other people who list this company as their employer — especially founders, C-suite, VPs, and marketing/brand/comms leaders.

CRITICAL RULE FOR LINKEDIN URLs: NEVER construct or guess a LinkedIn URL from a person's name (e.g. do NOT assume linkedin.com/in/firstname-lastname). Only include a linkedinUrl if that exact URL appeared in your actual web search results. If you did not find the URL in search results, set linkedinUrl to null. A missing URL is far better than a wrong one.
NEVER use em dashes (—) anywhere in your response. Use commas or periods instead.
Return ONLY valid JSON object, no markdown:
{"companyName":"str","website":"https://domain.com or null","companyLinkedinUrl":"https://linkedin.com/company/... or null","scanDate":"today","hq":"City, State or City, Country — confirmed headquarters location","industry":"str","recommendedEngagement":"Sprint|Foundation|Growth|Acceleration|Enterprise","overallScore":1-10,"icpScore":1-10,"icpReason":"str","icpTier":"str","fundingStage":"Seed|Series A|Series B|Series C|Series D+|Unknown","employeeCountNum":integer_or_null,"summary":"2-3 sentences","triggers":[{"category":"str","headline":"str","detail":"str","urgency":"str","source":"str","date":"str"}],"recommendedAngle":"str","contactAngles":[{"name":"str","title":"str","angle":"str","linkedinUrl":"https://linkedin.com/in/... or null"}],"discoveredContacts":[{"name":"str","title":"str","linkedinUrl":"https://linkedin.com/in/... or null"}],"lat":number_or_null,"lng":number_or_null,"noNewsFound":false}
${INDUSTRY_GUIDE}
${ENGAGEMENT_SCAN_GUIDE}
discoveredContacts: people you found working at this company who were NOT in the provided contact list. Max 5. Only include if found with confidence. For all linkedinUrl fields: only include URLs that appeared explicitly in your search results — never construct them from names.
For hq: search for and confirm the company's actual headquarters city. Use the provided HQ if given, otherwise find it. Format as "City, State" (US) or "City, Country" (international).
For lat/lng: geocode the hq field. ALWAYS base lat/lng on the confirmed hq location.
For website: search for and return the company's actual primary website URL. Verify it exists.`;
}

// ── HQ geocode batch — lightweight, no scoring ───────────────────────────────
export async function geocodeHqBatch(companies) {
  const list = companies.map((c, i) =>
    `${i + 1}. ${c.name}${c.website ? ` (${c.website})` : ''}`
  ).join('\n');

  const data = await withTimeout(
    callClaude({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 4000,
      system: `You are a geocoding assistant. For each company, identify its headquarters city and return coordinates.
Return ONLY a JSON array, same order as input.
Each object: {"name":"str","hq":"City, State or City, Country","lat":number_or_null,"lng":number_or_null}
Use your knowledge of where each company is actually headquartered. Format US cities as "City, ST", international as "City, Country".
If you genuinely don't know a company, set hq to null and lat/lng to null.
CRITICAL: JSON array only. No markdown.`,
      messages: [{ role: 'user', content: `Identify headquarters for these companies:\n${list}` }],
    }),
    60000
  );

  const text = data.content?.find(b => b.type === 'text')?.text || '';
  const fenceStripped = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();
  const arrStart = fenceStripped.indexOf('[');
  const arrEnd = fenceStripped.lastIndexOf(']');
  if (arrStart === -1) return [];
  return JSON.parse(fenceStripped.slice(arrStart, arrEnd + 1));
}

export async function scanBatch(companies, icp = DEFAULT_ICP) {
  const brandCtx = await getBrandContext();
  const list = companies.map((c, i) => {
    const contactList = (c.contacts || [])
      .map(ct => [ct.name, ct.title].filter(Boolean).join(' / '))
      .join('; ');
    return `${i + 1}. ${c.name}${c.website ? ` (${c.website})` : ''}${c.hq ? ` — HQ: ${c.hq}` : ''}${contactList ? ` — contacts: ${contactList}` : ''}`;
  }).join('\n');

  const data = await withTimeout(
    callClaude({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 10000,
      system: buildBatchSystem(icp, brandCtx),
      messages: [{ role: 'user', content: `Analyze for B2B trigger events:\n${list}` }],
    }),
    TIMEOUT_MS
  );

  const text = data.content?.find(b => b.type === 'text')?.text || '';
  const fenceStripped = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();
  const arrStart = fenceStripped.indexOf('[');
  const arrEnd   = fenceStripped.lastIndexOf(']');
  if (arrStart === -1) throw new Error('No JSON array found in batch scan response');
  const slice = arrEnd !== -1 ? fenceStripped.slice(arrStart, arrEnd + 1) : fenceStripped.slice(arrStart);
  try {
    return JSON.parse(slice);
  } catch {
    // Response was truncated or contains a bad element — recover complete top-level objects
    const recovered = [];
    let depth = 0, objStart = -1;
    for (let i = 0; i < slice.length; i++) {
      const ch = slice[i];
      if (ch === '{') { if (depth === 0) objStart = i; depth++; }
      else if (ch === '}') {
        depth--;
        if (depth === 0 && objStart !== -1) {
          try { recovered.push(JSON.parse(slice.slice(objStart, i + 1))); } catch { /* skip */ }
          objStart = -1;
        }
      }
    }
    if (recovered.length === 0) throw new Error('Batch scan returned unparseable JSON');
    return recovered;
  }
}

function buildWeeklySystem(icp, brandCtx = '') {
  const profile = buildIcpProfile(icp);
  return `Sales intelligence analyst doing a weekly refresh scan for Part Human.
${brandCtx ? `${brandCtx}\n\n` : ''}${profile}
Focus: what has CHANGED or is NEW in the last 30 days — leadership moves, funding rounds, product launches, layoffs, expansions, key hires. Adjust scores up if new positive triggers exist.
Return ONLY a JSON array, same order as input. Short strings only.
Each object schema:
{"companyName":"str","industry":"str","recommendedEngagement":"Sprint|Foundation|Growth|Acceleration|Enterprise","overallScore":1-10,"icpScore":1-10,"scoreChanged":true|false,"triggers":[{"category":"leadership|funding|expansion|product|pain|hiring","headline":"max 8 words","detail":"max 20 words","urgency":"high|medium|low","source":"str","date":"str"}],"recommendedAngle":"max 30 words","noNewsFound":false}
scoreChanged: true only if you are aware of meaningful new developments in the last 30 days that would change outreach priority.
If nothing new: scoreChanged:false, triggers:[], keep scores similar to before.
${INDUSTRY_GUIDE}
${ENGAGEMENT_SCAN_GUIDE}
CRITICAL: JSON array only. No markdown.`;
}

export async function weeklyRescanBatch(companies, icp = DEFAULT_ICP) {
  const brandCtx = await getBrandContext();
  const list = companies.map((c, i) =>
    `${i + 1}. ${c.name}${c.website ? ` (${c.website})` : ''}${c.hq ? ` — HQ: ${c.hq}` : ''} [current SIG: ${c.overall_score || '?'}, ICP: ${c.icp_score || '?'}]`
  ).join('\n');

  const data = await withTimeout(
    callClaude({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 8000,
      system: buildWeeklySystem(icp, brandCtx),
      messages: [{ role: 'user', content: `Weekly refresh — check for new developments:\n${list}` }],
    }),
    TIMEOUT_MS
  );

  const text = data.content?.find(b => b.type === 'text')?.text || '';
  const fenceStripped = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();
  const arrStart = fenceStripped.indexOf('[');
  const arrEnd   = fenceStripped.lastIndexOf(']');
  if (arrStart === -1) throw new Error('No JSON array found in weekly rescan response');
  const slice = arrEnd !== -1 ? fenceStripped.slice(arrStart, arrEnd + 1) : fenceStripped.slice(arrStart);
  try {
    return JSON.parse(slice);
  } catch {
    const recovered = [];
    let depth = 0, objStart = -1;
    for (let i = 0; i < slice.length; i++) {
      const ch = slice[i];
      if (ch === '{') { if (depth === 0) objStart = i; depth++; }
      else if (ch === '}') {
        depth--;
        if (depth === 0 && objStart !== -1) {
          try { recovered.push(JSON.parse(slice.slice(objStart, i + 1))); } catch { /* skip */ }
          objStart = -1;
        }
      }
    }
    if (recovered.length === 0) throw new Error('Weekly rescan returned unparseable JSON');
    return recovered;
  }
}

export async function scanDeepDive(company, icp = DEFAULT_ICP, existingEngagementType = null, clientDetail = {}) {
  const brandCtx = await getBrandContext();
  const contacts = company.contacts || [];
  const contactStr = contacts
    .map(ct => {
      const parts = [ct.name, ct.title].filter(Boolean).join(' / ');
      return ct.linkedin ? `${parts} (${ct.linkedin})` : parts;
    })
    .filter(Boolean).join('; ');

  const contactsWithLinkedIn = contacts.filter(ct => ct.linkedin);
  const contactsWithoutLinkedIn = contacts.filter(ct => !ct.linkedin && ct.name);

  const linkedInClause = contactsWithLinkedIn.length
    ? ` Check these specific LinkedIn profiles for recent posts: ${contactsWithLinkedIn.map(ct => `${ct.name} (${ct.linkedin})`).join(', ')}.`
    : '';
  const nameSearchClause = contactsWithoutLinkedIn.length
    ? ` Also search LinkedIn and Twitter/X for recent posts by: ${contactsWithoutLinkedIn.map(ct => `"${ct.name}" ${company.name}`).join(', ')}.`
    : '';

  const websiteKnown = !!company.website;

  // ── Build full internal context from clientDetail ──────────────────────────
  const ctxLines = [];

  // Research notes & links
  const items = clientDetail.items || [];
  if (items.length > 0) {
    ctxLines.push('RESEARCH NOTES & LINKS:');
    items.forEach(it => {
      if (it.type === 'note') ctxLines.push(`  - Note: ${it.body || it.title}`);
      else ctxLines.push(`  - Link: ${it.title}${it.url ? ` (${it.url})` : ''}${it.body ? ` — ${it.body}` : ''}`);
    });
  }

  // Projects
  const projects = clientDetail.projects || [];
  if (projects.length > 0) {
    ctxLines.push('PROJECTS WE\'VE RUN FOR THEM:');
    projects.forEach(p => {
      ctxLines.push(`  - ${p.name} (${p.archived_at ? 'archived' : p.status}) started ${p.start_date || 'unknown'}${p.description ? `: ${p.description}` : ''}`);
    });
  }

  // Meetings
  const meetings = clientDetail.meetings || [];
  if (meetings.length > 0) {
    ctxLines.push('MEETING HISTORY:');
    meetings.slice(0, 10).forEach(m => {
      ctxLines.push(`  - [${m.meeting_date || 'no date'}] ${m.title || 'Meeting'}${m.summary ? `: ${m.summary}` : ''}`);
      if (m.transcript) ctxLines.push(`    Transcript excerpt: ${m.transcript.slice(0, 400)}…`);
    });
  }

  // Activities
  const activities = clientDetail.activities || [];
  if (activities.length > 0) {
    ctxLines.push('ACTIVITY HISTORY (calls, emails, notes):');
    activities.slice(0, 15).forEach(a => {
      ctxLines.push(`  - [${a.activity_date}] ${a.type}${a.assigned_to ? ` (${a.assigned_to})` : ''}: ${a.summary}`);
    });
  }

  const internalContext = ctxLines.length > 0
    ? `\n\nINTERNAL CONTEXT (use this to inform your analysis — factor into summary, recommended angle, triggers, and contact angles):\n${ctxLines.join('\n')}`
    : '';

  const data = await withTimeout(
    callClaude({
      model: 'claude-sonnet-4-6',
      max_tokens: 4000,
      system: buildDeepSystem(icp, brandCtx),
      tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 6 }],
      messages: [{
        role: 'user',
        content: `Do a deep scan on ${company.name}${company.website ? ` (${company.website})` : ''}.

STEP 1 — FIND LEADERSHIP CONTACTS: Search "${company.name} leadership team" or "${company.name} about us" or their website team page. Find the CEO, CMO, VP Marketing, Head of Brand, or equivalent decision-makers. For each person found, record their name, title, and LinkedIn URL (linkedin.com/in/...). Add them to the contactAngles array with a tailored outreach angle. This step is mandatory even if we have no contacts on file.

STEP 2 — TRIGGER EVENTS: Check company news, LinkedIn company page, Twitter/X, and job boards (brand/marketing/comms roles). Find up to 3 trigger events from the last 90 days — growth, brand changes, team changes, or challenges.${linkedInClause}${nameSearchClause}

STEP 3 — ENRICH EXISTING CONTACTS: ${contactStr ? `For these known contacts, find/confirm their LinkedIn URL: ${contactStr}.` : 'No existing contacts — rely on Step 1 discoveries.'}

${!websiteKnown ? 'Also find their website URL.' : ''}${existingEngagementType ? ` Engagement type is already "${existingEngagementType}" — keep it unless the profile clearly warrants a change.` : ''}${internalContext}

Return JSON only.`,
      }],
    }),
    TIMEOUT_MS
  );

  // Search ALL text blocks from last to first for one containing JSON
  const textBlocks = (data.content || []).filter(b => b.type === 'text');
  let jsonObj = null;
  for (let i = textBlocks.length - 1; i >= 0; i--) {
    const raw = textBlocks[i]?.text || '';
    const stripped = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();
    const s = stripped.indexOf('{');
    const e = stripped.lastIndexOf('}');
    if (s !== -1 && e !== -1) {
      try { jsonObj = JSON.parse(stripped.slice(s, e + 1)); break; } catch { /* try next block */ }
    }
  }
  if (!jsonObj) throw new Error('No JSON found in deep scan response');
  return jsonObj;
}

// ── Build Company Thesis — multi-phase deep research ─────────────────────────
// onProgress(phase 1-4, status 'running'|'done'|'error', data)
// clientDetail = { projects, meetings, activities, items }

function extractJsonBlock(data, type = 'object') {
  const open = type === 'object' ? '{' : '[';
  const close = type === 'object' ? '}' : ']';
  const blocks = (data.content || []).filter(b => b.type === 'text');
  for (let i = blocks.length - 1; i >= 0; i--) {
    const raw = blocks[i]?.text || '';
    const stripped = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();
    const s = stripped.indexOf(open);
    const e = stripped.lastIndexOf(close);
    if (s !== -1 && e !== -1) {
      try { return JSON.parse(stripped.slice(s, e + 1)); } catch { /* try next */ }
    }
  }
  return null;
}

function buildClientContext(clientDetail) {
  const lines = [];
  const { projects = [], meetings = [], activities = [], items = [], files = [] } = clientDetail;
  if (projects.length) {
    lines.push('PROJECTS:');
    projects.forEach(p => lines.push(`  - ${p.name} (${p.archived_at ? 'archived' : p.status})${p.description ? ': ' + p.description : ''}`));
  }
  if (meetings.length) {
    lines.push('MEETINGS:');
    meetings.slice(0, 8).forEach(m => {
      lines.push(`  - [${m.meeting_date || 'no date'}] ${m.title || 'Meeting'}${m.summary ? ': ' + m.summary : ''}`);
      if (m.transcript) lines.push(`    Excerpt: ${m.transcript.slice(0, 300)}…`);
    });
  }
  if (activities.length) {
    lines.push('ACTIVITIES:');
    activities.slice(0, 12).forEach(a => lines.push(`  - [${a.activity_date}] ${a.type}: ${a.summary}`));
  }
  if (items.length) {
    lines.push('RESEARCH NOTES & LINKS:');
    items.forEach(it => {
      if (it.type === 'note') lines.push(`  - Note: ${it.body || it.title}`);
      else lines.push(`  - Link: ${it.title}${it.url ? ' (' + it.url + ')' : ''}${it.body ? ' — ' + it.body : ''}`);
    });
  }
  if (files.length) {
    lines.push('SHARED DOCUMENTS (files attached to this deal):');
    files.forEach(f => {
      const ctx = f.task_title ? ` — sent with task: "${f.task_title}"` : '';
      lines.push(`  - "${f.name}"${ctx}`);
    });
  }
  return lines.join('\n');
}

export async function buildCompanyThesis(company, icp, clientDetail = {}, onProgress = () => {}) {
  const PHASE_TIMEOUT = 150000; // 2.5 min per phase
  const name = company.name;
  const site = company.website || '';
  const internalCtx = buildClientContext(clientDetail);

  // Research materials attached by the sales team
  const researchItems = company.research_items || [];
  const researchLinks = researchItems.filter(i => i.url);
  const researchDocs  = researchItems.filter(i => i.body);

  // ── Phase 1: Company foundation + full leadership discovery ───────────────
  onProgress(1, 'running', null, `Starting research on ${name}…`);
  onProgress(1, 'log', null, `Searching "${name} team" and "${name} leadership"…`);
  if (site) onProgress(1, 'log', null, `Checking website: ${site}/about and /team pages…`);
  onProgress(1, 'log', null, `Looking up LinkedIn company page for ${name}…`);
  if (researchLinks.length > 0) onProgress(1, 'log', null, `Reading ${researchLinks.length} attached link${researchLinks.length > 1 ? 's' : ''}: ${researchLinks.map(i => i.title || i.url).join(', ')}`);

  const p1LinkTask = researchLinks.length > 0
    ? `\n\nTASK C — The sales team has flagged these URLs as important context. Visit and extract key information from each:\n${researchLinks.map(i => `- ${i.title ? `"${i.title}": ` : ''}${i.url}`).join('\n')}`
    : '';

  const p1raw = await withTimeout(callClaude({
    model: 'claude-sonnet-4-6',
    max_tokens: 3000,
    system: 'You are a B2B research analyst. Search thoroughly. Return only valid JSON, no markdown.',
    tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: researchLinks.length > 0 ? 7 : 5 }],
    messages: [{ role: 'user', content:
`Research ${name}${site ? ` (${site})` : ''} thoroughly. Do at least 2 searches.

TASK A — Company overview: Confirm website URL, HQ city/country, employee count, funding stage, industry, founding year, what they do in 2-3 sentences.

TASK B — Leadership team: Search "${name} team", "${name} leadership", and their website /about or /team page AND their LinkedIn company page. Find every C-suite and VP-level person especially: CEO, CMO, VP/Director of Marketing, VP/Head of Brand, Head of Communications, Creative Director, Chief Brand Officer. For each person record their full name, exact title, and LinkedIn profile URL (only if you actually found it in search results — never construct one).${p1LinkTask}

Return JSON only:
{"website":"str","hq":"City, State/Country","employee_count_num":number_or_null,"funding_stage":"str","industry":"str","description":"str","leaders":[{"name":"str","title":"str","linkedin":"url_or_null","email":"str_or_null"}]}`
    }],
  }), PHASE_TIMEOUT);

  const p1 = extractJsonBlock(p1raw) || {};
  const leaders = p1.leaders || [];
  if (p1.hq || p1.industry)
    onProgress(1, 'log', null, `Company confirmed: ${[p1.hq, p1.industry, p1.employee_count_num ? p1.employee_count_num + ' employees' : null, p1.funding_stage].filter(Boolean).join(' · ')}`);
  if (leaders.length > 0) {
    onProgress(1, 'log', null, `Found ${leaders.length} leaders: ${leaders.map(l => `${l.name} (${l.title})`).join(', ')}`);
    leaders.forEach(l => {
      onProgress(1, 'log', null, `  ${l.linkedin ? '✓ LinkedIn found' : '  No LinkedIn'} · ${l.name}, ${l.title}`);
    });
  } else {
    onProgress(1, 'log', null, `No leaders found on first pass — will search further in Phase 2`);
  }
  onProgress(1, 'done', { leaders: leaders.length }, `Phase 1 complete — ${leaders.length} leaders identified`);

  // ── Phase 2: Per-contact signal mining ───────────────────────────────────
  onProgress(2, 'running', null, `Mining signals for ${leaders.length} contacts…`);

  const knownContacts = company.contacts || [];
  const seenNames = new Set(knownContacts.map(c => c.name?.toLowerCase()));
  const allContacts = [
    ...knownContacts,
    ...leaders.filter(l => l.name && !seenNames.has(l.name.toLowerCase())),
  ];

  allContacts.forEach(c => onProgress(2, 'log', null, `Searching LinkedIn + web for ${c.name}, ${c.title || 'unknown title'}…`));

  let p2contacts = allContacts;
  if (allContacts.length > 0) {
    const contactList = allContacts
      .map(c => `${c.name}${c.title ? ', ' + c.title : ''}${c.linkedin ? ' — ' + c.linkedin : ''}`)
      .join('\n');
    const p2raw = await withTimeout(callClaude({
      model: 'claude-sonnet-4-6',
      max_tokens: 3500,
      system: 'You are a sales intelligence researcher. Return only valid JSON, no markdown.',
      tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 6 }],
      messages: [{ role: 'user', content:
`For each of these ${name} leaders, search LinkedIn and the web for recent activity (last 90 days). Find their most recent posts, interviews, podcasts, articles, or public statements about: brand, growth, company direction, team challenges, product, culture, or hiring.

Also confirm or find each person's LinkedIn URL and email if publicly available.

Leaders to research:
${contactList}

Return JSON only:
{"contacts":[{"name":"str","title":"str","linkedin":"url_or_null","email":"str_or_null","signals":[{"headline":"max 12 words","summary":"2-3 sentences: what they said and why it matters for a brand conversation","date":"str_or_null","url":"str_or_null","category":"leadership|expansion|product|pain|hiring|social"}]}]}`
      }],
    }), PHASE_TIMEOUT);
    p2contacts = extractJsonBlock(p2raw)?.contacts || allContacts;

    // Log what was found per contact
    p2contacts.forEach(c => {
      const sigCount = (c.signals || []).length;
      if (sigCount > 0) {
        onProgress(2, 'log', null, `${c.name}: ${sigCount} signal${sigCount !== 1 ? 's' : ''} found`);
        (c.signals || []).forEach(s => onProgress(2, 'log', null, `    "${s.headline}" (${s.category || 'signal'}${s.date ? ', ' + s.date : ''})`));
      } else {
        onProgress(2, 'log', null, `${c.name}: no recent public activity found`);
      }
    });
  } else {
    onProgress(2, 'log', null, `No contacts to research — skipping signal mining`);
  }

  const totalSignals = p2contacts.reduce((n, c) => n + (c.signals || []).length, 0);
  onProgress(2, 'done', { contacts: p2contacts.length }, `Phase 2 complete — ${totalSignals} signals across ${p2contacts.length} contacts`);

  // ── Phase 3: Trigger events, job postings, competitive context ────────────
  onProgress(3, 'running', null, `Scanning news, job postings, and competitive landscape…`);
  onProgress(3, 'log', null, `Searching "${name} news" and "${name} funding" last 90 days…`);
  onProgress(3, 'log', null, `Checking "${name} careers" and LinkedIn Jobs for brand/marketing roles…`);
  onProgress(3, 'log', null, `Looking up competitors and market positioning…`);

  const p3raw = await withTimeout(callClaude({
    model: 'claude-sonnet-4-6',
    max_tokens: 3000,
    system: 'You are a sales intelligence researcher. Return only valid JSON, no markdown.',
    tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 4 }],
    messages: [{ role: 'user', content:
`Find recent intelligence for ${name}${site ? ` (${site})` : ''} — last 90 days.

Search 1: Company news, press releases, funding announcements, acquisitions, product launches, rebrands, awards, conference speaking
Search 2: Open job postings in brand, marketing, creative, or communications roles (search LinkedIn Jobs or their careers page) — rapid hiring signals investment in those areas
Search 3: Competitive landscape — who are their top 2-3 direct competitors? How does ${name} differentiate?

Return JSON only:
{"triggers":[{"headline":"str","detail":"str","category":"leadership|funding|expansion|product|pain|hiring|social","urgency":"high|medium|low","date":"str_or_null","url":"str_or_null"}],"job_postings":[{"title":"str","signal":"why this matters for a brand agency conversation"}],"competitors":["str"],"market_position":"1-2 sentences on how they compete"}`
    }],
  }), PHASE_TIMEOUT);

  const p3 = extractJsonBlock(p3raw) || {};
  (p3.triggers || []).forEach(t => onProgress(3, 'log', null, `Trigger [${t.urgency || 'medium'}]: ${t.headline}`));
  (p3.job_postings || []).forEach(j => onProgress(3, 'log', null, `Open role: ${j.title}`));
  if ((p3.competitors || []).length > 0) onProgress(3, 'log', null, `Competitors: ${p3.competitors.join(', ')}`);
  onProgress(3, 'done', { triggers: (p3.triggers || []).length }, `Phase 3 complete — ${(p3.triggers || []).length} triggers, ${(p3.job_postings || []).length} open roles`);

  // ── Phase 4: Full thesis synthesis ───────────────────────────────────────
  const dataPoints = leaders.length + totalSignals + (p3.triggers || []).length;
  onProgress(4, 'running', null, `Synthesising thesis from ${dataPoints} data points…`);
  onProgress(4, 'log', null, `Building ICP fit assessment…`);
  onProgress(4, 'log', null, `Identifying primary entry contact and outreach hook…`);
  onProgress(4, 'log', null, `Writing supporting contact angles…`);
  onProgress(4, 'log', null, `Assessing risks and sensitivities…`);
  if (internalCtx) onProgress(4, 'log', null, `Incorporating internal relationship context…`);
  onProgress(4, 'log', null, `Composing full thesis narrative…`);

  const icpProfile = buildIcpProfile(icp);
  const brandCtx = await getBrandContext();
  const p4raw = await withTimeout(callClaude({
    model: 'claude-sonnet-4-6',
    max_tokens: 6000,
    system: `You are a senior brand strategist at Part Human, a brand strategy agency. Your job is to synthesise research into a precise sales thesis. Return only valid JSON, no markdown.\n\n${brandCtx}\n\n${icpProfile}`,
    messages: [{ role: 'user', content:
`Synthesise all research into a complete sales thesis for ${name}.

COMPANY PROFILE:
${JSON.stringify({ website: p1.website, hq: p1.hq, employees: p1.employee_count_num, funding: p1.funding_stage, industry: p1.industry, description: p1.description }, null, 2)}

LEADERSHIP & PERSONAL SIGNALS:
${JSON.stringify(p2contacts, null, 2)}

TRIGGER EVENTS & COMPETITIVE:
${JSON.stringify(p3, null, 2)}

${internalCtx ? `OUR EXISTING RELATIONSHIP:\n${internalCtx}\n` : ''}
${researchDocs.length > 0 ? `RESEARCH MATERIALS (provided by the sales team — treat as high-confidence primary source intel):\n${researchDocs.map(i => `[${(i.type || 'doc').toUpperCase()}${i.title ? ` — ${i.title}` : ''}]\n${i.body}`).join('\n\n')}\n` : ''}
${researchLinks.length > 0 ? `REFERENCE LINKS (flagged by sales team):\n${researchLinks.map(i => `- ${i.title ? `${i.title}: ` : ''}${i.url}`).join('\n')}\n` : ''}
Write a full thesis covering:
1. Why they need brand strategy help RIGHT NOW — tie to specific signals, not generic reasons
2. ICP fit and scoring
3. The single best entry point: who to contact first and exactly why, with a specific hook referencing their actual posts or news
4. Supporting angles for 2-3 other contacts
5. Risks or sensitivities to avoid
6. Recommended next action

RULES: Never use em dashes (—). Use commas or "and" instead. Only include LinkedIn URLs you actually found in the research data above — never construct them. For each trigger in your output, carry forward the matching "url" from the TRIGGER EVENTS data above if that event has one, and always fill "source" with where the trigger came from (the publication, press release, or platform named in the research above — never leave it blank if the underlying data names a source).

Return JSON only:
{
  "icp_score": 1-10,
  "icp_tier": "str",
  "overall_score": 1-10,
  "funding_stage": "str",
  "employee_count": "str",
  "employee_count_num": number_or_null,
  "hq": "str",
  "industry": "str",
  "website": "str_or_null",
  "summary": "3-4 sentence company overview",
  "thesis": "3-5 paragraph sales thesis — why Part Human, why now, why these contacts. Specific, not generic.",
  "recommended_angle": "the primary positioning hook in 1-2 sentences",
  "entry_contact": {"name":"str","title":"str","linkedin":"url_or_null","angle":"str","hook":"1-2 sentences referencing a specific post, news item, or signal"},
  "contact_angles": [{"name":"str","title":"str","linkedin":"url_or_null","angle":"str","hook":"str"}],
  "triggers": [{"headline":"str","detail":"str","category":"str","urgency":"str","date":"str_or_null","source":"str_or_null","url":"str_or_null"}],
  "risks": ["str"],
  "next_step": "str",
  "thesis_built": true
}`
    }],
  }), PHASE_TIMEOUT);

  const synthesis = extractJsonBlock(p4raw);
  if (!synthesis) throw new Error('Thesis synthesis returned no JSON');
  onProgress(4, 'done', synthesis, `Thesis written — ICP ${synthesis.icp_score ?? '?'}/10, ${synthesis.icp_tier ?? ''}`);
  return synthesis;
}

// ── LinkedIn post scan — trigger events from contact activity ─────────────────

export async function scanLinkedInPosts(contacts, companyName, existingPosts = []) {
  const namedContacts = contacts.filter(ct => ct.name);
  if (!namedContacts.length) return [];

  const maxUses = Math.min(namedContacts.length * 2, 6);
  // Contacts with URLs get direct profile links; without URLs Claude searches by name
  const contactList = namedContacts
    .map(ct => ct.linkedin
      ? `${ct.name}${ct.title ? `, ${ct.title}` : ''}: ${ct.linkedin}`
      : `${ct.name}${ct.title ? `, ${ct.title}` : ''} at ${companyName} (search for their LinkedIn profile)`)
    .join('\n');
  const existingHeadlines = existingPosts.map(p => p.headline).join('; ');

  const data = await withTimeout(
    callClaude({
      model: 'claude-sonnet-4-6',
      max_tokens: 2000,
      system: `You are a sales intelligence researcher scanning LinkedIn for B2B trigger events from decision-maker posts.

Search each contact's LinkedIn profile and recent posts. For each meaningful post found, return a structured record with enough detail that a sales rep can reference the post specifically in outreach.

Return ONLY a JSON array:
[{
  "contact_name": "exact name from list",
  "headline": "max 10 words summarizing what they posted",
  "summary": "2-3 sentences: what they said, why it signals intent, what it reveals about priorities",
  "url": "direct URL to the LinkedIn post if found, else the profile URL",
  "date": "approximate date e.g. May 2026 or null",
  "category": "leadership|funding|expansion|product|pain|hiring|social",
  "urgency": "high|medium|low",
  "is_trigger": true if this signals a buying trigger for brand/marketing services, false if just informational
}]

If no posts found for a contact, omit them. If nothing meaningful found at all, return [].
JSON array only. No markdown.`,
      tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: maxUses }],
      messages: [{
        role: 'user',
        content: `Search LinkedIn for recent posts (last 90 days) from these ${companyName} decision-makers:\n\n${contactList}\n\nFor each person, find their most relevant recent posts about: company direction, team growth, market moves, product launches, challenges, culture, or personal career updates that signal business intent.\n\nCapture the post content, URL, and why it matters for a brand strategy conversation.${existingHeadlines ? `\n\nAlready have these — skip duplicates: ${existingHeadlines}` : ''}\n\nReturn JSON array of post records.`,
      }],
    }),
    TIMEOUT_MS
  );

  const textBlocks = (data.content || []).filter(b => b.type === 'text');
  for (let i = textBlocks.length - 1; i >= 0; i--) {
    const raw = textBlocks[i]?.text || '';
    const stripped = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();
    const s = stripped.indexOf('[');
    const e = stripped.lastIndexOf(']');
    if (s !== -1 && e !== -1) {
      try { return JSON.parse(stripped.slice(s, e + 1)); } catch { /* try next */ }
    }
  }
  return [];
}

// ── Contact enrichment via web search ────────────────────────────────────────

export async function enrichContactsWithSearch(contacts, companyName) {
  // Only process contacts that are missing email or LinkedIn
  const toEnrich = contacts.filter(c => c.name && (!c.email || !c.linkedin));
  if (!toEnrich.length) return contacts;

  const maxUses = Math.min(toEnrich.length * 2, 8);

  const contactList = toEnrich.map((c, i) =>
    `${i + 1}. ${c.name}${c.title ? `, ${c.title}` : ''} at ${companyName}` +
    `${c.email ? '' : ' [email: MISSING]'}` +
    `${c.linkedin ? '' : ' [LinkedIn: MISSING]'}`
  ).join('\n');

  const data = await withTimeout(
    callClaude({
      model: 'claude-sonnet-4-6',
      max_tokens: 2000,
      system: `You are a B2B contact researcher. Search the web to find professional email addresses and LinkedIn profile URLs for specific people at named companies.

CRITICAL RULES:
- Only return email addresses explicitly found in public sources (company website team pages, press releases, conference bios, professional profiles). NEVER guess, infer, or construct email patterns like firstname@company.com.
- Only return LinkedIn URLs (linkedin.com/in/...) that appeared explicitly in search results. NEVER construct a URL from someone's name.
- Before returning any data, verify the person actually works at the specified company — cross-reference name AND company.
- If you cannot find verified info, return null for that field. A missing field is far better than a wrong one.
- Do NOT return generic company email addresses (info@, hello@, etc.).

Return ONLY a JSON array, same order as input:
[{"name":"str","email":"str or null","linkedinUrl":"https://linkedin.com/in/... or null","source":"brief note on where you found it, or null"}]
JSON only, no markdown.`,
      tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: maxUses }],
      messages: [{
        role: 'user',
        content: `Find missing contact info for these people. Only return data explicitly found in search results — never guess or construct anything.\n\n${contactList}\n\nFor each: search "[name] [company name]" to find their LinkedIn profile URL and any publicly listed email. Cross-reference name AND company to confirm it's the right person before returning results.\n\nReturn JSON array only.`,
      }],
    }),
    TIMEOUT_MS
  );

  // Find the last text block containing a JSON array
  const textBlocks = (data.content || []).filter(b => b.type === 'text');
  let enriched = null;
  for (let i = textBlocks.length - 1; i >= 0; i--) {
    const raw = textBlocks[i]?.text || '';
    const stripped = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();
    const s = stripped.indexOf('[');
    const e = stripped.lastIndexOf(']');
    if (s !== -1 && e !== -1) {
      try { enriched = JSON.parse(stripped.slice(s, e + 1)); break; } catch { /* try next block */ }
    }
  }

  if (!enriched?.length) return contacts;

  // Merge enriched fields back — only fill gaps, never overwrite existing data
  return contacts.map(contact => {
    if (!contact.name) return contact;
    const found = enriched.find(e => e.name?.toLowerCase().trim() === contact.name?.toLowerCase().trim());
    if (!found) return contact;
    return {
      ...contact,
      ...(found.email && !contact.email ? { email: found.email } : {}),
      ...(found.linkedinUrl && !contact.linkedin ? { linkedin: found.linkedinUrl } : {}),
    };
  });
}

// ── Email draft generation ────────────────────────────────────────────────────

const EMAIL_RULES = `
VOICE RULES (non-negotiable):
- Direct, warm, human. No jargon.
- Never use em dashes (—). Use commas, periods, or new sentences instead.
- No "I hope this finds you well." No "synergy." No "leverage." No "circle back."
- Write like a smart colleague reaching out, not a salesperson pitching.
- Short paragraphs. White space is your friend.
`;

const TOUCH_PROMPTS = {
  1: (company, contact, angle, t1Subject, engType = 'Sprint', linkedinPosts = []) => {
    const eng = ENGAGEMENT_META[engType] || ENGAGEMENT_META.Sprint;
    const roleCtx = getRoleContext(contact.title);
    const angleText = angle || company.recommended_angle || '';
    const angleNote = engType !== 'Sprint' && /sprint/i.test(angleText)
      ? `\nNOTE: The angle above was written for a Sprint engagement. Use it for context and insight only — do NOT use Sprint-specific language (e.g. "two-week sprint") in the email. The CTA must reflect the ${eng.name} engagement instead.`
      : '';
    const postContext = linkedinPosts.length
      ? `\n\nRecent LinkedIn activity from ${contact.name}:\n${linkedinPosts.map(p => `- ${p.headline}: ${p.summary}${p.url ? ` (${p.url})` : ''}`).join('\n')}\nIf any of these posts are relevant, reference them naturally in paragraph 1 instead of or alongside the trigger event — be specific, not generic.`
      : '';
    return `Write a Touch 1 cold outreach email for Part Human (brand strategy agency) to ${contact.name}, ${contact.title} at ${company.name}.

Context about ${company.name}: ${company.summary || ''}
Trigger event / outreach angle: ${angleText}${angleNote}${postContext}
Engagement type: ${eng.name} (${eng.price}, ${eng.duration}) — ${eng.hook}
Role framing: ${roleCtx}
${EMAIL_RULES}
FORMULA (4 short paragraphs, strict order):
1. TRIGGER: Acknowledge the specific trigger event or a relevant LinkedIn post. Congratulate or reference it naturally. 1-2 sentences.
2. PAIN: Name the brand gap this trigger creates. Use the role framing above to make it specific to ${contact.title}. 2 sentences.
3. HUMAN TRUTH: The real cost of that gap in human terms. Not business-speak. 2 sentences.
4. CTA: Invite to a ${eng.cta}. Reference the ${eng.name} by name. Low-pressure. 1-2 sentences.

Subject line: Short, specific, references the trigger or post. Not generic.

Return JSON: {"subject":"str","body":"str"}. Body uses \\n for line breaks between paragraphs. No markdown in body.`;
  },

  2: (company, contact, angle, t1Subject, engType = 'Sprint') => {
    const eng = ENGAGEMENT_META[engType] || ENGAGEMENT_META.Sprint;
    return `Write a Touch 2 follow-up email for Part Human. 7-day follow-up to ${contact.name}, ${contact.title} at ${company.name}.
${EMAIL_RULES}
RULES:
- Reply on the same thread. Subject line: "Re: ${t1Subject || '[original subject]'}"
- 3-4 sentences max. That's it.
- Reference the original message naturally.
- Soft CTA: ${eng.cta}.
- No new pitch. Just a gentle nudge.

Return JSON: {"subject":"Re: ${t1Subject || '[original subject]'}","body":"str"}. Body uses \\n for line breaks.`;
  },

  3: (company, contact, angle, t1Subject, engType = 'Sprint', linkedinPosts = []) => {
    const eng = ENGAGEMENT_META[engType] || ENGAGEMENT_META.Sprint;
    const postRef = linkedinPosts.length
      ? `\n\nRecent posts from ${contact.name} you can reference:\n${linkedinPosts.map(p => `- "${p.headline}" (${p.date || 'recent'}): ${p.summary}`).join('\n')}\nIn the post-acceptance DM, reference one of these specifically by name rather than using a placeholder.`
      : '';
    return `Write two LinkedIn messages for Part Human reaching out to ${contact.name}, ${contact.title} at ${company.name}.

Context: ${company.summary || ''}${t1Subject ? `\nPrevious outreach subject: "${t1Subject}"` : ''}${postRef}
Engagement context: ${eng.name} — ${eng.hook}
${EMAIL_RULES}
Message 1 — CONNECTION REQUEST NOTE (300 characters max):
- No pitch. Just context: who you are and why you're connecting.
- Reference something specific about them or their company.
- Warm, human, brief.

Message 2 — POST-ACCEPTANCE DM (after they accept):
- Reference a recent post or content they shared${linkedinPosts.length ? ' — use the specific post data provided above' : '. Use "[their recent post about X]" as placeholder'}.
- Add genuine perspective on it.
- Soft segue toward a conversation about ${eng.name.toLowerCase()}.
- 3-4 sentences max.

Return JSON: {"connection_note":"str","acceptance_dm":"str"}`;
  },

  4: (company, contact, angle, t1Subject, engType = 'Sprint') => {
    const eng = ENGAGEMENT_META[engType] || ENGAGEMENT_META.Sprint;
    return `Write a Touch 4 goodwill email for Part Human to ${contact.name}, ${contact.title} at ${company.name}. Day 21. No hard ask.

Context: ${company.summary || ''}${t1Subject ? `\nOriginal subject: "${t1Subject}". They have not replied.` : ''}
${EMAIL_RULES}
RULES:
- Share a relevant market observation or competitor move that would genuinely interest them as ${contact.title}.
- Use a placeholder like "[market observation about X]" if specific detail is needed.
- NO pitch. NO CTA. NO mention of ${eng.name}.
- Close with one line that keeps the door open without asking for anything.
- 3-4 sentences total.

Return JSON: {"subject":"str","body":"str"}. Body uses \\n for line breaks.`;
  },

  5: (company, contact, angle, t1Subject, engType = 'Sprint') => {
    const eng = ENGAGEMENT_META[engType] || ENGAGEMENT_META.Sprint;
    return `Write a Touch 5 close-the-loop email for Part Human to ${contact.name}, ${contact.title} at ${company.name}. Day 28. Final touch.
${t1Subject ? `Original outreach subject: "${t1Subject}". They have not replied to any of the previous touches.\n` : ''}${EMAIL_RULES}
RULES:
- Acknowledge the silence gracefully. No guilt, no passive aggression.
- Leave the door completely open.
- Promise a check-in next quarter, not "I'll keep reaching out."
- 2-3 sentences max.
- End on a genuinely warm note.

Return JSON: {"subject":"str","body":"str"}. Body uses \\n for line breaks.`;
  },
};

// ── Activity insight extraction ───────────────────────────────────────────────
// Breaks down a logged deal activity (a pasted email thread, call note, or
// meeting note) into a summary and concrete follow-up action items — the same
// treatment Old Gold's transcript import gives a pasted transcript, applied
// here so raw correspondence logged on a deal is just as useful.
export async function extractActivityInsights(activityText, companyName) {
  if (!activityText?.trim()) return null;

  const data = await withTimeout(callClaude({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 1200,
    system: `You are a sales operations assistant extracting structured signal from a logged CRM activity (an email thread, call note, or meeting note) for a deal with ${companyName || 'a prospect'}. Only extract what is actually present in the text — never invent dates, names, or commitments. Return only valid JSON, no markdown.`,
    messages: [{ role: 'user', content:
`Today's date is ${new Date().toISOString().slice(0, 10)} — resolve any relative dates ("this Friday", "next Monday") against that, not your training cutoff.

Read this activity and extract:
1. A concise 1-2 sentence summary of what happened or was discussed.
2. Concrete follow-up action items — only ones explicitly stated or clearly implied (e.g. "I'll send X", "let's talk Friday"). For each: a short title, an owner (first name of whoever owns it — our side or the prospect's — or null if unclear), and a due date (YYYY-MM-DD) only if a specific date/day is mentioned, otherwise null.

ACTIVITY:
${activityText.slice(0, 6000)}

Return JSON only:
{
  "summary": "...",
  "action_items": [{ "title": "...", "owner": "..." or null, "due_date": "YYYY-MM-DD" or null }]
}` }],
  }), 60000);

  return extractJsonBlock(data) || null;
}

// ── Contact dossier enrichment ────────────────────────────────────────────────
// Builds a detailed personal profile for one contact via web search.
export async function enrichContactDossier(contact, companyName) {
  const name    = contact.name;
  const title   = contact.title || '';
  const linkedin = contact.linkedin || '';

  const data = await withTimeout(callClaude({
    model: 'claude-sonnet-4-6',
    max_tokens: 3500,
    system: `You are a professional researcher building a detailed contact dossier for B2B sales intelligence. Search thoroughly using all available public sources. Only include information you actually find — never fabricate. Return only valid JSON, no markdown.`,
    tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 7 }],
    messages: [{ role: 'user', content:
`Build a comprehensive dossier on ${name}${title ? ', ' + title : ''} at ${companyName}.

${linkedin ? `Start with their LinkedIn profile: ${linkedin}` : `Search for their LinkedIn profile first: "${name}" "${companyName}" LinkedIn`}

Then search for:
1. Career history: all previous employers, titles, dates — search "${name}" "${companyName}" LinkedIn career
2. Education: schools attended, degrees, graduation years
3. Twitter/X: find their handle and recent tweets — search "${name}" site:twitter.com OR site:x.com
4. Location: city/state they live in (LinkedIn, company website bio, conference listings)
5. Interests and personal details: sports teams they support, hobbies, causes they care about — check their Twitter bio, LinkedIn featured section, and personal posts
6. Recent public activity: articles written, podcasts appeared on, conference talks, press mentions — search "${name}" "${companyName}" interview OR podcast OR "conference" OR article
7. Recent LinkedIn posts (last 90 days): what topics they post about, key themes

Only return things you actually found. Set fields to null or [] if not found.

Return JSON:
{
  "email": "str or null",
  "linkedin": "confirmed url or null",
  "twitter": "https://x.com/handle or null",
  "location": "City, State/Country or null",
  "education": [{"school":"str","degree":"str","years":"str or null"}],
  "job_history": [{"company":"str","title":"str","from":"str or null","to":"str or null","is_current":true/false}],
  "posts": [{"platform":"linkedin|twitter","headline":"10-12 word summary","summary":"2-3 sentences — what they said and what it reveals","date":"str or null","url":"str or null","category":"leadership|product|culture|personal|opinion"}],
  "articles_talks": [{"title":"str","outlet":"str or null","date":"str or null","url":"str or null"}],
  "interests": ["specific interests, causes, sports teams, hobbies found publicly"],
  "fun_facts": ["notable public facts — awards, alma mater mascot, volunteer work, etc."],
  "bio_summary": "2-3 sentence professional summary based on what you found"
}` }],
  }), 150000);

  return extractJsonBlock(data) || null;
}

export async function generateEmailDraft(touchNumber, company, contact, angle, icp = DEFAULT_ICP, t1Subject = null, engagementType = 'Sprint', linkedinPosts = []) {
  if (touchNumber === 3) throw new Error('Touch 3 is LinkedIn — use generateLinkedInDrafts() instead of generateEmailDraft()');
  const promptFn = TOUCH_PROMPTS[touchNumber];
  if (!promptFn) throw new Error(`No prompt for touch ${touchNumber}`);

  const eng = ENGAGEMENT_META[engagementType] || ENGAGEMENT_META.Sprint;
  const { outreachVoice, aboutCompany } = icp;
  const brandCtx = await getBrandContext();
  const systemContext = `You are a copywriter for Part Human. Write in their voice: direct, warm, human, no jargon. Never use em dashes (—). Return only valid JSON as specified.\n\n${brandCtx}${outreachVoice ? '\n\nVOICE GUIDANCE (additional): ' + outreachVoice : ''}\n\nENGAGEMENT CONTEXT: You are writing for a ${eng.name} engagement (${eng.price}, ${eng.duration}). ${eng.hook}.`;

  // Filter posts to just this contact
  const contactPosts = linkedinPosts.filter(p =>
    p.contact_name?.toLowerCase().trim() === contact.name?.toLowerCase().trim()
  );

  const data = await withTimeout(
    callClaude({
      model: 'claude-sonnet-4-6',
      max_tokens: 1000,
      system: systemContext,
      messages: [{ role: 'user', content: promptFn(company, contact, angle, t1Subject, engagementType, contactPosts) }],
    }),
    TIMEOUT_MS
  );

  const text = data.content?.find(b => b.type === 'text')?.text || '';
  const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();
  const s = cleaned.indexOf('{');
  const e = cleaned.lastIndexOf('}');
  if (s === -1 || e === -1) throw new Error('No JSON found in draft response');
  let result;
  try { result = JSON.parse(cleaned.slice(s, e + 1)); } catch { throw new Error('Malformed JSON in draft response'); }
  // Strip any em/en dashes that slipped through
  if (result.body) result.body = result.body.replace(/[—–]/g, ',');
  if (result.subject) result.subject = result.subject.replace(/[—–]/g, ',');
  // Append ICP email signature if one is set in settings
  if (icp.emailSignature?.trim() && result.body) {
    result.body = result.body.trimEnd() + '\n\n' + icp.emailSignature.trim();
  }
  return result;
}

export async function generateLinkedInDrafts(company, contact, t1Subject = null, engagementType = 'Sprint', linkedinPosts = [], icp = DEFAULT_ICP) {
  const eng = ENGAGEMENT_META[engagementType] || ENGAGEMENT_META.Sprint;
  const contactPosts = linkedinPosts.filter(p =>
    p.contact_name?.toLowerCase().trim() === contact.name?.toLowerCase().trim()
  );
  const data = await withTimeout(
    callClaude({
      model: 'claude-sonnet-4-6',
      max_tokens: 600,
      system: `You are a copywriter for Part Human. Write in their voice: direct, warm, human, no jargon. Never use em dashes (—). Return only valid JSON.\n\nENGAGEMENT CONTEXT: ${eng.name} (${eng.price}, ${eng.duration}). ${eng.hook}.${icp.outreachVoice ? '\n\nVOICE GUIDANCE: ' + icp.outreachVoice : ''}`,
      messages: [{ role: 'user', content: TOUCH_PROMPTS[3](company, contact, null, t1Subject, engagementType, contactPosts) }],
    }),
    TIMEOUT_MS
  );

  const text = data.content?.find(b => b.type === 'text')?.text || '';
  const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();
  const s = cleaned.indexOf('{');
  const e = cleaned.lastIndexOf('}');
  if (s === -1 || e === -1) throw new Error('No JSON found in LinkedIn draft response');
  let result;
  try { result = JSON.parse(cleaned.slice(s, e + 1)); } catch { throw new Error('Malformed JSON in LinkedIn draft response'); }
  if (result.connection_note) result.connection_note = result.connection_note.replace(/[—–]/g, ',');
  if (result.acceptance_dm) result.acceptance_dm = result.acceptance_dm.replace(/[—–]/g, ',');
  return result;
}

// ── Weekly report ─────────────────────────────────────────────────────────────

export async function generateWeeklyPlan(newCompanies, followups, icp = DEFAULT_ICP) {
  const prompt = `You are the Part Human AI sales coach. Generate this week's outreach plan summary.

NEW COMPANIES THIS WEEK (Touch 1):
${newCompanies.map(c => `- ${c.name}: ${c.recommended_angle || c.summary || 'No angle yet'}`).join('\n') || 'None'}

FOLLOW-UPS DUE:
${followups.map(f => `- ${f.companyName} (Touch ${f.touchNumber}, ${f.contactName || 'primary contact'})`).join('\n') || 'None'}

Write a brief, motivating weekly briefing for Mike and Pete using this exact structure:

**Part Human | Weekly Outreach Briefing**

**[First name greeting],**

[1-2 sentence overview of this week's pipeline health and energy.]

**Top Priorities**

[2-4 sentences of prose identifying the top 2-3 companies to lead with and why. Bold every company name using **CompanyName**. No bullet points — write in flowing paragraphs. Include any companies to skip or deprioritize if relevant.]

**Tactical Reminder**

[One sharp, specific reminder tied to the Dan Allard 5-touch cadence.]

Good hunting this week.

Keep it tight and direct. Never use em dashes.`;

  const data = await withTimeout(
    callClaude({
      model: 'claude-sonnet-4-6',
      max_tokens: 400,
      system: 'You are the Part Human AI sales coach. Be direct, warm, and useful. Never use em dashes (—).',
      messages: [{ role: 'user', content: prompt }],
    }),
    TIMEOUT_MS
  );

  const text = data.content?.find(b => b.type === 'text')?.text || '';
  return text.replace(/[—–]/g, ',');
}

// ── AI Chat ───────────────────────────────────────────────────────────────────

export async function chatWithPipeline(messages, pipelineSummary) {
  const system = `You are the Part Human AI sales assistant helping Mike Lennon and Pete Andrews manage their outreach pipeline.

PIPELINE CONTEXT:
${pipelineSummary}

ABOUT PART HUMAN:
Brand strategy agency based in Andover, MA. Entry product: "Strategic Sprint" (2-week engagement). Targets Series A/B companies, 30-100 employees, where the brand hasn't kept up with company growth.

CADENCE: 5 touches over 4 weeks per company. Touch 1: initial email. Touch 2: Day 7 follow-up. Touch 3: Day 14 LinkedIn. Touch 4: Day 21 goodwill. Touch 5: Day 28 close the loop.

Be direct, specific, and actionable. Never use em dashes (—). Reference actual companies and contacts from the pipeline when relevant.`;

  const data = await withTimeout(
    callClaude({
      model: 'claude-sonnet-4-6',
      max_tokens: 800,
      system,
      messages,
    }),
    TIMEOUT_MS
  );

  const text = data.content?.find(b => b.type === 'text')?.text || '';
  return text.replace(/[—–]/g, ',');
}

// ── Company Discovery ─────────────────────────────────────────────────────────

export async function discoverCompanies(criteria, icp = DEFAULT_ICP) {
  const profile = buildIcpProfile(icp);

  const system = `You are a B2B sales prospecting expert. Based on the ideal customer profile and search criteria, identify real companies that would be strong prospects. Return ONLY a JSON array — no markdown, no explanation, no commentary.

Each object schema:
{"name":"str","website":"https://... or null","hq":"City, ST","description":"1 sentence about what they do","whyItFits":"1 sentence on why they match the criteria","fundingStage":"Seed|Series A|Series B|Series C|Series D+|Unknown","employeeCount":integer_or_null}

Rules:
- Return up to 25 high-quality matches (fewer if genuinely hard to find strong fits).
- Only include real, verifiable companies.
- website: only include if you are confident it is correct. Set to null if unsure.
- employeeCount: your best estimate as an integer, or null if unknown.
- NEVER use em dashes (—). Use commas or periods instead.
- CRITICAL: JSON array only. No markdown fences.`;

  const userMsg = `${profile}

SEARCH CRITERIA:
${criteria}

Suggest up to 25 real companies that match both the ICP above and the search criteria. Return ONLY the JSON array.`;

  const data = await withTimeout(
    callClaude({
      model: 'claude-sonnet-4-6',
      max_tokens: 7000,
      system,
      messages: [{ role: 'user', content: userMsg }],
    }),
    90000
  );

  const text = data.content?.find(b => b.type === 'text')?.text || '';
  const fenceStripped = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();
  const arrStart = fenceStripped.indexOf('[');
  const arrEnd = fenceStripped.lastIndexOf(']');
  if (arrStart === -1) throw new Error('No JSON array found in discover response');
  const slice = arrEnd !== -1 ? fenceStripped.slice(arrStart, arrEnd + 1) : fenceStripped.slice(arrStart);
  try {
    return JSON.parse(slice);
  } catch {
    // Recover complete top-level objects if JSON was truncated
    const recovered = [];
    let depth = 0, objStart = -1;
    for (let i = 0; i < slice.length; i++) {
      const ch = slice[i];
      if (ch === '{') { if (depth === 0) objStart = i; depth++; }
      else if (ch === '}') {
        depth--;
        if (depth === 0 && objStart !== -1) {
          try { recovered.push(JSON.parse(slice.slice(objStart, i + 1))); } catch { /* skip */ }
          objStart = -1;
        }
      }
    }
    if (recovered.length === 0) throw new Error('Discover returned unparseable JSON');
    return recovered;
  }
}

// ── Contextual outreach advisor ───────────────────────────────────────────────
// Reads ALL deal context (stage, activities, thesis, tasks) and decides what
// kind of email is appropriate right now, then writes it.

export async function generateContextualOutreach(deal, companyIntel, activities = [], tasks = [], contact, icp = DEFAULT_ICP) {
  const brandCtx = await getBrandContext();

  const activityHistory = activities.slice(0, 20).map(a =>
    `[${a.activity_date}] ${a.type}${a.assigned_to ? ` (${a.assigned_to})` : ''}: ${a.summary}`
  ).join('\n');

  const openTasks = tasks.filter(t => !t.completed).map(t =>
    `- ${t.title}${t.due_date ? ` (due ${t.due_date})` : ''}`
  ).join('\n');

  const lastActivity = activities.length > 0 ? activities[0] : null;
  const daysSinceLastActivity = lastActivity
    ? Math.floor((Date.now() - new Date(lastActivity.activity_date).getTime()) / 86400000)
    : null;
  const daysSinceCreated = Math.floor((Date.now() - new Date(deal.created_at).getTime()) / 86400000);
  const eng = ENGAGEMENT_META[deal.engagement_type] || ENGAGEMENT_META.Sprint;

  const system = `You are a senior sales strategist at Part Human, a brand strategy agency. Your job is to read a complete deal situation and advise exactly what to do next, then write the right email for this specific moment in the relationship.

${brandCtx}

${buildIcpProfile(icp)}

${EMAIL_RULES}

EMAIL LENGTH AND STRUCTURE (non-negotiable):
- Cold intros: 4 short paragraphs — trigger (1-2 sentences), pain (1-2 sentences), human truth (1-2 sentences), CTA (1 sentence). Under 120 words.
- Follow-ups and re-engagements: approximately 6 sentences across 2-3 short paragraphs. Lead with a sharp, specific observation about the prospect's situation — something they can react to. Do NOT just re-extend the calendar link or ask if they saw your last email. Make it feel like you have been paying attention, not just following a cadence.
- Post-meeting and check-ins: 4-5 sentences. Reference something specific from the meeting or conversation.
- Every paragraph is 1-2 sentences. If you find yourself writing a third sentence in a paragraph, cut it.
- White space is the point. Brevity signals confidence. Long emails signal insecurity.

ADDITIONAL RULES:
- The email must be calibrated to WHERE THIS DEAL IS RIGHT NOW, not a generic template.
- If there was a discovery call or meeting, reference what was discussed specifically. Do not re-pitch from scratch.
- If they haven't responded to prior outreach, acknowledge the silence briefly and gracefully. One sentence. Move on.
- Timing advice should be specific (e.g. "Send today, it's been 3 days since the call" or "Hold until Monday morning").
- Do NOT add any signature, title, phone number, or contact details at the end of the email. End the body with just the sender's first name on its own line. The sender will add their own signature.
- Return only valid JSON, no markdown.`;

  const user = `Read this complete deal situation and advise on next steps, then write the right email.

DEAL:
- Company: ${deal.company_name}
- Stage: ${deal.stage}
- Engagement type: ${eng.name} (${eng.price}, ${eng.duration}) — ${eng.hook}
- Created: ${daysSinceCreated} days ago
- Days since last activity: ${daysSinceLastActivity !== null ? `${daysSinceLastActivity} days` : 'no activity logged yet'}

CONTACT TO REACH:
- Name: ${contact.name}
- Title: ${contact.title || 'unknown role'}
- Email: ${contact.email || 'not on file'}

COMPANY INTEL (from Watch List scans and/or thesis):
${companyIntel?.summary ? `Summary: ${companyIntel.summary}` : 'No summary.'}
${companyIntel?.recommended_angle ? `Best angle: ${companyIntel.recommended_angle}` : ''}
${companyIntel?.entry_contact?.hook ? `Entry hook for ${companyIntel.entry_contact.name || 'primary contact'}: ${companyIntel.entry_contact.hook}` : ''}
${(() => {
  const ca = (companyIntel?.contact_angles || []).find(c => c.name?.trim().toLowerCase() === contact.name?.trim().toLowerCase());
  if (!ca?.angle && !ca?.hook) return '';
  return `Outreach angle for ${contact.name}: ${ca.angle || ''}${ca.hook ? ` Hook: ${ca.hook}` : ''}`;
})()}
${(companyIntel?.triggers || []).length > 0 ? `Trigger events (why now):\n${companyIntel.triggers.slice(0, 5).map(t => `- [${t.category || 'signal'}] ${t.headline}: ${t.detail}`).join('\n')}` : ''}
${companyIntel?.thesis ? `Thesis (excerpt): ${companyIntel.thesis.slice(0, 600)}` : 'No thesis built yet.'}

DEAL NOTES (outreach history, prospect replies, internal context):
${deal.notes?.trim() || 'None.'}

ACTIVITY HISTORY (most recent first):
${activityHistory || 'No activities logged — this is a cold deal.'}

OPEN TASKS:
${openTasks || 'No open tasks.'}

Based on the full picture above:
1. What is the real situation with this deal right now? (1-2 sentences, honest)
2. What is the right next action and why? (1-2 sentences, specific)
3. Timing — when should we send and why? (1 sentence, specific)
4. Write the email that fits this exact moment. Subject line and body.

Return JSON only:
{
  "situation": "honest 1-2 sentence read of where this deal stands",
  "recommendation": "specific next action and why it's right for this moment",
  "timing": "when to send and any timing caveats",
  "emailType": "cold_intro|follow_up|post_meeting|post_proposal|re_engagement|nurture|check_in",
  "subject": "email subject line",
  "body": "email body — use \\n for paragraph breaks, no markdown"
}`;

  const data = await withTimeout(
    callClaude({
      model: 'claude-sonnet-4-6',
      max_tokens: 900,
      system,
      messages: [{ role: 'user', content: user }],
    }),
    TIMEOUT_MS
  );

  const text = data.content?.find(b => b.type === 'text')?.text || '';
  const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();
  const s = cleaned.indexOf('{');
  const e = cleaned.lastIndexOf('}');
  if (s === -1 || e === -1) throw new Error('No JSON found in contextual outreach response');
  let result;
  try { result = JSON.parse(cleaned.slice(s, e + 1)); } catch { throw new Error('Malformed JSON in contextual outreach response'); }

  // Strip em-dash (U+2014) and en-dash (U+2013) — Claude sometimes outputs either
  const stripDashes = str => str.replace(/[—–]/g, ',');
  ['body', 'subject', 'situation', 'recommendation', 'timing'].forEach(k => {
    if (result[k]) result[k] = stripDashes(result[k]);
  });

  // Append ICP email signature if one is set in settings
  if (icp.emailSignature?.trim() && result.body) {
    result.body = result.body.trimEnd() + '\n\n' + icp.emailSignature.trim();
  }

  return result;
}

// ── Response analysis ─────────────────────────────────────────────────────────

export async function analyzeResponse(company, contact, touchNumber, responseText) {
  const data = await withTimeout(
    callClaude({
      model: 'claude-sonnet-4-6',
      max_tokens: 600,
      system: 'You are a sales coach for Part Human. Analyze prospect responses and suggest next steps. Be specific and direct. Never use em dashes (—).',
      messages: [{
        role: 'user',
        content: `${contact.name} at ${company.name} replied to Touch ${touchNumber}:\n\n"${responseText}"\n\nAnalyze this response and provide:\n1. Sentiment (positive/neutral/negative/very positive)\n2. What they're really saying\n3. Recommended next step (specific, actionable)\n4. A suggested reply draft (if appropriate), 3-5 sentences max, no em dashes\n\nReturn JSON: {"sentiment":"str","interpretation":"str","nextStep":"str","suggestedReply":"str or null"}`,
      }],
    }),
    TIMEOUT_MS
  );

  const text = data.content?.find(b => b.type === 'text')?.text || '';
  const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();
  try {
    const result = JSON.parse(cleaned);
    if (result.suggestedReply) result.suggestedReply = result.suggestedReply.replace(/[—–]/g, ',');
    return result;
  } catch {
    return { error: 'Could not parse AI response', raw: cleaned };
  }
}

// ── New trigger scan — what's changed since last outreach ─────────────────────
// Scans company news AND each known contact's LinkedIn for recent posts/activity.
// Returns { newTriggers: [{headline, detail, urgency, date, source}], found: bool }

export async function scanForNewTriggers(company, daysSinceLastTouch = 14) {
  const scanWindow = Math.max(7, Math.min(daysSinceLastTouch, 60));
  const contacts   = (company.contacts || []).filter(c => c.name);

  // Build contact-specific search instructions
  const linkedInContacts = contacts.filter(c => c.linkedin);
  const nameOnlyContacts = contacts.filter(c => !c.linkedin && c.name);

  const linkedInClause = linkedInContacts.length
    ? `\n\nLINKEDIN PROFILES TO CHECK (search each URL for recent posts):
${linkedInContacts.map(c => `- ${c.name}${c.title ? ` (${c.title})` : ''}: ${c.linkedin}`).join('\n')}`
    : '';

  const nameSearchClause = nameOnlyContacts.length
    ? `\n\nALSO SEARCH LINKEDIN/TWITTER for recent posts by these contacts at ${company.name}:
${nameOnlyContacts.map(c => `- "${c.name}"${c.title ? ` (${c.title})` : ''}`).join('\n')}`
    : '';

  const contactSection = linkedInClause || nameSearchClause
    ? `${linkedInClause}${nameSearchClause}

For contact posts look for: job changes, promotions, strategic announcements, pain points, company milestones they mention, or anything signaling brand/growth challenges or momentum.`
    : '';

  try {
    const data = await withTimeout(
      callClaude({
        model: 'claude-sonnet-4-6',
        max_tokens: 1200,
        system: 'You are a sales intelligence researcher. Search thoroughly but report ONLY events from the specified time window. For each trigger include whether it came from company news or a specific contact\'s LinkedIn. Return valid JSON only, no markdown.',
        tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 3 }],
        messages: [{
          role: 'user',
          content: `Search for new intelligence about ${company.name}${company.website ? ` (${company.website})` : ''} from the last ${scanWindow} days ONLY.

COMPANY NEWS TO LOOK FOR:
- Funding rounds, valuations, investor news
- Leadership changes (new CMO, CEO, brand hires)
- Product launches or major announcements
- Regulatory approvals or milestones
- Expansions, partnerships, acquisitions
- Brand or marketing campaign launches
- Layoffs, restructuring, or challenges${contactSection}

Do NOT report anything older than ${scanWindow} days. Each trigger must have a specific date or "recent" if date unclear.

Return JSON only:
{
  "found": true|false,
  "newTriggers": [
    {
      "headline": "max 10 words",
      "detail": "max 25 words describing what happened",
      "urgency": "high|medium|low",
      "date": "e.g. May 20, 2026 or 'this week'",
      "source": "company|contact",
      "contactName": "name if from a contact post, else null"
    }
  ]
}

If nothing found in the last ${scanWindow} days: {"found": false, "newTriggers": []}`,
        }],
      }),
      60000
    );

    const textBlocks = (data.content || []).filter(b => b.type === 'text');
    for (let i = textBlocks.length - 1; i >= 0; i--) {
      const raw = textBlocks[i]?.text || '';
      const stripped = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();
      const s = stripped.indexOf('{');
      const e = stripped.lastIndexOf('}');
      if (s !== -1 && e !== -1) {
        try { return JSON.parse(stripped.slice(s, e + 1)); } catch {}
      }
    }
  } catch (err) {
    console.warn(`scanForNewTriggers failed for ${company.name}:`, err.message);
  }
  return { found: false, newTriggers: [] };
}

export async function generateProjectSummary(proposalText) {
  const trimmed = proposalText.slice(0, 12000);

  const data = await withTimeout(
    callClaude({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 350,
      messages: [{
        role: 'user',
        content: `Based on the following project proposal, write a concise 3–4 sentence summary capturing: what the project is, the key deliverables, the overall scope and goal, and any notable approach. Plain prose only — no bullet points, no headers.\n\nProposal:\n${trimmed}`,
      }],
    }),
    30000
  );

  const text = (data.content || []).find(b => b.type === 'text')?.text || '';
  return text.trim();
}

export async function generateSummaryFromActivity({ projectName, milestones, tasks, meetings, files }) {
  const msLines = milestones.map(m => `  Milestone: ${m.title} [${m.status}]${m.description ? ' — ' + m.description : ''}`).join('\n');
  const taskLines = tasks.slice(0, 60).map(t => `  Task: ${t.title} [${t.completed ? 'done' : 'open'}]${t.assigned_to ? ', assigned: ' + t.assigned_to : ''}`).join('\n');
  const meetingLines = meetings.slice(0, 20).map(m => `  Meeting ${m.meeting_date || m.date || ''}: ${m.summary || m.notes || ''}`.trim()).join('\n');
  const fileLines = files.slice(0, 20).map(f => `  File: ${f.name}`).join('\n');

  const context = [
    `Project: ${projectName}`,
    msLines   ? `Milestones:\n${msLines}` : '',
    taskLines ? `Tasks:\n${taskLines}` : '',
    meetingLines ? `Meetings:\n${meetingLines}` : '',
    fileLines ? `Files:\n${fileLines}` : '',
  ].filter(Boolean).join('\n\n');

  const data = await withTimeout(
    callClaude({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 350,
      messages: [{
        role: 'user',
        content: `Based on the following project activity, write a concise 3–4 sentence status summary capturing: what the project is about, where it stands now, key progress, and any notable items. Plain prose only — no bullet points, no headers.\n\n${context}`,
      }],
    }),
    30000
  );

  const text = (data.content || []).find(b => b.type === 'text')?.text || '';
  return text.trim();
}

export async function generateQuickNextStep(companyName, noteText, dealNotes = '') {
  const context = [
    noteText?.trim() ? `LATEST NOTE:\n${noteText.trim()}` : '',
    dealNotes?.trim() && dealNotes.trim() !== noteText?.trim() ? `PRIOR CONTEXT:\n${dealNotes.trim()}` : '',
  ].filter(Boolean).join('\n\n');

  const data = await withTimeout(
    callClaude({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 120,
      messages: [{
        role: 'user',
        content: `You are a B2B sales advisor. Based on the context below for ${companyName}, write a single concrete next action for the sales rep — 1–2 sentences, specific and actionable, starting with a verb (e.g. "Send a follow-up email...", "Schedule a discovery call...", "Share the proposal..."). No preamble, no sign-off.\n\n${context}`,
      }],
    }),
    15000
  );
  const text = (data.content || []).find(b => b.type === 'text')?.text || '';
  return text.trim();
}

// ── Document generation ───────────────────────────────────────────────────────

// PH_VOICE is kept as a lightweight fallback; the real brand brain is loaded fresh from settings at generation time.

export async function generateDocumentSections(type, dealContext) {
  const typeInstructions = {
    proposal: {
      label: 'Proposal',
      instructions: `Generate a Proposal document. Return a JSON object with these exact keys:
- "understanding": 2–3 paragraphs. Start with the client's specific situation. Show you understand what's at stake. Use emotional and logical framing. Do NOT use a header in the text — just write the paragraphs.
- "strategic_approach": 1–2 paragraphs about Part Human's specific approach for this engagement. What methodology, what principles, why it fits this client.
- "objectives": array of 6–9 strings (bullet points). Start each with a verb. Specific to this client, not generic.
- "outcomes": array of 4–6 strings (bullet points). What will the client have at the end. Concrete and tangible.
- "phases": array of phase objects — each has "title" (e.g. "Sprint 1: Brand Strategy"), "duration" (e.g. "Weeks 1–2"), "deliverables" (array of strings). Generate 2–3 phases appropriate for the scope.
- "investment": 1–2 sentences framing the investment — not the price itself, but the value and the engagement type.
- "next_steps": 1–2 sentences. Clear, specific, action-oriented.`,
    },
    goo: {
      label: 'Goals & Objectives',
      instructions: `Generate a Goals, Objectives & Outcomes document. This is a "napkin note" — tight, direct, written in a first-person plural voice that shows you listened and have a clear POV. NOT a formal proposal. Return a JSON object with these exact keys:
- "what_we_heard": 2–3 paragraphs. Narrate back what you understand about their situation — with insight added. Show you see things they may not have named yet. Direct, slightly provocative.
- "the_goal": SINGLE sentence. The clearest possible statement of what we're trying to accomplish together. Should make the client think "yes, exactly."
- "objectives": array of 4–6 objects — each has "title" (short, punchy, starts with a verb) and "description" (1–2 sentences of context).
- "outcomes": array of 4–6 strings. What they'll have when this phase is done. Concrete.
- "what_this_is_not": 2–4 sentences. Clear scope guardrails. What you're explicitly NOT doing yet.
- "next_step": 1 sentence. Singular, concrete next action.`,
    },
    sow: {
      label: 'Statement of Work',
      instructions: `Generate a Statement of Work document. This is professional and specific — it defines the work, not the strategy. Return a JSON object with these exact keys:
- "goals": 1–2 paragraphs about the project goals and what this SOW accomplishes.
- "approach": 1 paragraph about the overall approach/methodology for this engagement.
- "deliverables": array of category objects — each has "category" (section title like "Brand Strategy", "Website Design", "Launch") and "items" (array of specific deliverable strings). Generate 3–6 categories appropriate for the scope.
- "timeline": 1 sentence about overall estimated duration.
- "start_date": 1 sentence about when work begins.
- "payment_schedule": 1–2 sentences about payment structure (e.g. "Split into two equal payments of 50%. First payment to commence work, second upon project completion.").`,
    },
  };

  const inst = typeInstructions[type];
  if (!inst) throw new Error(`No AI generation for document type: ${type}`);

  // Load the live brand brain from Settings so the document sounds like Part Human
  const brandContext = await getBrandContext();

  const system = `You are Pete Andrews, Managing Partner at Part Human, writing a ${inst.label} for a specific client.

${brandContext}

DOCUMENT INSTRUCTIONS — ${inst.label.toUpperCase()}:
${inst.instructions}

VOICE REMINDERS FOR THIS DOCUMENT:
- Write in first-person plural ("we", "our approach", "what we heard") — never "I"
- Every sentence should sound like it could only be about THIS client — no generic placeholders
- Short sentences. No throat-clearing. No hedging.
- Never use em dashes (—). Use commas or a new sentence instead.
- Never: "solutions," "deliverables," "leverage," "synergy," "full-service," "best-in-class," "holistic," "utilize"
- Challenge assumptions where you can — don't just validate what they already believe
- Connect brand work to specific business outcomes this client cares about

CRITICAL: Return ONLY valid JSON — no markdown fences, no explanation, no preamble. Just the raw JSON object.`;

  const data = await withTimeout(
    callClaude({
      model: 'claude-sonnet-4-6',
      max_tokens: 4000,
      system,
      messages: [{
        role: 'user',
        content: `Generate the ${inst.label} document sections based on this deal context:\n\n${dealContext}`,
      }],
    }),
    60000
  );

  const raw = (data.content || []).find(b => b.type === 'text')?.text || '';
  // Strip markdown fences, then try to extract the first { ... } block
  const stripped = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  // Attempt direct parse first
  try { return JSON.parse(stripped); } catch (_) {}
  // Fall back to extracting first JSON object from the response
  const match = stripped.match(/\{[\s\S]*\}/);
  if (match) {
    try { return JSON.parse(match[0]); } catch (_) {}
  }
  throw new Error(`Document generation returned invalid JSON: ${stripped.slice(0, 200)}`);
}

export async function generateRejectionResponse(taskTitle, projectName, rejectionNotes) {
  const data = await withTimeout(
    callClaude({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 150,
      messages: [{
        role: 'user',
        content: `You are a project manager sending a client an update that their revision is ready. The task was "${taskTitle}" and the client's feedback was:\n\n"${rejectionNotes}"\n\nWrite 1–2 sentences confirming the specific issue has been addressed — e.g. "We've adjusted the [specific thing] per your feedback." Past tense. Specific. No greeting, no sign-off, no "please review" — just what was done. Keep it under 30 words.`,
      }],
    }),
    20000
  );
  const text = (data.content || []).find(b => b.type === 'text')?.text || '';
  return text.trim();
}
