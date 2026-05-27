import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '../lib/supabase';
import { generateWeeklyPlan, generateEmailDraft, scanForNewTriggers } from '../lib/anthropic';
import { DEFAULT_ICP } from '../lib/settings';

function getMonday(d = new Date()) {
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  const mon = new Date(d);
  mon.setDate(diff);
  mon.setHours(0, 0, 0, 0);
  return mon;
}

function daysSince(dateStr) {
  if (!dateStr) return 999;
  return Math.floor((Date.now() - new Date(dateStr).getTime()) / 86400000);
}

function formatDate(d) {
  return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
}

function fmtShort(isoStr) {
  if (!isoStr) return '';
  return new Date(isoStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

const URGENCY_STYLES = {
  high:   { bg: '#fef2f2', border: '#fecaca', badge: '#ef4444', label: '🔴 HIGH PRIORITY SIGNAL' },
  medium: { bg: '#fffbeb', border: '#fde68a', badge: '#f59e0b', label: '🟡 NEW SIGNAL' },
  low:    { bg: '#f0fdf4', border: '#bbf7d0', badge: '#22c55e', label: '🟢 NEW SIGNAL' },
};

// ── Persistence helpers ───────────────────────────────────────────────────────

async function savePlanToHistory(weekKey, payload) {
  await supabase.from('app_settings').upsert(
    { key: `weekly_plan_${weekKey}`, value: payload, updated_at: new Date().toISOString() },
    { onConflict: 'key' }
  );
}

async function loadPlanHistory() {
  try {
    const { data } = await supabase
      .from('app_settings')
      .select('key, value, updated_at')
      .like('key', 'weekly_plan_%')
      .order('key', { ascending: false });
    return (data || []).map(row => ({ ...row.value, _savedAt: row.updated_at, _key: row.key }));
  } catch {
    return [];
  }
}

// ── Main component ────────────────────────────────────────────────────────────

export default function WeeklyReportPage({ icp = DEFAULT_ICP, refreshKey = 0 }) {
  const [entries, setEntries]       = useState([]);
  const [companies, setCompanies]   = useState({});
  const [touches, setTouches]       = useState([]);
  const [report, setReport]         = useState(null);
  const [generating, setGenerating] = useState(false);
  const [emailDrafts, setEmailDrafts]     = useState({});
  const [triggerFindings, setTriggerFindings] = useState({});
  const [expandedEmail, setExpandedEmail] = useState(null);
  const [error, setError]           = useState(null);
  const [history, setHistory]       = useState([]);
  const [expandedHistory, setExpandedHistory] = useState({});
  const [expandedHistoryEmail, setExpandedHistoryEmail] = useState({});

  // Progress for the background scan+draft pipeline
  // { phase: 'scanning'|'drafting'|'done', current, total, currentName }
  const [autoProgress, setAutoProgress] = useState(null);

  // Ref so scanAndDraft always sees the latest plan data even after re-renders
  const planRef = useRef({ newOutreach: [], followupsDue: [] });

  const weekStart  = getMonday();
  const weekKey    = weekStart.toISOString().slice(0, 10);
  const weekLabel  = `Week of ${formatDate(weekStart)}`;

  const load = useCallback(async () => {
    try {
      const [{ data: ents, error: e1 }, { data: tchs, error: e3 }] = await Promise.all([
        supabase.from('pipeline_entries').select('*').eq('status', 'active'),
        supabase.from('touches').select('*'),
      ]);
      if (e1 || e3) console.error('WeeklyReport load error:', e1 || e3);
      const companyIds = (ents || []).map(e => e.company_id).filter(Boolean);
      const { data: comps, error: e2 } = companyIds.length
        ? await supabase.from('companies').select('*').in('id', companyIds)
        : { data: [] };
      if (e2) console.error('WeeklyReport companies load error:', e2);
      setEntries(ents || []);
      const compMap = {};
      (comps || []).forEach(c => { compMap[c.id] = c; });
      setCompanies(compMap);
      setTouches(tchs || []);
    } catch (e) {
      console.error('WeeklyReport load error:', e);
    }
  }, [refreshKey]);

  useEffect(() => {
    load();
    loadPlanHistory().then(h => {
      const thisWeek = h.find(p => p.weekKey === weekKey);
      if (thisWeek) {
        setReport({ briefing: thisWeek.briefing, generated: thisWeek.generatedAt });
        setEmailDrafts(thisWeek.emailDrafts || {});
        setTriggerFindings(thisWeek.triggerFindings || {});
      }
      setHistory(h.filter(p => p.weekKey !== weekKey));
    });
  }, [load]);

  // Compute what's due this week
  const computePlan = useCallback(() => {
    const newOutreach  = [];
    const followupsDue = [];
    entries.forEach(entry => {
      const company = companies[entry.company_id];
      if (!company) return;
      const entryTouches = touches.filter(t => t.pipeline_entry_id === entry.id);
      const sentTouches  = entryTouches.filter(t => t.status === 'sent').sort((a, b) => new Date(b.sent_date) - new Date(a.sent_date));

      // Determine how many touches have actually been completed. Use the higher of:
      // (a) the max touch_number with status=sent in the touches table, or
      // (b) entry.current_touch set manually in Active Prospects.
      const maxSentTouchNum = sentTouches.reduce((max, t) => Math.max(max, t.touch_number || 0), 0);
      const completedTouches = Math.max(maxSentTouchNum, entry.current_touch || 0);

      if (completedTouches === 0) {
        newOutreach.push({ entry, company });
      } else {
        const lastSent = sentTouches[0];
        const lastDateStr = lastSent?.sent_date;
        const days = daysSince(lastDateStr);
        const nextTouch = completedTouches + 1;

        // Retroactive-logging detection: if touches were all logged today but the
        // pipeline entry is older than 7 days, the sent dates are back-filled.
        // In that case bypass the 7-day gate so follow-ups surface correctly.
        const todayStr = new Date().toISOString().slice(0, 10);
        const entryAgeDays = daysSince(entry.created_at);
        const retroactive = lastDateStr === todayStr && entryAgeDays >= 7;

        if (nextTouch <= 5 && (days >= 7 || retroactive)) {
          followupsDue.push({ entry, company, touchNumber: nextTouch, daysSince: days, lastTouch: completedTouches });
        }
      }
    });
    return { newOutreach, followupsDue };
  }, [entries, companies, touches]);

  const { newOutreach, followupsDue } = computePlan();

  // Keep ref in sync so scanAndDraft can read the latest plan
  useEffect(() => {
    planRef.current = { newOutreach, followupsDue };
  }, [newOutreach, followupsDue]);

  const buildSnapshot = (briefing, drafts, triggers) => ({
    weekKey,
    weekLabel,
    briefing,
    generatedAt: new Date().toISOString(),
    newOutreach: planRef.current.newOutreach.map(({ entry, company }) => ({
      key: `${entry.id}-1`,
      companyName: company.name,
      contactName: (company.contacts || [])[0]?.name || '',
      contactTitle: (company.contacts || [])[0]?.title || '',
      touchNumber: 1,
    })),
    followupsDue: planRef.current.followupsDue.map(({ entry, company, touchNumber, daysSince: days }) => ({
      key: `${entry.id}-${touchNumber}`,
      companyName: company.name,
      contactName: (company.contacts || [])[0]?.name || '',
      contactTitle: (company.contacts || [])[0]?.title || '',
      touchNumber,
      daysSince: days,
    })),
    emailDrafts: drafts || {},
    triggerFindings: triggers || {},
  });

  // ── Background scan + draft pipeline ─────────────────────────────────────────
  const scanAndDraft = async (briefing) => {
    const { newOutreach: no, followupsDue: fd } = planRef.current;
    const allItems = [
      ...no.map(({ entry, company }) => ({
        entry, company, touchNumber: 1,
        key: `${entry.id}-1`,
        daysSince: 14, // no previous touch — scan last 14 days
      })),
      ...fd.map(({ entry, company, touchNumber, daysSince: days }) => ({
        entry, company, touchNumber,
        key: `${entry.id}-${touchNumber}`,
        daysSince: days,
      })),
    ];

    if (allItems.length === 0) return;

    const accTriggers = {};
    const accDrafts   = {};

    // ── Phase 1: Scan each company for new triggers ───────────────────────────
    for (let i = 0; i < allItems.length; i++) {
      const item = allItems[i];
      setAutoProgress({ phase: 'scanning', current: i + 1, total: allItems.length, currentName: item.company.name });
      try {
        const result = await scanForNewTriggers(item.company, item.daysSince);
        if (result.found && result.newTriggers?.length > 0) {
          accTriggers[item.key] = result.newTriggers;
          setTriggerFindings(t => ({ ...t, [item.key]: result.newTriggers }));
        }
      } catch (e) {
        console.warn(`Trigger scan failed for ${item.company.name}:`, e);
      }
    }

    // Save trigger findings so they survive a navigation mid-pipeline
    await savePlanToHistory(weekKey, buildSnapshot(briefing, {}, accTriggers));

    // ── Phase 2: Draft emails — save after every single draft ────────────────
    for (let i = 0; i < allItems.length; i++) {
      const item = allItems[i];
      setAutoProgress({ phase: 'drafting', current: i + 1, total: allItems.length, currentName: item.company.name });
      const contact = (item.company.contacts || [])[0] || { name: 'the decision-maker', title: '' };
      try {
        let result;
        if (item.touchNumber === 3) {
          const { generateLinkedInDrafts } = await import('../lib/anthropic');
          result = { type: 'linkedin', ...(await generateLinkedInDrafts(item.company, contact, null, item.company.engagement_type || 'Sprint')), contact };
        } else {
          result = { type: 'email', ...(await generateEmailDraft(item.touchNumber, item.company, contact, item.company.recommended_angle, icp, null, item.company.engagement_type || 'Sprint')), contact };
        }
        accDrafts[item.key] = result;
      } catch (e) {
        accDrafts[item.key] = { error: e.message };
      }
      setEmailDrafts(d => ({ ...d, [item.key]: accDrafts[item.key] }));
      // Persist immediately — if user navigates away, this draft is already saved
      await savePlanToHistory(weekKey, buildSnapshot(briefing, { ...accDrafts }, accTriggers));
      await new Promise(r => setTimeout(r, 300));
    }

    setAutoProgress({ phase: 'done', current: allItems.length, total: allItems.length, currentName: '' });
    setTimeout(() => setAutoProgress(null), 3000);
  };

  const generate = async () => {
    setGenerating(true);
    setError(null);
    setEmailDrafts({});
    setTriggerFindings({});
    setAutoProgress(null);
    try {
      const briefing = await generateWeeklyPlan(
        newOutreach.map(({ company }) => ({ name: company.name, recommended_angle: company.recommended_angle, summary: company.summary })),
        followupsDue.map(({ company, touchNumber }) => ({ companyName: company.name, touchNumber, contactName: (company.contacts || [])[0]?.name })),
        icp
      );
      setReport({ briefing, generated: new Date().toISOString() });
      await savePlanToHistory(weekKey, buildSnapshot(briefing, {}, {}));
      // Fire-and-forget the scan+draft pipeline
      scanAndDraft(briefing);
    } catch (e) {
      setError(e.message);
    } finally {
      setGenerating(false);
    }
  };

  const copyDraft = async (key, drafts = emailDrafts) => {
    const d = drafts[key];
    if (!d) return;
    const text = d.type === 'linkedin'
      ? `CONNECTION NOTE:\n${d.connection_note}\n\n---\nPOST-ACCEPTANCE DM:\n${d.acceptance_dm}`
      : `Subject: ${d.subject}\n\n${d.body}`;
    await navigator.clipboard.writeText(text);
  };

  const totalActions = newOutreach.length + followupsDue.length;
  const progressPct  = autoProgress ? Math.round((autoProgress.current / autoProgress.total) * 100) : 0;

  return (
    <>
      <div className="page-header">
        <div className="page-header-left">
          <h2>📋 Weekly Outreach</h2>
          <p>{weekLabel} · {totalActions} action{totalActions !== 1 ? 's' : ''} due</p>
        </div>
        <div className="page-header-actions">
          <button className="btn btn-primary" onClick={generate} disabled={generating || !!autoProgress}>
            {generating ? <><span className="spinner" /> Generating…</> : '🚀 Generate This Week\'s Plan'}
          </button>
        </div>
      </div>

      <div className="page-body">
        {error && <div className="alert alert-error">⚠️ {error}</div>}

        {/* Scan + draft progress bar */}
        {autoProgress && autoProgress.phase !== 'done' && (
          <div style={{ marginBottom: 20, padding: '14px 18px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span className="spinner" />
                <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>
                  {autoProgress.phase === 'scanning'
                    ? `🔍 Scanning ${autoProgress.currentName} for new signals…`
                    : `✍️ Drafting email for ${autoProgress.currentName}…`}
                </span>
              </div>
              <span style={{ fontSize: 12, color: 'var(--text-muted)', fontWeight: 600 }}>
                {autoProgress.current}/{autoProgress.total}
              </span>
            </div>
            <div style={{ height: 6, background: 'var(--border)', borderRadius: 3, overflow: 'hidden' }}>
              <div style={{
                height: '100%',
                width: `${progressPct}%`,
                background: autoProgress.phase === 'scanning' ? '#f59e0b' : 'var(--accent)',
                borderRadius: 3,
                transition: 'width .4s ease',
              }} />
            </div>
            <div style={{ display: 'flex', gap: 16, marginTop: 8 }}>
              {[
                { label: 'Scanning for signals', done: autoProgress.phase === 'drafting' || autoProgress.phase === 'done', active: autoProgress.phase === 'scanning' },
                { label: 'Drafting emails', done: autoProgress.phase === 'done', active: autoProgress.phase === 'drafting' },
              ].map(step => (
                <span key={step.label} style={{ fontSize: 11, color: step.done ? '#16a34a' : step.active ? 'var(--accent)' : 'var(--text-faint)', fontWeight: step.active ? 700 : 400 }}>
                  {step.done ? '✓ ' : step.active ? '● ' : '○ '}{step.label}
                </span>
              ))}
            </div>
          </div>
        )}

        {autoProgress?.phase === 'done' && (
          <div className="alert" style={{ marginBottom: 20, background: '#f0fdf4', border: '1px solid #bbf7d0', color: '#15803d' }}>
            <span>✅</span>
            <span>Scan complete — all emails drafted and saved.</span>
          </div>
        )}

        {/* Stats */}
        <div className="stats-row cols-3" style={{ marginBottom: 20 }}>
          <div className="stat-card">
            <div className="stat-val">{newOutreach.length}</div>
            <div className="stat-label">New Outreach (T1)</div>
            <div className="stat-sub">Send Monday or Thursday</div>
          </div>
          <div className="stat-card">
            <div className="stat-val" style={{ color: followupsDue.length > 0 ? 'var(--amber)' : 'var(--green)' }}>{followupsDue.length}</div>
            <div className="stat-label">Follow-Ups Due</div>
            <div className="stat-sub">T2–T5 based on cadence</div>
          </div>
          <div className="stat-card">
            <div className="stat-val">{totalActions}</div>
            <div className="stat-label">Total Touches</div>
            <div className="stat-sub">This week</div>
          </div>
        </div>

        {/* AI Briefing */}
        {report && (
          <div className="card" style={{ marginBottom: 20 }}>
            <div className="card-header">
              <h3>🤖 AI Briefing</h3>
              <span style={{ fontSize: 11, color: 'var(--text-faint)' }}>Generated {new Date(report.generated).toLocaleTimeString()}</span>
            </div>
            <div className="card-body">
              <MarkdownBriefing text={report.briefing} />
            </div>
          </div>
        )}

        {/* Weekly rhythm reminder */}
        <div className="alert alert-info" style={{ marginBottom: 20 }}>
          <span>📅</span>
          <div>
            <strong>Weekly Rhythm:</strong> &nbsp;
            <strong>Monday</strong> — Review pipeline, identify new companies, draft outreach. &nbsp;
            <strong>Thursday</strong> — Send 3–5 emails + LinkedIn touches. &nbsp;
            <strong>Friday</strong> — Log responses, move deals, set top 3 for next week.
          </div>
        </div>

        {/* New Outreach Section */}
        {newOutreach.length > 0 && (
          <div style={{ marginBottom: 24 }}>
            <div style={{ fontSize: 13, marginBottom: 10, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <span style={{ background: 'var(--accent)', color: '#fff', borderRadius: '50%', width: 22, height: 22, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 800, flexShrink: 0 }}>1</span>
              <span style={{ fontWeight: 800, color: 'var(--text)' }}>New Outreach — Touch 1 Initial Emails</span>
              <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>: Touch 1 is about earning the right to a conversation, not pitching. One sharp, specific insight about their business. Show them you did the work.</span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {newOutreach.map(({ entry, company }) => {
                const key = `${entry.id}-1`;
                return (
                  <OutreachCard
                    key={entry.id}
                    company={company}
                    contact={(company.contacts || [])[0]}
                    touchNumber={1}
                    draft={emailDrafts[key]}
                    triggers={triggerFindings[key]}
                    expanded={expandedEmail === key}
                    onExpand={() => setExpandedEmail(expandedEmail === key ? null : key)}
                    onCopy={() => copyDraft(key)}
                  />
                );
              })}
            </div>
          </div>
        )}

        {/* Follow-Ups Section — grouped by touch number */}
        {followupsDue.length > 0 && (
          <div style={{ marginBottom: 24 }}>
            <h3 style={{ fontSize: 15, fontWeight: 800, marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ background: 'var(--amber)', color: '#fff', borderRadius: '50%', width: 22, height: 22, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 800 }}>↩</span>
              Follow-Ups Due
            </h3>
            {[2, 3, 4, 5].map(tn => {
              const group = followupsDue.filter(f => f.touchNumber === tn);
              if (!group.length) return null;
              const meta = TOUCH_GROUP_META[tn];
              return (
                <div key={tn} style={{ marginBottom: 28 }}>

                  {/* ── Section heading + reminder on one line ── */}
                  <div style={{ marginBottom: 10, fontSize: 13, color: 'var(--text)' }}>
                    <span style={{ fontWeight: 800 }}>
                      <span style={{ color: 'var(--text-muted)', fontWeight: 600 }}>{meta.prefix}</span>
                      {meta.name}
                    </span>
                    <span style={{ color: 'var(--text-muted)', fontWeight: 400, marginLeft: 2 }}>: {meta.reminder}</span>
                  </div>

                  {/* ── Company cards ── */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {group.map(({ entry, company, touchNumber, daysSince: days }) => {
                      const key = `${entry.id}-${touchNumber}`;
                      return (
                        <OutreachCard
                          key={key}
                          company={company}
                          contact={(company.contacts || [])[0]}
                          touchNumber={touchNumber}
                          touchColor={meta.color}
                          daysSince={days}
                          draft={emailDrafts[key]}
                          triggers={triggerFindings[key]}
                          expanded={expandedEmail === key}
                          onExpand={() => setExpandedEmail(expandedEmail === key ? null : key)}
                          onCopy={() => copyDraft(key)}
                        />
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {totalActions === 0 && (
          <div className="empty-state">
            <div className="empty-icon">🎉</div>
            <h3>You're all caught up!</h3>
            <p>No touches due this week. Add new companies via Signal Watch to keep the pipeline full.</p>
          </div>
        )}

        {/* ── Past Weekly Plans ──────────────────────────────────────────── */}
        {history.length > 0 && (
          <div style={{ marginTop: 40 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
              <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
              <span style={{ fontSize: 11, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '.07em', color: 'var(--text-faint)', whiteSpace: 'nowrap' }}>
                📚 Past Weekly Plans
              </span>
              <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {history.map(plan => {
                const isOpen   = !!expandedHistory[plan._key];
                const allItems = [...(plan.newOutreach || []), ...(plan.followupsDue || [])];
                const emailCount = Object.keys(plan.emailDrafts || {}).filter(k => !plan.emailDrafts[k].error).length;
                const triggerCount = Object.values(plan.triggerFindings || {}).flat().length;

                return (
                  <div key={plan._key} style={{ border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden', background: 'var(--surface)' }}>
                    <div
                      onClick={() => setExpandedHistory(prev => ({ ...prev, [plan._key]: !prev[plan._key] }))}
                      style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 18px', cursor: 'pointer', userSelect: 'none' }}
                    >
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontWeight: 700, fontSize: 14 }}>{plan.weekLabel}</div>
                        <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
                          {allItems.length} action{allItems.length !== 1 ? 's' : ''}
                          {emailCount > 0 && ` · ${emailCount} email${emailCount !== 1 ? 's' : ''} saved`}
                          {triggerCount > 0 && <span style={{ color: '#f59e0b', fontWeight: 600 }}> · {triggerCount} signal{triggerCount !== 1 ? 's' : ''} found</span>}
                          {plan._savedAt && <span style={{ color: 'var(--text-faint)' }}> · {fmtShort(plan._savedAt)}</span>}
                        </div>
                      </div>
                      <span style={{ fontSize: 13, color: 'var(--text-faint)' }}>{isOpen ? '▲' : '▼'}</span>
                    </div>

                    {isOpen && (
                      <div style={{ borderTop: '1px solid var(--border-light)' }}>
                        {plan.briefing && (
                          <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border-light)', background: 'var(--bg)' }}>
                            <div style={{ fontSize: 11, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '.05em', color: 'var(--text-faint)', marginBottom: 8 }}>AI Briefing</div>
                            <MarkdownBriefing text={plan.briefing} />
                          </div>
                        )}

                        {allItems.length > 0 && (
                          <div style={{ padding: '14px 20px' }}>
                            <div style={{ fontSize: 11, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '.05em', color: 'var(--text-faint)', marginBottom: 10 }}>Outreach</div>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                              {allItems.map(item => {
                                const emailKey  = `${plan._key}__${item.key}`;
                                const draft     = (plan.emailDrafts || {})[item.key];
                                const triggers  = (plan.triggerFindings || {})[item.key];
                                const isEmailOpen = !!expandedHistoryEmail[emailKey];

                                return (
                                  <div key={item.key} style={{ border: '1px solid var(--border-light)', borderRadius: 8, overflow: 'hidden', background: 'var(--surface)' }}>
                                    <div
                                      style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', cursor: draft && !draft.error ? 'pointer' : 'default' }}
                                      onClick={() => draft && !draft.error && setExpandedHistoryEmail(prev => ({ ...prev, [emailKey]: !prev[emailKey] }))}
                                    >
                                      <span style={{ background: item.touchNumber === 1 ? 'var(--accent)' : 'var(--amber)', color: '#fff', borderRadius: 4, padding: '2px 7px', fontSize: 10, fontWeight: 700, fontFamily: 'monospace', flexShrink: 0 }}>
                                        {TOUCH_LABELS[item.touchNumber]}
                                      </span>
                                      <span style={{ fontWeight: 700, fontSize: 13 }}>{item.companyName}</span>
                                      {item.contactName && (
                                        <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>→ {item.contactName}{item.contactTitle ? `, ${item.contactTitle}` : ''}</span>
                                      )}
                                      {triggers?.length > 0 && (
                                        <span style={{ fontSize: 10, fontWeight: 700, background: '#fef3c7', color: '#92400e', padding: '2px 7px', borderRadius: 8, border: '1px solid #fde68a', flexShrink: 0 }}>
                                          ⚡ {triggers.length} signal{triggers.length !== 1 ? 's' : ''}
                                        </span>
                                      )}
                                      <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
                                        {draft && !draft.error ? (
                                          <>
                                            <button className="btn btn-ghost btn-xs" onClick={e => { e.stopPropagation(); copyDraft(item.key, plan.emailDrafts); }}>📋 Copy</button>
                                            <span style={{ fontSize: 11, color: 'var(--text-faint)' }}>{isEmailOpen ? '▲' : '▼'}</span>
                                          </>
                                        ) : (
                                          <span style={{ fontSize: 11, color: 'var(--text-faint)' }}>No draft saved</span>
                                        )}
                                      </div>
                                    </div>

                                    {isEmailOpen && (
                                      <div style={{ borderTop: '1px solid var(--border-light)' }}>
                                        {triggers?.length > 0 && <TriggerCallout triggers={triggers} />}
                                        {draft && !draft.error && (
                                          <div style={{ padding: '12px 16px', background: 'var(--bg)' }}>
                                            {draft.type === 'linkedin' ? (
                                              <>
                                                <div style={{ marginBottom: 10 }}>
                                                  <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', marginBottom: 4 }}>Connection Request Note</div>
                                                  <div className="email-draft" style={{ minHeight: 'unset' }}>{draft.connection_note}</div>
                                                </div>
                                                <div>
                                                  <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', marginBottom: 4 }}>Post-Acceptance DM</div>
                                                  <div className="email-draft">{draft.acceptance_dm}</div>
                                                </div>
                                              </>
                                            ) : (
                                              <>
                                                <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-muted)', marginBottom: 6 }}>
                                                  Subject: <span style={{ color: 'var(--text)', fontWeight: 600 }}>{draft.subject}</span>
                                                </div>
                                                <div className="email-draft">{draft.body}</div>
                                              </>
                                            )}
                                          </div>
                                        )}
                                      </div>
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </>
  );
}

// ── Markdown briefing renderer ────────────────────────────────────────────────

function renderInline(str) {
  const parts = str.split(/\*\*([^*]+)\*\*/g);
  return parts.map((part, i) =>
    i % 2 === 1 ? <strong key={i} style={{ fontWeight: 700, color: 'var(--text)' }}>{part}</strong> : part
  );
}

function MarkdownBriefing({ text }) {
  if (!text) return null;

  const lines = text.split('\n');
  const elements = [];
  let listBuffer = [];
  let listType = null;

  function flushList(idx) {
    if (!listBuffer.length) return;
    const items = listBuffer.map((item, j) => (
      <li key={j} style={{ fontSize: 13, lineHeight: 1.65, color: 'var(--text)', paddingLeft: 2 }}>
        {renderInline(item)}
      </li>
    ));
    const style = { margin: '6px 0 6px 0', paddingLeft: 20, display: 'flex', flexDirection: 'column', gap: 3 };
    elements.push(
      listType === 'ol'
        ? <ol key={`list-${idx}`} style={style}>{items}</ol>
        : <ul key={`list-${idx}`} style={style}>{items}</ul>
    );
    listBuffer = [];
    listType = null;
  }

  lines.forEach((line, i) => {
    const t = line.trim();

    if (!t) { flushList(i); return; }

    // Full-line bold → section heading
    const headingMatch = t.match(/^\*\*(.+?)\*\*:?\s*$/);
    if (headingMatch) {
      flushList(i);
      const txt = headingMatch[1];
      // First occurrence of "Part Human" title → render as a prominent title line
      const isTitle = txt.includes('Part Human') || txt.includes('Briefing');
      elements.push(
        <p key={i} style={{
          fontSize: isTitle ? 15 : 13,
          fontWeight: 800,
          color: isTitle ? 'var(--accent)' : 'var(--text)',
          margin: isTitle ? '0 0 12px' : '18px 0 4px',
          letterSpacing: isTitle ? '-.01em' : '.01em',
          textTransform: isTitle ? 'none' : 'uppercase',
          borderBottom: isTitle ? '2px solid var(--accent)' : 'none',
          paddingBottom: isTitle ? 8 : 0,
        }}>
          {txt}
        </p>
      );
      return;
    }

    // Bullet list
    const bullet = t.match(/^[-•*]\s+(.+)/);
    if (bullet) {
      if (listType !== 'ul') { flushList(i); listType = 'ul'; }
      listBuffer.push(bullet[1]);
      return;
    }

    // Numbered list
    const num = t.match(/^\d+\.\s+(.+)/);
    if (num) {
      if (listType !== 'ol') { flushList(i); listType = 'ol'; }
      listBuffer.push(num[1]);
      return;
    }

    // Regular paragraph
    flushList(i);
    elements.push(
      <p key={i} style={{ fontSize: 13, lineHeight: 1.75, margin: '4px 0', color: 'var(--text)' }}>
        {renderInline(t)}
      </p>
    );
  });

  flushList(lines.length);

  return <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>{elements}</div>;
}

// ── Shared sub-components ─────────────────────────────────────────────────────

const TOUCH_LABELS = {
  1: 'T1 · Initial Email',
  2: 'T2 · Follow-Up Email',
  3: 'T3 · LinkedIn',
  4: 'T4 · Goodwill',
  5: 'T5 · Close the Loop',
};

const TOUCH_GROUP_META = {
  2: {
    prefix:   'T2 · ',
    name:     'Follow-Up Email',
    label:    'T2 · Follow-Up Email',
    color:    '#3b82f6',
    headerBg: '#eff6ff',
    reminder: 'Reference your first email briefly — one sentence, then add a new angle or question. Keep it under 5 lines.',
  },
  3: {
    prefix:   'T3 · ',
    name:     'LinkedIn',
    label:    'T3 · LinkedIn',
    color:    '#0077b5',
    headerBg: '#e8f4fd',
    reminder: 'Send a connection request with a short personalized note (under 300 chars). No pitch — just earn the connection.',
  },
  4: {
    prefix:   'T4 · ',
    name:     'Goodwill',
    label:    'T4 · Goodwill',
    color:    '#8b5cf6',
    headerBg: '#f5f3ff',
    reminder: 'No ask. Share something genuinely useful — an article, an insight, a relevant data point. Build goodwill.',
  },
  5: {
    prefix:   'T5 · ',
    name:     'Close the Loop',
    label:    'T5 · Close the Loop',
    color:    '#6b7280',
    headerBg: '#f9fafb',
    reminder: 'Final touch. Make it easy to say no — or yes. A graceful close leaves the door open for next quarter.',
  },
};

function TriggerCallout({ triggers = [] }) {
  if (!triggers.length) return null;
  const topUrgency = triggers.some(t => t.urgency === 'high') ? 'high'
                   : triggers.some(t => t.urgency === 'medium') ? 'medium' : 'low';
  const s = URGENCY_STYLES[topUrgency] || URGENCY_STYLES.medium;

  return (
    <div style={{ margin: '0', padding: '12px 16px', background: s.bg, borderBottom: `1px solid ${s.border}` }}>
      <div style={{ fontSize: 11, fontWeight: 800, color: s.badge, letterSpacing: '.04em', marginBottom: 6 }}>
        {s.label}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {triggers.map((t, i) => {
          const ts = URGENCY_STYLES[t.urgency] || URGENCY_STYLES.medium;
          return (
            <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
              <span style={{ fontSize: 10, fontWeight: 800, background: ts.badge, color: '#fff', padding: '2px 6px', borderRadius: 4, flexShrink: 0, marginTop: 1 }}>{t.urgency?.toUpperCase()}</span>
              <div style={{ flex: 1 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 13, fontWeight: 600, color: '#1a1a1a' }}>{t.headline}</span>
                  {t.date && <span style={{ fontSize: 11, color: '#6b7280' }}>{t.date}</span>}
                  {t.source === 'contact' && (
                    <span style={{ fontSize: 10, fontWeight: 700, background: '#dbeafe', color: '#1d4ed8', padding: '1px 6px', borderRadius: 6, border: '1px solid #bfdbfe' }}>
                      LinkedIn{t.contactName ? ` · ${t.contactName}` : ''}
                    </span>
                  )}
                </div>
                {t.detail && <div style={{ fontSize: 12, color: '#4b5563', marginTop: 2, lineHeight: 1.5 }}>{t.detail}</div>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function OutreachCard({ company, contact, touchNumber, touchColor, daysSince, draft, triggers, expanded, onExpand, onCopy }) {
  const [copiedLocal, setCopiedLocal] = useState(false);
  const doCopy = async () => {
    await onCopy();
    setCopiedLocal(true);
    setTimeout(() => setCopiedLocal(false), 2000);
  };

  const hasTriggers = triggers?.length > 0;

  return (
    <div className="card">
      <div
        className="card-header"
        style={{ cursor: draft ? 'pointer' : 'default' }}
        onClick={() => draft && onExpand()}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flex: 1, flexWrap: 'wrap' }}>
          <span style={{ background: touchColor || (touchNumber === 1 ? 'var(--accent)' : 'var(--amber)'), color: '#fff', borderRadius: 4, padding: '2px 8px', fontSize: 11, fontWeight: 700, fontFamily: 'monospace' }}>
            {TOUCH_LABELS[touchNumber]}
          </span>
          <span style={{ fontWeight: 700 }}>{company.name}</span>
          {contact && <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>→ {contact.name}{contact.title ? `, ${contact.title}` : ''}</span>}
          {daysSince !== undefined && <span style={{ fontSize: 11, color: 'var(--red)', fontWeight: 600 }}>{daysSince}d overdue</span>}
          {hasTriggers && (
            <span style={{ fontSize: 10, fontWeight: 700, background: '#fef3c7', color: '#92400e', padding: '2px 8px', borderRadius: 8, border: '1px solid #fde68a' }}>
              ⚡ {triggers.length} new signal{triggers.length !== 1 ? 's' : ''}
            </span>
          )}
        </div>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          {draft && !draft.error && (
            <button className="btn btn-ghost btn-xs" onClick={e => { e.stopPropagation(); doCopy(); }}>
              {copiedLocal ? '✅ Copied' : '📋 Copy'}
            </button>
          )}
          {draft?.error && <span style={{ fontSize: 11, color: 'var(--red)' }}>⚠️ Error</span>}
          {!draft && <span style={{ fontSize: 11, color: 'var(--text-faint)' }}>Generating…</span>}
        </div>
      </div>

      {expanded && (
        <>
          {hasTriggers && <TriggerCallout triggers={triggers} />}
          {draft && !draft.error && (
            <div className="card-body">
              {draft.type === 'linkedin' ? (
                <>
                  <div style={{ marginBottom: 12 }}>
                    <label>Connection Request Note</label>
                    <div className="email-draft" style={{ minHeight: 60 }}>{draft.connection_note}</div>
                    <p style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>{(draft.connection_note || '').length} / 300 characters</p>
                  </div>
                  <div>
                    <label>Post-Acceptance DM</label>
                    <div className="email-draft">{draft.acceptance_dm}</div>
                  </div>
                </>
              ) : (
                <>
                  <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-muted)', marginBottom: 6 }}>
                    Subject: <span style={{ color: 'var(--text)', fontWeight: 600 }}>{draft.subject}</span>
                  </div>
                  <div className="email-draft">{draft.body}</div>
                </>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
