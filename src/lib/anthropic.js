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

// ── ICP / Signal Watch scanning ──────────────────────────────────────────────

import { buildIcpProfile, DEFAULT_ICP } from './settings';

function buildBatchSystem(icp) {
  const profile = buildIcpProfile(icp);
  return `Sales intelligence analyst scoring companies for Part Human outreach.
${profile}
Return ONLY a JSON array, same order as input. Short strings only.
Each object schema:
{"companyName":"str","website":"https://domain.com or null — only include if you are confident this is correct, never guess","overallScore":1-10,"icpScore":1-10,"icpReason":"max 15 words","icpTier":"Ambitious Scale-Up|Category Challenger|Innovation Team","fundingStage":"Seed|Series A|Series B|Series C|Series D+|Unknown","employeeCountNum":integer_or_null,"summary":"max 25 words","triggers":[{"category":"leadership|funding|expansion|product|pain|hiring","headline":"max 8 words","detail":"max 20 words","urgency":"high|medium|low","source":"str","date":"str"}],"recommendedAngle":"max 30 words","contactAngles":[{"name":"str","title":"str","angle":"max 30 words"}],"lat":number_or_null,"lng":number_or_null,"noNewsFound":false}
For lat/lng: return the approximate latitude and longitude of the company headquarters city. If unknown, return null.
For website: return the company's primary domain if you know it with confidence. Return null if unsure — do not guess.
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
Return ONLY valid JSON object, no markdown:
{"companyName":"str","website":"https://domain.com or null","scanDate":"today","overallScore":1-10,"icpScore":1-10,"icpReason":"str","icpTier":"str","fundingStage":"Seed|Series A|Series B|Series C|Series D+|Unknown","employeeCountNum":integer_or_null,"summary":"2-3 sentences","triggers":[{"category":"str","headline":"str","detail":"str","urgency":"str","source":"str","date":"str"}],"recommendedAngle":"str","contactAngles":[{"name":"str","title":"str","angle":"str"}],"lat":number_or_null,"lng":number_or_null,"noNewsFound":false}
For lat/lng: return the approximate latitude and longitude of the company headquarters city.
For website: search for and return the company's actual primary website URL. Verify it exists.`;
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
{"companyName":"str","overallScore":1-10,"icpScore":1-10,"scoreChanged":true|false,"triggers":[{"category":"leadership|funding|expansion|product|pain|hiring","headline":"max 8 words","detail":"max 20 words","urgency":"high|medium|low","source":"str","date":"str"}],"recommendedAngle":"max 30 words","noNewsFound":false}
scoreChanged: true only if you are aware of meaningful new developments in the last 30 days that would change outreach priority.
If nothing new: scoreChanged:false, triggers:[], keep scores similar to before.
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

export async function scanDeepDive(company, icp = DEFAULT_ICP) {
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
      max_tokens: 2500,
      system: buildDeepSystem(icp),
      tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 2 }],
      messages: [{
        role: 'user',
        content: `Search for recent signals about ${company.name}${company.website ? ` (${company.website})` : ''}. Check: company news, LinkedIn company page, Twitter/X, job boards (brand/marketing/comms roles).${linkedInClause}${nameSearchClause} Look for posts about growth, brand, team changes, or challenges. Find up to 3 trigger events from the last 90 days. Do 1-2 searches max.${!websiteKnown ? ' Also find their website.' : ''} Return JSON only.${contactStr ? ` Contacts: ${contactStr}.` : ''}`,
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
  1: (company, contact, angle) => `Write a Touch 1 cold outreach email for Part Human (brand strategy agency) to ${contact.name}, ${contact.title} at ${company.name}.

Context about ${company.name}: ${company.summary || ''}
Trigger event / outreach angle: ${angle || company.recommended_angle || ''}
${EMAIL_RULES}
FORMULA (4 short paragraphs, strict order):
1. TRIGGER: Acknowledge the specific trigger event. Congratulate or reference it naturally. 1-2 sentences.
2. PAIN: Name the brand gap this trigger creates. Be specific and direct. 2 sentences.
3. HUMAN TRUTH: The real cost of that gap, told in human terms. Not business-speak. 2 sentences.
4. CTA: Invite to a 20-minute call about a "Strategic Sprint" (Part Human's 2-week brand engagement). Low-pressure. 1-2 sentences.

Subject line: Short, specific, references the trigger. Not generic.

Return JSON: {"subject":"str","body":"str"}. Body uses \\n for line breaks between paragraphs. No markdown in body.`,

  2: (company, contact, angle, t1Subject) => `Write a Touch 2 follow-up email for Part Human. 7-day follow-up to ${contact.name}, ${contact.title} at ${company.name}.
${EMAIL_RULES}
RULES:
- Reply on the same thread. Subject line: "Re: ${t1Subject || '[original subject]'}"
- 3-4 sentences max. That's it.
- Reference the original message naturally.
- One soft CTA, same ask as before (20-min call).
- No new pitch. Just a gentle nudge.

Return JSON: {"subject":"Re: ${t1Subject || '[original subject]'}","body":"str"}. Body uses \\n for line breaks.`,

  3: (company, contact, angle, t1Subject) => `Write two LinkedIn messages for Part Human reaching out to ${contact.name}, ${contact.title} at ${company.name}.

Context: ${company.summary || ''}${t1Subject ? `\nPrevious outreach subject: "${t1Subject}"` : ''}
${EMAIL_RULES}
Message 1 — CONNECTION REQUEST NOTE (300 characters max):
- No pitch. Just context: who you are and why you're connecting.
- Reference something specific about them or their company.
- Warm, human, brief.

Message 2 — POST-ACCEPTANCE DM (after they accept):
- Reference a recent post or content they shared. Use "[their recent post about X]" as placeholder.
- Add genuine perspective on it.
- Soft segue toward a conversation about brand.
- 3-4 sentences max.

Return JSON: {"connection_note":"str","acceptance_dm":"str"}`,

  4: (company, contact, angle, t1Subject) => `Write a Touch 4 goodwill email for Part Human to ${contact.name}, ${contact.title} at ${company.name}. Day 21. No hard ask.

Context: ${company.summary || ''}${t1Subject ? `\nThis is part of an outreach sequence. Original subject: "${t1Subject}". They have not replied.` : ''}
${EMAIL_RULES}
RULES:
- Share a relevant market observation or competitor move that would genuinely interest them.
- Use a placeholder like "[market observation about X]" if specific detail is needed.
- NO pitch. NO CTA. NO mention of the Strategic Sprint.
- Close with one line that keeps the door open without asking for anything.
- 3-4 sentences total.

Return JSON: {"subject":"str","body":"str"}. Body uses \\n for line breaks.`,

  5: (company, contact, angle, t1Subject) => `Write a Touch 5 close-the-loop email for Part Human to ${contact.name}, ${contact.title} at ${company.name}. Day 28. Final touch.
${t1Subject ? `Original outreach subject: "${t1Subject}". They have not replied to any of the previous touches.\n` : ''}${EMAIL_RULES}
RULES:
- Acknowledge the silence gracefully. No guilt, no passive aggression.
- Leave the door completely open.
- Promise a check-in next quarter, not "I'll keep reaching out."
- 2-3 sentences max.
- End on a genuinely warm note.

Return JSON: {"subject":"str","body":"str"}. Body uses \\n for line breaks.`,
};

export async function generateEmailDraft(touchNumber, company, contact, angle, icp = DEFAULT_ICP, t1Subject = null) {
  const promptFn = TOUCH_PROMPTS[touchNumber];
  if (!promptFn) throw new Error(`No prompt for touch ${touchNumber}`);

  const { outreachVoice, aboutCompany } = icp;
  const systemContext = `You are a copywriter for Part Human. ${aboutCompany ? aboutCompany.split('.')[0] + '.' : 'Brand strategy agency.'} Write in their voice: direct, warm, human, no jargon. Never use em dashes (—). Return only valid JSON as specified.${outreachVoice ? '\n\nVOICE GUIDANCE: ' + outreachVoice : ''}`;

  const data = await withTimeout(
    callClaude({
      model: 'claude-sonnet-4-6',
      max_tokens: 1000,
      system: systemContext,
      messages: [{ role: 'user', content: promptFn(company, contact, angle, t1Subject) }],
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

export async function generateLinkedInDrafts(company, contact) {
  const data = await withTimeout(
    callClaude({
      model: 'claude-sonnet-4-6',
      max_tokens: 600,
      system: `You are a copywriter for Part Human. Write in their voice: direct, warm, human, no jargon. Never use em dashes (—). Return only valid JSON.`,
      messages: [{ role: 'user', content: TOUCH_PROMPTS[3](company, contact) }],
    }),
    TIMEOUT_MS
  );

  const text = data.content?.find(b => b.type === 'text')?.text || '';
  const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();
  const result = JSON.parse(cleaned);
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
  const result = JSON.parse(cleaned);
  if (result.suggestedReply) result.suggestedReply = result.suggestedReply.replace(/—/g, ',');
  return result;
}
