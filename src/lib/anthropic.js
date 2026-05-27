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

import { buildIcpProfile, DEFAULT_ICP } from './settings';

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

function buildBatchSystem(icp) {
  const profile = buildIcpProfile(icp);
  return `Sales intelligence analyst scoring companies for Part Human outreach.
${profile}
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

function buildDeepSystem(icp) {
  const profile = buildIcpProfile(icp);
  return `B2B sales intelligence analyst. Search the web AND social media for very recent signals about this company.

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
      system: buildBatchSystem(icp),
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

function buildWeeklySystem(icp) {
  const profile = buildIcpProfile(icp);
  return `Sales intelligence analyst doing a weekly refresh scan for Part Human.
${profile}
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
  const list = companies.map((c, i) =>
    `${i + 1}. ${c.name}${c.website ? ` (${c.website})` : ''}${c.hq ? ` — HQ: ${c.hq}` : ''} [current SIG: ${c.overall_score || '?'}, ICP: ${c.icp_score || '?'}]`
  ).join('\n');

  const data = await withTimeout(
    callClaude({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 8000,
      system: buildWeeklySystem(icp),
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

export async function scanDeepDive(company, icp = DEFAULT_ICP, existingEngagementType = null) {
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

  const data = await withTimeout(
    callClaude({
      model: 'claude-sonnet-4-6',
      max_tokens: 4000,
      system: buildDeepSystem(icp),
      tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 2 }],
      messages: [{
        role: 'user',
        content: `Search for recent signals about ${company.name}${company.website ? ` (${company.website})` : ''}. Check: company news, LinkedIn company page, Twitter/X, job boards (brand/marketing/comms roles).${linkedInClause}${nameSearchClause} Look for posts about growth, brand, team changes, or challenges. Find up to 3 trigger events from the last 90 days.${contactStr ? ` For each contact, also find their LinkedIn profile URL (linkedin.com/in/...) — include it in contactAngles.linkedinUrl if found with confidence. Contacts: ${contactStr}.` : ''} Do 1-2 searches max.${!websiteKnown ? ' Also find their website.' : ''}${existingEngagementType ? ` The engagement type is already set to "${existingEngagementType}" — write recommendedAngle and contactAngles for that engagement tier unless the company profile clearly warrants a different one.` : ''} Return JSON only.`,
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

export async function generateEmailDraft(touchNumber, company, contact, angle, icp = DEFAULT_ICP, t1Subject = null, engagementType = 'Sprint', linkedinPosts = []) {
  const promptFn = TOUCH_PROMPTS[touchNumber];
  if (!promptFn) throw new Error(`No prompt for touch ${touchNumber}`);

  const eng = ENGAGEMENT_META[engagementType] || ENGAGEMENT_META.Sprint;
  const { outreachVoice, aboutCompany } = icp;
  const systemContext = `You are a copywriter for Part Human. ${aboutCompany ? aboutCompany.split('.')[0] + '.' : 'Brand strategy agency.'} Write in their voice: direct, warm, human, no jargon. Never use em dashes (—). Return only valid JSON as specified.${outreachVoice ? '\n\nVOICE GUIDANCE: ' + outreachVoice : ''}\n\nENGAGEMENT CONTEXT: You are writing for a ${eng.name} engagement (${eng.price}, ${eng.duration}). ${eng.hook}.`;

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
  const result = JSON.parse(cleaned.slice(s, e + 1));
  // Strip any em dashes that slipped through
  if (result.body) result.body = result.body.replace(/—/g, ',');
  if (result.subject) result.subject = result.subject.replace(/—/g, ',');
  return result;
}

export async function generateLinkedInDrafts(company, contact, t1Subject = null, engagementType = 'Sprint', linkedinPosts = []) {
  const eng = ENGAGEMENT_META[engagementType] || ENGAGEMENT_META.Sprint;
  const contactPosts = linkedinPosts.filter(p =>
    p.contact_name?.toLowerCase().trim() === contact.name?.toLowerCase().trim()
  );
  const data = await withTimeout(
    callClaude({
      model: 'claude-sonnet-4-6',
      max_tokens: 600,
      system: `You are a copywriter for Part Human. Write in their voice: direct, warm, human, no jargon. Never use em dashes (—). Return only valid JSON.\n\nENGAGEMENT CONTEXT: ${eng.name} (${eng.price}, ${eng.duration}). ${eng.hook}.`,
      messages: [{ role: 'user', content: TOUCH_PROMPTS[3](company, contact, null, t1Subject, engagementType, contactPosts) }],
    }),
    TIMEOUT_MS
  );

  const text = data.content?.find(b => b.type === 'text')?.text || '';
  const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();
  const s = cleaned.indexOf('{');
  const e = cleaned.lastIndexOf('}');
  if (s === -1 || e === -1) throw new Error('No JSON found in LinkedIn draft response');
  const result = JSON.parse(cleaned.slice(s, e + 1));
  if (result.connection_note) result.connection_note = result.connection_note.replace(/—/g, ',');
  if (result.acceptance_dm) result.acceptance_dm = result.acceptance_dm.replace(/—/g, ',');
  return result;
}

// ── Weekly report ─────────────────────────────────────────────────────────────

export async function generateWeeklyPlan(newCompanies, followups, icp = DEFAULT_ICP) {
  const prompt = `You are the Part Human AI sales coach. Generate this week's outreach plan summary.

NEW COMPANIES THIS WEEK (Touch 1):
${newCompanies.map(c => `- ${c.name}: ${c.recommended_angle || c.summary || 'No angle yet'}`).join('\n') || 'None'}

FOLLOW-UPS DUE:
${followups.map(f => `- ${f.companyName} (Touch ${f.touchNumber}, ${f.contactName || 'primary contact'})`).join('\n') || 'None'}

Write a brief, motivating weekly briefing for Mike and Pete. Include:
1. A 2-sentence overview of this week's pipeline health
2. The top 2-3 companies to prioritize and why
3. One tactical reminder based on the Dan Allard 5-touch cadence

Keep it under 200 words. Direct and human. No bullet-point overload. Never use em dashes.`;

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
  return text.replace(/—/g, ',');
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
  return text.replace(/—/g, ',');
}

// ── Company Discovery ─────────────────────────────────────────────────────────

export async function discoverCompanies(criteria, icp = DEFAULT_ICP) {
  const profile = buildIcpProfile(icp);

  const system = `You are a B2B sales prospecting expert. Based on the ideal customer profile and search criteria, identify real companies that would be strong prospects. Return ONLY a JSON array — no markdown, no explanation, no commentary.

Each object schema:
{"name":"str","website":"https://... or null","hq":"City, ST","description":"1 sentence about what they do","whyItFits":"1 sentence on why they match the criteria","fundingStage":"Seed|Series A|Series B|Series C|Series D+|Unknown","employeeCount":integer_or_null}

Rules:
- Return up to 50 companies (or fewer if genuinely hard to find strong matches).
- Only include real, verifiable companies.
- website: only include if you are confident it is correct. Set to null if unsure.
- employeeCount: your best estimate as an integer, or null if unknown.
- NEVER use em dashes (—). Use commas or periods instead.
- CRITICAL: JSON array only. No markdown fences.`;

  const userMsg = `${profile}

SEARCH CRITERIA:
${criteria}

Suggest up to 50 real companies that match both the ICP above and the search criteria. Return ONLY the JSON array.`;

  const data = await withTimeout(
    callClaude({
      model: 'claude-sonnet-4-6',
      max_tokens: 16000,
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
    if (result.suggestedReply) result.suggestedReply = result.suggestedReply.replace(/—/g, ',');
    return result;
  } catch {
    return { error: 'Could not parse AI response', raw: cleaned };
  }
}

// ── New trigger scan — what's changed since last outreach ─────────────────────
// Returns { newTriggers: [{headline, detail, urgency, date}], found: bool }

export async function scanForNewTriggers(company, daysSinceLastTouch = 14) {
  const window = Math.max(7, Math.min(daysSinceLastTouch, 60));
  try {
    const data = await withTimeout(
      callClaude({
        model: 'claude-sonnet-4-6',
        max_tokens: 800,
        system: 'You are a sales intelligence researcher. Search for ONLY recent events at this company. Be concise. Return valid JSON only, no markdown.',
        tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 1 }],
        messages: [{
          role: 'user',
          content: `Search for news or announcements about ${company.name}${company.website ? ` (${company.website})` : ''} from the last ${window} days only. Focus on: funding rounds, leadership changes, product launches, regulatory approvals, major hires, expansions, or brand announcements. Do NOT report anything older than ${window} days.

Return JSON only:
{"found": true|false, "newTriggers": [{"headline": "max 10 words", "detail": "max 20 words", "urgency": "high|medium|low", "date": "e.g. May 20, 2026"}]}

If nothing new in the last ${window} days, return: {"found": false, "newTriggers": []}`,
        }],
      }),
      45000
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
