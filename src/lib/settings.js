import { supabase } from './supabase';

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

export async function saveLastWeeklyScan() {
  await supabase.from('app_settings').upsert(
    { key: 'last_weekly_scan', value: { timestamp: new Date().toISOString(), scanned: 0, changes: [], toDeepScan: [], viewed: false }, updated_at: new Date().toISOString() },
    { onConflict: 'key' }
  );
}

export async function markWeeklyScanViewed() {
  const { data } = await supabase.from('app_settings').select('value').eq('key', 'last_weekly_scan').single();
  if (data?.value) {
    await supabase.from('app_settings').upsert(
      { key: 'last_weekly_scan', value: { ...data.value, viewed: true }, updated_at: new Date().toISOString() },
      { onConflict: 'key' }
    );
  }
}

// Returns true if a weekly rescan is due (last one > 6 days ago or never run)
export function isWeeklyScanDue(lastScan) {
  if (!lastScan?.timestamp) return true;
  const daysSince = (Date.now() - new Date(lastScan.timestamp).getTime()) / 86400000;
  return daysSince >= 6;
}
