import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { generateWeeklyPlan, generateEmailDraft } from '../lib/anthropic';
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
  const [generatingEmails, setGeneratingEmails] = useState(false);
  const [emailDrafts, setEmailDrafts] = useState({});
  const [expandedEmail, setExpandedEmail] = useState(null);
  const [error, setError]           = useState(null);
  const [history, setHistory]       = useState([]);
  const [expandedHistory, setExpandedHistory] = useState({});
  const [expandedHistoryEmail, setExpandedHistoryEmail] = useState({});

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
      // Filter out the current week — it lives in the "active" section
      setHistory(h.filter(p => p.weekKey !== weekKey));
    });
  }, [load]);

  // Determine what's due this week
  const computePlan = useCallback(() => {
    const newOutreach  = [];
    const followupsDue = [];

    entries.forEach(entry => {
      const company = companies[entry.company_id];
      if (!company) return;
      const entryTouches = touches.filter(t => t.pipeline_entry_id === entry.id);
      const sentTouches  = entryTouches.filter(t => t.status === 'sent').sort((a, b) => new Date(b.sent_date) - new Date(a.sent_date));

      if (sentTouches.length === 0) {
        newOutreach.push({ entry, company });
      } else {
        const lastSent = sentTouches[0];
        const days     = daysSince(lastSent.sent_date);
        const maxSentTouchNum = sentTouches.reduce((max, t) => Math.max(max, t.touch_number || 0), 0);
        const nextTouch = maxSentTouchNum + 1;
        if (nextTouch <= 5 && days >= 7) {
          followupsDue.push({ entry, company, touchNumber: nextTouch, daysSince: days, lastTouch: maxSentTouchNum });
        }
      }
    });

    return { newOutreach, followupsDue };
  }, [entries, companies, touches]);

  const { newOutreach, followupsDue } = computePlan();

  // Build a serialisable snapshot of the current plan for history storage
  const buildSnapshot = useCallback((briefing, drafts) => ({
    weekKey,
    weekLabel,
    briefing,
    generatedAt: new Date().toISOString(),
    newOutreach: newOutreach.map(({ entry, company }) => ({
      key: `${entry.id}-1`,
      companyName: company.name,
      contactName: (company.contacts || [])[0]?.name || '',
      contactTitle: (company.contacts || [])[0]?.title || '',
      touchNumber: 1,
    })),
    followupsDue: followupsDue.map(({ entry, company, touchNumber, daysSince: days }) => ({
      key: `${entry.id}-${touchNumber}`,
      companyName: company.name,
      contactName: (company.contacts || [])[0]?.name || '',
      contactTitle: (company.contacts || [])[0]?.title || '',
      touchNumber,
      daysSince: days,
    })),
    emailDrafts: drafts || {},
  }), [weekKey, weekLabel, newOutreach, followupsDue]);

  const generate = async () => {
    setGenerating(true);
    setError(null);
    setEmailDrafts({});
    try {
      const briefing = await generateWeeklyPlan(
        newOutreach.map(({ company }) => ({ name: company.name, recommended_angle: company.recommended_angle, summary: company.summary })),
        followupsDue.map(({ company, touchNumber }) => ({ companyName: company.name, touchNumber, contactName: (company.contacts || [])[0]?.name })),
        icp
      );
      setReport({ briefing, generated: new Date().toISOString() });
      // Auto-save plan (no emails yet)
      await savePlanToHistory(weekKey, buildSnapshot(briefing, {}));
    } catch (e) {
      setError(e.message);
    } finally {
      setGenerating(false);
    }
  };

  const generateAllEmails = async () => {
    setGeneratingEmails(true);
    const allItems = [
      ...newOutreach.map(({ entry, company }) => ({ entry, company, touchNumber: 1, key: `${entry.id}-1` })),
      ...followupsDue.map(({ entry, company, touchNumber }) => ({ entry, company, touchNumber, key: `${entry.id}-${touchNumber}` })),
    ];

    const newDrafts = { ...emailDrafts };
    try {
      for (const item of allItems) {
        const contact = (item.company.contacts || [])[0] || { name: 'the decision-maker', title: '' };
        try {
          if (item.touchNumber === 3) {
            const { generateLinkedInDrafts } = await import('../lib/anthropic');
            const result = await generateLinkedInDrafts(item.company, contact, null, item.company.engagement_type || 'Sprint');
            newDrafts[item.key] = { type: 'linkedin', ...result, contact };
          } else {
            const result = await generateEmailDraft(item.touchNumber, item.company, contact, item.company.recommended_angle, icp, null, item.company.engagement_type || 'Sprint');
            newDrafts[item.key] = { type: 'email', ...result, contact };
          }
          setEmailDrafts({ ...newDrafts });
        } catch (e) {
          newDrafts[item.key] = { error: e.message };
          setEmailDrafts({ ...newDrafts });
        }
        await new Promise(r => setTimeout(r, 500));
      }
    } finally {
      setGeneratingEmails(false);
      // Update saved plan with email drafts
      if (report) {
        await savePlanToHistory(weekKey, buildSnapshot(report.briefing, newDrafts));
      }
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

  return (
    <>
      <div className="page-header">
        <div className="page-header-left">
          <h2>📋 Weekly Report</h2>
          <p>{weekLabel} · {totalActions} action{totalActions !== 1 ? 's' : ''} due</p>
        </div>
        <div className="page-header-actions">
          {report && (
            <button className="btn btn-secondary" onClick={generateAllEmails} disabled={generatingEmails}>
              {generatingEmails ? <><span className="spinner" /> Drafting Emails…</> : '✉️ Draft All Emails'}
            </button>
          )}
          <button className="btn btn-primary" onClick={generate} disabled={generating}>
            {generating ? <><span className="spinner" /> Generating…</> : '🚀 Generate This Week\'s Plan'}
          </button>
        </div>
      </div>

      <div className="page-body">
        {error && <div className="alert alert-error">⚠️ {error}</div>}

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
              <p style={{ fontSize: 13, lineHeight: 1.7, whiteSpace: 'pre-wrap' }}>{report.briefing}</p>
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
            <h3 style={{ fontSize: 15, fontWeight: 800, marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ background: 'var(--accent)', color: '#fff', borderRadius: '50%', width: 22, height: 22, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 800 }}>1</span>
              New Outreach — Touch 1 Initial Emails
            </h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {newOutreach.map(({ entry, company }) => {
                const contact = (company.contacts || [])[0];
                const key = `${entry.id}-1`;
                const draft = emailDrafts[key];
                return (
                  <OutreachCard
                    key={entry.id}
                    company={company}
                    contact={contact}
                    touchNumber={1}
                    draft={draft}
                    expanded={expandedEmail === key}
                    onExpand={() => setExpandedEmail(expandedEmail === key ? null : key)}
                    onCopy={() => copyDraft(key)}
                  />
                );
              })}
            </div>
          </div>
        )}

        {/* Follow-Ups Section */}
        {followupsDue.length > 0 && (
          <div style={{ marginBottom: 24 }}>
            <h3 style={{ fontSize: 15, fontWeight: 800, marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ background: 'var(--amber)', color: '#fff', borderRadius: '50%', width: 22, height: 22, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 800 }}>↩</span>
              Follow-Ups Due
            </h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {followupsDue.map(({ entry, company, touchNumber, daysSince: days }) => {
                const contact = (company.contacts || [])[0];
                const key = `${entry.id}-${touchNumber}`;
                const draft = emailDrafts[key];
                return (
                  <OutreachCard
                    key={`${entry.id}-${touchNumber}`}
                    company={company}
                    contact={contact}
                    touchNumber={touchNumber}
                    daysSince={days}
                    draft={draft}
                    expanded={expandedEmail === key}
                    onExpand={() => setExpandedEmail(expandedEmail === key ? null : key)}
                    onCopy={() => copyDraft(key)}
                  />
                );
              })}
            </div>
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
                const isOpen = !!expandedHistory[plan._key];
                const allItems = [...(plan.newOutreach || []), ...(plan.followupsDue || [])];
                const emailCount = Object.keys(plan.emailDrafts || {}).filter(k => !plan.emailDrafts[k].error).length;

                return (
                  <div key={plan._key} style={{ border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden', background: 'var(--surface)' }}>

                    {/* Plan header — click to expand */}
                    <div
                      onClick={() => setExpandedHistory(prev => ({ ...prev, [plan._key]: !prev[plan._key] }))}
                      style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 18px', cursor: 'pointer', userSelect: 'none' }}
                    >
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontWeight: 700, fontSize: 14 }}>{plan.weekLabel}</div>
                        <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
                          {allItems.length} outreach action{allItems.length !== 1 ? 's' : ''}
                          {emailCount > 0 && ` · ${emailCount} email draft${emailCount !== 1 ? 's' : ''} saved`}
                          {plan._savedAt && <span style={{ color: 'var(--text-faint)' }}> · Saved {fmtShort(plan._savedAt)}</span>}
                        </div>
                      </div>
                      <span style={{ fontSize: 13, color: 'var(--text-faint)' }}>{isOpen ? '▲' : '▼'}</span>
                    </div>

                    {isOpen && (
                      <div style={{ borderTop: '1px solid var(--border-light)' }}>

                        {/* Briefing */}
                        {plan.briefing && (
                          <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border-light)', background: 'var(--bg)' }}>
                            <div style={{ fontSize: 11, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '.05em', color: 'var(--text-faint)', marginBottom: 8 }}>AI Briefing</div>
                            <p style={{ fontSize: 13, lineHeight: 1.7, whiteSpace: 'pre-wrap', color: 'var(--text)', margin: 0 }}>{plan.briefing}</p>
                          </div>
                        )}

                        {/* Outreach items */}
                        {allItems.length > 0 && (
                          <div style={{ padding: '14px 20px' }}>
                            <div style={{ fontSize: 11, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '.05em', color: 'var(--text-faint)', marginBottom: 10 }}>Outreach</div>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                              {allItems.map(item => {
                                const emailKey = `${plan._key}__${item.key}`;
                                const draft = (plan.emailDrafts || {})[item.key];
                                const isEmailOpen = !!expandedHistoryEmail[emailKey];

                                return (
                                  <div key={item.key} style={{ border: '1px solid var(--border-light)', borderRadius: 8, overflow: 'hidden', background: 'var(--surface)' }}>
                                    <div
                                      style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', cursor: draft && !draft.error ? 'pointer' : 'default' }}
                                      onClick={() => draft && !draft.error && setExpandedHistoryEmail(prev => ({ ...prev, [emailKey]: !prev[emailKey] }))}
                                    >
                                      <span style={{
                                        background: item.touchNumber === 1 ? 'var(--accent)' : 'var(--amber)',
                                        color: '#fff', borderRadius: 4, padding: '2px 7px',
                                        fontSize: 10, fontWeight: 700, fontFamily: 'monospace', flexShrink: 0,
                                      }}>
                                        {TOUCH_LABELS[item.touchNumber]}
                                      </span>
                                      <span style={{ fontWeight: 700, fontSize: 13 }}>{item.companyName}</span>
                                      {item.contactName && (
                                        <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>→ {item.contactName}{item.contactTitle ? `, ${item.contactTitle}` : ''}</span>
                                      )}
                                      <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
                                        {draft && !draft.error ? (
                                          <>
                                            <button
                                              className="btn btn-ghost btn-xs"
                                              onClick={e => { e.stopPropagation(); copyDraft(item.key, plan.emailDrafts); }}
                                            >📋 Copy</button>
                                            <span style={{ fontSize: 11, color: 'var(--text-faint)' }}>{isEmailOpen ? '▲' : '▼'}</span>
                                          </>
                                        ) : (
                                          <span style={{ fontSize: 11, color: 'var(--text-faint)' }}>No draft saved</span>
                                        )}
                                      </div>
                                    </div>

                                    {isEmailOpen && draft && !draft.error && (
                                      <div style={{ padding: '12px 16px', borderTop: '1px solid var(--border-light)', background: 'var(--bg)' }}>
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

const TOUCH_LABELS = {
  1: 'T1 · Initial Email',
  2: 'T2 · Follow-Up Email',
  3: 'T3 · LinkedIn',
  4: 'T4 · Goodwill',
  5: 'T5 · Close the Loop',
};

function OutreachCard({ company, contact, touchNumber, daysSince, draft, expanded, onExpand, onCopy }) {
  const [copiedLocal, setCopiedLocal] = useState(false);
  const doCopy = async () => {
    await onCopy();
    setCopiedLocal(true);
    setTimeout(() => setCopiedLocal(false), 2000);
  };

  return (
    <div className="card">
      <div className="card-header" style={{ cursor: draft ? 'pointer' : 'default' }} onClick={() => draft && onExpand()}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flex: 1 }}>
          <span style={{ background: touchNumber === 1 ? 'var(--accent)' : 'var(--amber)', color: '#fff', borderRadius: 4, padding: '2px 8px', fontSize: 11, fontWeight: 700, fontFamily: 'monospace' }}>
            {TOUCH_LABELS[touchNumber]}
          </span>
          <span style={{ fontWeight: 700 }}>{company.name}</span>
          {contact && <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>→ {contact.name}{contact.title ? `, ${contact.title}` : ''}</span>}
          {daysSince !== undefined && (
            <span style={{ fontSize: 11, color: 'var(--red)', fontWeight: 600 }}>{daysSince}d overdue</span>
          )}
        </div>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          {draft && !draft.error && (
            <button className="btn btn-ghost btn-xs" onClick={e => { e.stopPropagation(); doCopy(); }}>
              {copiedLocal ? '✅ Copied' : '📋 Copy'}
            </button>
          )}
          {draft?.error && <span style={{ fontSize: 11, color: 'var(--red)' }}>⚠️ Error</span>}
          {!draft && <span style={{ fontSize: 11, color: 'var(--text-faint)' }}>Click "Draft All Emails" to generate</span>}
        </div>
      </div>

      {expanded && draft && !draft.error && (
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
    </div>
  );
}
