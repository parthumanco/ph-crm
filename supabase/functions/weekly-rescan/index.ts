import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const ANTHROPIC_KEY = Deno.env.get('ANTHROPIC_API_KEY')!;
const SUPABASE_URL  = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_KEY  = Deno.env.get('SB_SERVICE_ROLE_KEY')!;

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const BATCH_SIZE = 10;

// ── Weekly rescan prompt ──────────────────────────────────────────────────────

const SYSTEM = `Sales intelligence analyst doing a weekly refresh scan.
Re-evaluate companies already assessed. Focus ONLY on what has CHANGED or is NEW in the last 30 days: leadership moves, funding rounds, product launches, layoffs, expansions, key hires.
Return ONLY a JSON array, same order as input. Short strings only.
Each object:
{"companyName":"str","overallScore":1-10,"icpScore":1-10,"scoreChanged":true|false,"triggers":[{"category":"leadership|funding|expansion|product|pain|hiring","headline":"max 8 words","detail":"max 20 words","urgency":"high|medium|low","date":"str"}],"recommendedAngle":"max 30 words","noNewsFound":false}
scoreChanged: true only if meaningful new developments exist in the last 30 days.
If nothing new: scoreChanged:false, triggers:[].
CRITICAL: JSON array only. No markdown.`;

async function rescanBatch(companies: Record<string, unknown>[]) {
  const list = companies.map((c, i) =>
    `${i + 1}. ${c.name}${c.website ? ` (${c.website})` : ''}${c.hq ? ` — HQ: ${c.hq}` : ''} [SIG: ${c.overall_score ?? '?'}, ICP: ${c.icp_score ?? '?'}]`
  ).join('\n');

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': ANTHROPIC_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 8000,
      system: SYSTEM,
      messages: [{ role: 'user', content: `Weekly refresh:\n${list}` }],
    }),
  });

  const data = await res.json();
  if (!res.ok) throw new Error(`Anthropic error: ${data?.error?.message}`);

  const text = data.content?.find((b: { type: string }) => b.type === 'text')?.text || '';
  const stripped = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();
  const s = stripped.indexOf('['), e = stripped.lastIndexOf(']');
  if (s === -1) return [];
  try {
    return JSON.parse(stripped.slice(s, e + 1));
  } catch {
    const recovered: unknown[] = [];
    let depth = 0, start = -1;
    for (let i = 0; i < stripped.length; i++) {
      if (stripped[i] === '{') { if (!depth) start = i; depth++; }
      else if (stripped[i] === '}') {
        if (--depth === 0 && start !== -1) {
          try { recovered.push(JSON.parse(stripped.slice(start, i + 1))); } catch { /**/ }
          start = -1;
        }
      }
    }
    return recovered;
  }
}

// ── Main handler ──────────────────────────────────────────────────────────────

Deno.serve(async () => {
  try {
    // 1. Fetch all scanned companies (paginated)
    let companies: Record<string, unknown>[] = [];
    let from = 0;
    while (true) {
      const { data, error } = await supabase
        .from('companies')
        .select('id,name,website,hq,overall_score,icp_score,deep_scanned')
        .not('scan_date', 'is', null)
        .range(from, from + 999);
      if (error || !data?.length) break;
      companies = companies.concat(data);
      if (data.length < 1000) break;
      from += 1000;
    }

    if (!companies.length) {
      return new Response(JSON.stringify({ ok: true, message: 'No companies to scan' }), { status: 200 });
    }

    // 2. Run in batches — 3 parallel at a time for speed
    const batches: Record<string, unknown>[][] = [];
    for (let i = 0; i < companies.length; i += BATCH_SIZE) batches.push(companies.slice(i, i + BATCH_SIZE));

    const changes: { name: string; sigDelta: number; icpDelta: number; newSig: number; newIcp: number; triggers: unknown[] }[] = [];
    const toDeepScan: string[] = [];
    const updatePromises: Promise<unknown>[] = [];

    for (let i = 0; i < batches.length; i += 3) {
      const group = batches.slice(i, i + 3);
      const results = await Promise.allSettled(group.map(b => rescanBatch(b)));

      results.forEach((outcome, gi) => {
        if (outcome.status !== 'fulfilled') return;
        const batch = group[gi];
        const batchResults = outcome.value;

        batch.forEach((company) => {
          const r = batchResults.find((x: { companyName?: string }) =>
            x.companyName?.toLowerCase() === (company.name as string).toLowerCase()
          ) || batchResults[batch.indexOf(company)];
          if (!r) return;

          const sigDelta = (r.overallScore || 0) - ((company.overall_score as number) || 0);
          const icpDelta = (r.icpScore || 0) - ((company.icp_score as number) || 0);

          if (sigDelta >= 2 || icpDelta >= 2) {
            changes.push({ name: company.name as string, sigDelta, icpDelta, newSig: r.overallScore, newIcp: r.icpScore, triggers: r.triggers || [] });
            if ((r.overallScore >= 7 || r.icpScore >= 7) && !company.deep_scanned) {
              toDeepScan.push(company.name as string);
            }
          }

          updatePromises.push(
            supabase.from('companies').update({
              overall_score: r.overallScore || company.overall_score,
              icp_score: r.icpScore || company.icp_score,
              ...(r.triggers?.length ? { triggers: r.triggers } : {}),
              ...(r.recommendedAngle ? { recommended_angle: r.recommendedAngle } : {}),
            }).eq('id', company.id)
          );
        });
      });
    }

    await Promise.allSettled(updatePromises);

    // 3. Store results in app_settings so the app shows a notification on next open
    const scanResult = {
      timestamp: new Date().toISOString(),
      scanned: companies.length,
      changes: changes.map(ch => ({
        name: ch.name,
        sigDelta: ch.sigDelta,
        icpDelta: ch.icpDelta,
        newSig: ch.newSig,
        newIcp: ch.newIcp,
        topTrigger: (ch.triggers as { headline?: string }[])[0]?.headline || null,
      })),
      toDeepScan,
      viewed: false,
    };

    await supabase.from('app_settings').upsert(
      { key: 'last_weekly_scan', value: scanResult, updated_at: new Date().toISOString() },
      { onConflict: 'key' }
    );

    return new Response(JSON.stringify({ ok: true, scanned: companies.length, changes: changes.length }), { status: 200 });

  } catch (err) {
    console.error('Weekly rescan failed:', err);
    return new Response(JSON.stringify({ ok: false, error: String(err) }), { status: 500 });
  }
});
