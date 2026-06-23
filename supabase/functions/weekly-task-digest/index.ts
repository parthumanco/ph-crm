import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const RESEND_API_KEY  = Deno.env.get('RESEND_API_KEY')!;
const SUPABASE_URL    = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_KEY    = Deno.env.get('SB_SERVICE_ROLE_KEY')!;
const FROM_EMAIL      = Deno.env.get('DIGEST_FROM_EMAIL') || 'digest@yourcompany.com';
const FROM_NAME       = Deno.env.get('DIGEST_FROM_NAME')  || 'Part Human CRM';

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// ── Date helpers ──────────────────────────────────────────────────────────────

function getWeekWindow() {
  const now    = new Date();
  // Start of this Monday
  const day    = now.getDay(); // 0=Sun, 1=Mon...
  const diffToMon = (day === 0 ? -6 : 1 - day);
  const monday = new Date(now);
  monday.setDate(now.getDate() + diffToMon);
  monday.setHours(0, 0, 0, 0);

  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  sunday.setHours(23, 59, 59, 999);

  return {
    start: monday.toISOString().slice(0, 10),
    end:   sunday.toISOString().slice(0, 10),
  };
}

function fmtDate(d: string) {
  if (!d) return '';
  const [y, m, day] = d.split('-');
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return `${months[parseInt(m) - 1]} ${parseInt(day)}`;
}

function isOverdue(dueDate: string, weekStart: string) {
  return dueDate < weekStart;
}

// ── Email template ────────────────────────────────────────────────────────────

function buildEmail(owner: string, tasks: Record<string, unknown>[], weekStart: string, weekEnd: string): string {
  const overdue  = tasks.filter((t: any) => t.due_date && isOverdue(t.due_date, weekStart));
  const thisWeek = tasks.filter((t: any) => t.due_date && !isOverdue(t.due_date, weekStart));
  const noDue    = tasks.filter((t: any) => !t.due_date);

  const taskRow = (t: any, urgent = false) => `
    <tr>
      <td style="padding:10px 16px;border-bottom:1px solid #f1f1f1;vertical-align:top;">
        <div style="font-size:14px;font-weight:600;color:${urgent ? '#dc2626' : '#1a1a1a'};margin-bottom:4px;">${t.title}</div>
        <div style="font-size:12px;color:#6b7280;">
          ${t._project ? `<span style="color:#f97316;font-weight:600;">${t._project}</span>` : ''}
          ${t._milestone ? ` › <span style="color:#6b7280;">${t._milestone}</span>` : ''}
          ${t.due_date ? ` · <span style="color:${urgent ? '#dc2626' : '#9ca3af'};">${urgent ? '⚠️ ' : ''}Due ${fmtDate(t.due_date)}</span>` : ''}
        </div>
      </td>
    </tr>`;

  const section = (title: string, color: string, rows: string) => rows ? `
    <tr><td style="padding:16px 16px 6px;background:#fafafa;">
      <div style="font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.06em;color:${color};">${title}</div>
    </td></tr>
    ${rows}` : '';

  return `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5;padding:32px 16px;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,.08);">

        <!-- Header -->
        <tr>
          <td style="background:linear-gradient(135deg,#1e1e2e 0%,#2d2d3d 100%);padding:28px 32px;">
            <div style="display:flex;align-items:center;gap:12px;">
              <div style="width:8px;height:36px;background:#f97316;border-radius:4px;display:inline-block;margin-right:10px;"></div>
              <div style="display:inline-block;vertical-align:top;">
                <div style="font-size:20px;font-weight:800;color:#fff;letter-spacing:-.02em;">Your week, ${owner} 👋</div>
                <div style="font-size:13px;color:#9ca3af;margin-top:2px;">${fmtDate(weekStart)} – ${fmtDate(weekEnd)}</div>
              </div>
            </div>
          </td>
        </tr>

        <!-- Summary bar -->
        <tr>
          <td style="background:#fff7ed;padding:12px 32px;border-bottom:2px solid #fed7aa;">
            <span style="font-size:13px;color:#92400e;font-weight:600;">
              ${tasks.length} task${tasks.length !== 1 ? 's' : ''} total
              ${overdue.length  ? ` · <span style="color:#dc2626;">${overdue.length} overdue</span>` : ''}
              ${thisWeek.length ? ` · ${thisWeek.length} due this week` : ''}
            </span>
          </td>
        </tr>

        <!-- Tasks -->
        <tr><td>
          <table width="100%" cellpadding="0" cellspacing="0">
            ${section('⚠️ Overdue',        '#dc2626', overdue.map(t  => taskRow(t, true)).join(''))}
            ${section('📅 Due This Week',   '#2563eb', thisWeek.map(t => taskRow(t, false)).join(''))}
            ${section('🗂 No Due Date',      '#6b7280', noDue.map(t   => taskRow(t, false)).join(''))}
            ${tasks.length === 0 ? `
            <tr><td style="padding:40px 32px;text-align:center;">
              <div style="font-size:32px;margin-bottom:12px;">🎉</div>
              <div style="font-size:16px;font-weight:700;color:#1a1a1a;">All clear!</div>
              <div style="font-size:13px;color:#6b7280;margin-top:6px;">No tasks due this week.</div>
            </td></tr>` : ''}
          </table>
        </td></tr>

        <!-- Footer -->
        <tr>
          <td style="background:#fafafa;padding:20px 32px;border-top:1px solid #f1f1f1;">
            <p style="margin:0;font-size:12px;color:#9ca3af;text-align:center;">
              Part Human CRM · Weekly Task Digest · Sent every Monday at 9 AM
            </p>
          </td>
        </tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

// ── Send via Resend ───────────────────────────────────────────────────────────

async function sendEmail(to: string, subject: string, html: string) {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${RESEND_API_KEY}`,
    },
    body: JSON.stringify({ from: `${FROM_NAME} <${FROM_EMAIL}>`, to, subject, html }),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(`Resend error: ${JSON.stringify(json)}`);
  return json;
}

// ── Main handler ──────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  try {
    // Allow manual trigger with ?owner=Mike to test a single person
    const url    = new URL(req.url);
    const single = url.searchParams.get('owner');

    // Load team email addresses from app_settings
    const { data: settingsRows } = await supabase
      .from('app_settings')
      .select('value')
      .eq('key', 'team_emails')
      .single();

    const teamEmails: Record<string, string> = settingsRows?.value || {};
    if (Object.keys(teamEmails).length === 0) {
      return new Response(JSON.stringify({ error: 'No team emails configured. Add them in ICP Settings.' }), {
        status: 400, headers: { 'Content-Type': 'application/json' },
      });
    }

    const owners = single ? [single] : Object.keys(teamEmails);
    const { start: weekStart, end: weekEnd } = getWeekWindow();

    // Load projects + milestones for name lookups
    const { data: projects  } = await supabase.from('projects').select('id,name').is('archived_at', null);
    const { data: milestones } = await supabase.from('project_milestones').select('id,title');
    const projMap = Object.fromEntries((projects || []).map((p: any) => [p.id, p.name]));
    const msMap   = Object.fromEntries((milestones || []).map((m: any) => [m.id, m.title]));

    const results: Record<string, unknown>[] = [];

    for (const owner of owners) {
      const email = teamEmails[owner];
      if (!email) { results.push({ owner, skipped: 'no email configured' }); continue; }

      // Fetch incomplete tasks: overdue OR due this week OR no due date
      const { data: tasks, error } = await supabase
        .from('project_tasks')
        .select('*')
        .eq('assigned_to', owner)
        .eq('completed', false)
        .is('deleted_at', null)
        .or(`due_date.lte.${weekEnd},due_date.is.null`)
        .order('due_date', { ascending: true, nullsFirst: false });

      if (error) { results.push({ owner, error: error.message }); continue; }

      const enriched = (tasks || []).map((t: any) => ({
        ...t,
        _project:   projMap[t.project_id]   || null,
        _milestone: msMap[t.milestone_id]   || null,
      }));

      const subject = enriched.length === 0
        ? `✅ All clear this week, ${owner}!`
        : `📋 You have ${enriched.length} task${enriched.length !== 1 ? 's' : ''} this week, ${owner}`;

      const html = buildEmail(owner, enriched, weekStart, weekEnd);
      const sent = await sendEmail(email, subject, html);
      results.push({ owner, email, tasks: enriched.length, messageId: sent.id });
    }

    return new Response(JSON.stringify({ ok: true, weekStart, weekEnd, results }), {
      headers: { 'Content-Type': 'application/json' },
    });

  } catch (err: any) {
    console.error('weekly-task-digest error:', err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: { 'Content-Type': 'application/json' },
    });
  }
});
