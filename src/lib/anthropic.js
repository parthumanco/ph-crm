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
{"companyName":"str","overallScore":1-10,"icpScore":1-10,"icpReason":"max 15 words","icpTier":"Ambitious Scale-Up|Category Challenger|Innovation Team","fundingStage":"Seed|Series A|Series B|Series C|Series D+|Unknown","employeeCountNum":integer_or_null,"summary":"max 25 words","triggers":[{"category":"leadership|funding|expansion|product|pain|hiring","headline":"max 8 words","detail":"max 20 words","urgency":"high|medium|low","source":"str","date":"str"}],"recommendedAngle":"max 30 words","contactAngles":[{"name":"str","title":"str","angle":"max 30 words"}],"lat":number_or_null,"lng":number_or_null,"noNewsFound":false}
For lat/lng: return the approximate latitude and longitude of the company headquarters city. If unknown, return null.
If contacts listed, populate contactAngles per contact tailored to their role.
If unknown company: noNewsFound:true, triggers:[], overallScore:3, icpScore:3, lat:null, lng:null.
CRITICAL: JSON array only. No markdown.`;
}

function buildDeepSystem(icp) {
  const profile = buildIcpProfile(icp);
  return `B2B sales intelligence analyst. Search web for very recent news about this company.
${profile}
Return ONLY valid JSON object, no markdown:
{"companyName":"str","scanDate":"today","overallScore":1-10,"icpScore":1-10,"icpReason":"str","icpTier":"str","fundingStage":"Seed|Series A|Series B|Series C|Series D+|Unknown","employeeCountNum":integer_or_null,"summary":"2-3 sentences","triggers":[{"category":"str","headline":"str","detail":"str","urgency":"str","source":"str","date":"str"}],"recommendedAngle":"str","contactAngles":[{"name":"str","title":"str","angle":"str"}],"lat":number_or_null,"lng":number_or_null,"noNewsFound":false}
For lat/lng: return the approximate latitude and longitude of the company headquarters city.`;
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
      max_tokens: 6000,
      system: buildBatchSystem(icp),
      messages: [{ role: 'user', content: `Analyze for B2B trigger events:\n${list}` }],
    }),
    TIMEOUT_MS
  );

  const text = data.content?.find(b => b.type === 'text')?.text || '';
  const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();
  return JSON.parse(cleaned);
}

export async function scanDeepDive(company, icp = DEFAULT_ICP) {
  const contactStr = (company.contacts || [])
    .map(ct => [ct.name, ct.title].filter(Boolean).join(' / '))
    .filter(Boolean).join('; ');

  const data = await withTimeout(
    callClaude({
      model: 'claude-sonnet-4-6',
      max_tokens: 2000,
      system: buildDeepSystem(icp),
      tools: [{ type: 'web_search_20250305', name: 'web_search' }],
      messages: [{
        role: 'user',
        content: `Search the web for recent (last 60 days) trigger events for: ${company.name}${company.website ? ` (${company.website})` : ''}${company.hq ? `, HQ: ${company.hq}` : ''}${contactStr ? `. Key contacts: ${contactStr}` : ''}. Search for: LinkedIn posts from company leaders, press releases, news articles, funding announcements, executive hires or departures, product launches, layoffs, expansions, or any major company news. Pull actual sources and dates.`,
      }],
    }),
    TIMEOUT_MS
  );

  const text = data.content?.find(b => b.type === 'text')?.text || '';
  const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();
  return JSON.parse(cleaned);
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

  2: (company, contact) => `Write a Touch 2 follow-up email for Part Human. 7-day follow-up to ${contact.name}, ${contact.title} at ${company.name}.
${EMAIL_RULES}
RULES:
- Reply on the same thread. Subject line: "Re: [original subject]"
- 3-4 sentences max. That's it.
- Reference the original message naturally.
- One soft CTA, same ask as before (20-min call).
- No new pitch. Just a gentle nudge.

Return JSON: {"subject":"Re: [original subject]","body":"str"}. Body uses \\n for line breaks.`,

  3: (company, contact) => `Write two LinkedIn messages for Part Human reaching out to ${contact.name}, ${contact.title} at ${company.name}.

Context: ${company.summary || ''}
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

  4: (company, contact) => `Write a Touch 4 goodwill email for Part Human to ${contact.name}, ${contact.title} at ${company.name}. Day 21. No hard ask.

Context: ${company.summary || ''}
${EMAIL_RULES}
RULES:
- Share a relevant market observation or competitor move that would genuinely interest them.
- Use a placeholder like "[market observation about X]" if specific detail is needed.
- NO pitch. NO CTA. NO mention of the Strategic Sprint.
- Close with one line that keeps the door open without asking for anything.
- 3-4 sentences total.

Return JSON: {"subject":"str","body":"str"}. Body uses \\n for line breaks.`,

  5: (company, contact) => `Write a Touch 5 close-the-loop email for Part Human to ${contact.name}, ${contact.title} at ${company.name}. Day 28. Final touch.
${EMAIL_RULES}
RULES:
- Acknowledge the silence gracefully. No guilt, no passive aggression.
- Leave the door completely open.
- Promise a check-in next quarter, not "I'll keep reaching out."
- 2-3 sentences max.
- End on a genuinely warm note.

Return JSON: {"subject":"str","body":"str"}. Body uses \\n for line breaks.`,
};

export async function generateEmailDraft(touchNumber, company, contact, angle) {
  const promptFn = TOUCH_PROMPTS[touchNumber];
  if (!promptFn) throw new Error(`No prompt for touch ${touchNumber}`);

  const data = await withTimeout(
    callClaude({
      model: 'claude-sonnet-4-6',
      max_tokens: 1000,
      system: `You are a copywriter for Part Human, a brand strategy agency. Write in their voice: direct, warm, human, no jargon. Never use em dashes (—). Return only valid JSON as specified.`,
      messages: [{ role: 'user', content: promptFn(company, contact, angle) }],
    }),
    TIMEOUT_MS
  );

  const text = data.content?.find(b => b.type === 'text')?.text || '';
  const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();
  const result = JSON.parse(cleaned);
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

export async function generateWeeklyPlan(newCompanies, followups) {
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
