import { useState, useEffect, useCallback, Fragment } from 'react';
import { supabase } from '../lib/supabase';
import EmailDraftModal from '../components/EmailDraftModal';
import { ENGAGEMENT_META, ENGAGEMENT_OPTIONS, generateQuickNextStep } from '../lib/anthropic';
import { upsertDeal, addActivity, addTask } from '../lib/deals';

const STATUS_LABELS = {
  active:    { label: 'Active',     cls: 'badge-blue'  },
  responded: { label: 'Responded',  cls: 'badge-green' },
  paused:    { label: 'Paused',     cls: 'badge-gray'  },
  won:       { label: 'Won',        cls: 'badge-green' },
  lost:      { label: 'Lost',       cls: 'badge-red'   },
};

const TOUCH_LABELS = {
  1: { label: 'T1 · Email',     type: 'email'    },
  2: { label: 'T2 · Follow-Up', type: 'email'    },
  3: { label: 'T3 · LinkedIn',  type: 'linkedin' },
  4: { label: 'T4 · Goodwill',  type: 'email'    },
  5: { label: 'T5 · Close',     type: 'email'    },
};

function daysSince(dateStr) {
  if (!dateStr) return null;
  return Math.floor((Date.now() - new Date(dateStr).getTime()) / 86400000);
}

function nextTouchDue(entryTouches) {
  const sent = entryTouches.filter(t => t.status === 'sent');
  const lastSent = sent.sort((a, b) => new Date(b.sent_date) - new Date(a.sent_date))[0];
  if (!lastSent) return 'Due now';
  const days = daysSince(lastSent.sent_date);
  if (days >= 7) return `Due (${days}d ago)`;
  return `In ${7 - days}d`;
}

// Precomputed bill rain positions (outside component to stay stable)
const RAIN_BILLS = [
  { left:'4%',  delay:'0.00s', dur:'1.55s' }, { left:'11%', delay:'0.18s', dur:'1.90s' },
  { left:'18%', delay:'0.45s', dur:'1.40s' }, { left:'25%', delay:'0.08s', dur:'2.00s' },
  { left:'32%', delay:'0.35s', dur:'1.70s' }, { left:'39%', delay:'0.22s', dur:'1.50s' },
  { left:'46%', delay:'0.60s', dur:'1.80s' }, { left:'53%', delay:'0.05s', dur:'1.30s' },
  { left:'60%', delay:'0.50s', dur:'2.10s' }, { left:'67%', delay:'0.15s', dur:'1.65s' },
  { left:'74%', delay:'0.40s', dur:'1.45s' }, { left:'81%', delay:'0.28s', dur:'1.85s' },
  { left:'88%', delay:'0.55s', dur:'1.60s' }, { left:'95%', delay:'0.10s', dur:'1.95s' },
  { left:'8%',  delay:'1.00s', dur:'1.55s' }, { left:'21%', delay:'0.90s', dur:'1.80s' },
  { left:'35%', delay:'1.10s', dur:'1.50s' }, { left:'49%', delay:'0.80s', dur:'1.70s' },
  { left:'63%', delay:'1.20s', dur:'1.60s' }, { left:'77%', delay:'0.95s', dur:'2.00s' },
  { left:'91%', delay:'0.85s', dur:'1.40s' }, { left:'15%', delay:'1.30s', dur:'1.75s' },
];

export default function PipelinePage({ icp = {}, refreshKey = 0, onNavigate }) {
  const [entries, setEntries]     = useState([]);
  const [companies, setCompanies] = useState({});
  const [touches, setTouches]     = useState([]);
  const [loading, setLoading]     = useState(true);
  const [filter, setFilter]       = useState('all');
  const [search, setSearch]       = useState('');
  const [expandedRows, setExpandedRows] = useState({});
  const [primaryContacts, setPrimaryContacts] = useState({});
  const [draftModal, setDraftModal] = useState(null);
  const [responseModal, setResponseModal] = useState(null);
  const [notesEntry, setNotesEntry] = useState(null);
  const [contextMenu, setContextMenu] = useState(null);
  const [creatingDeal, setCreatingDeal] = useState({});
  const [rainAnim, setRainAnim]         = useState(null); // null | { company, phase:'grip'|'rain' }

  const load = useCallback(async () => {
    setLoading(true);
    try {
      // Load entries and touches first
      const [{ data: ents, error: e1 }, { data: tchs, error: e2 }] = await Promise.all([
        supabase.from('pipeline_entries').select('*').neq('status', 'won').order('created_at', { ascending: false }),
        supabase.from('touches').select('*'),
      ]);
      if (e1 || e2) console.error('Pipeline load error:', e1 || e2);
      // Fetch only the specific companies referenced by pipeline entries
      const companyIds = (ents || []).map(e => e.company_id).filter(Boolean);
      const { data: comps, error: e3 } = companyIds.length
        ? await supabase.from('companies').select('*').in('id', companyIds)
        : { data: [] };
      if (e3) console.error('Pipeline companies load error:', e3);
      setEntries(ents || []);
      const compMap = {};
      (comps || []).forEach(c => { compMap[c.id] = c; });
      setCompanies(compMap);
      setTouches(tchs || []);
      const primMap = {};
      (ents || []).forEach(e => { primMap[e.id] = e.primary_contact_index || 0; });
      setPrimaryContacts(primMap);
    } catch (e) {
      console.error('Pipeline load error:', e);
    } finally {
      setLoading(false);
    }
  }, [refreshKey]);

  useEffect(() => { load(); }, [load]);

  const updateStatus = useCallback(async (entryId, status) => {
    await supabase.from('pipeline_entries').update({ status, updated_at: new Date().toISOString() }).eq('id', entryId);
    setEntries(es => es.map(e => e.id === entryId ? { ...e, status } : e));
    if (status !== 'active') {
      const entry   = entries.find(e => e.id === entryId);
      const company = entry ? companies[entry.company_id] : null;
      if (entry && company) handleCreateDeal(entry, company);
    }
  }, [entries, companies]);

  const updateEngagement = useCallback(async (companyId, engType) => {
    setCompanies(prev => ({ ...prev, [companyId]: { ...prev[companyId], engagement_type: engType } }));
    await supabase.from('companies').update({ engagement_type: engType }).eq('id', companyId);
  }, []);

  const markTouchSent = useCallback(async (touch) => {
    const today = new Date().toISOString().slice(0, 10);
    try {
      if (touch.id) {
        await supabase.from('touches').update({ status: 'sent', sent_date: today, updated_at: new Date().toISOString() }).eq('id', touch.id);
      } else {
        await supabase.from('touches').insert({ ...touch, status: 'sent', sent_date: today });
      }
      // Update current_touch on the pipeline entry so WeeklyReport can compute nextTouch correctly
      if (touch.pipeline_entry_id && touch.touch_number) {
        await supabase.from('pipeline_entries').update({
          current_touch: touch.touch_number,
          updated_at: new Date().toISOString(),
        }).eq('id', touch.pipeline_entry_id).lt('current_touch', touch.touch_number);
      }
      load();
    } catch (e) {
      console.error('markTouchSent error:', e);
      alert('Error marking touch as sent: ' + e.message);
    }
  }, [load]);

  const handleTouchRightClick = useCallback((e, touch) => {
    if (!touch?.id) return;
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY, touch });
  }, []);

  const undoTouchSent = async () => {
    if (!contextMenu?.touch?.id) return;
    try {
      const { error } = await supabase.from('touches').update({ status: 'ready', sent_date: null, updated_at: new Date().toISOString() }).eq('id', contextMenu.touch.id);
      if (error) throw new Error(error.message);
      setContextMenu(null);
      load();
    } catch (e) {
      alert('Error undoing sent: ' + e.message);
    }
  };

  const deleteTouchRecord = async () => {
    if (!contextMenu?.touch?.id) return;
    try {
      const { error } = await supabase.from('touches').delete().eq('id', contextMenu.touch.id);
      if (error) throw new Error(error.message);
      setContextMenu(null);
      load();
    } catch (e) {
      alert('Error deleting touch: ' + e.message);
    }
  };

  const filtered = entries
    .filter(e => filter === 'all' || e.status === filter)
    .filter(e => {
      if (!search) return true;
      const c = companies[e.company_id];
      return c?.name?.toLowerCase().includes(search.toLowerCase());
    });

  // Stats
  const active    = entries.filter(e => e.status === 'active').length;
  const responded = entries.filter(e => e.status === 'responded').length;
  const dueTouches = entries.filter(e => {
    if (e.status !== 'active') return false;
    const sent = touches.filter(t => t.pipeline_entry_id === e.id && t.status === 'sent');
    if (!sent.length) return true;
    const last = sent.sort((a, b) => new Date(b.sent_date) - new Date(a.sent_date))[0];
    return last ? daysSince(last.sent_date) >= 7 : true;
  }).length;

  const handleCreateDeal = async (entry, company, freshNotes = null) => {
    const key = entry.id;
    if (creatingDeal[key]) return;
    // Guard: company must be resolved — look it up from state if not passed correctly
    const resolvedCompany = (company?.id ? company : companies[entry.company_id]) || company || {};
    if (!resolvedCompany.name) { alert('Could not resolve company — please try again.'); return; }
    setCreatingDeal(p => ({ ...p, [key]: true }));
    try {
      const primaryContact = (resolvedCompany.contacts || [])[0] || {};
      // Build deal notes — freshNotes takes priority over stale entry.notes
      const noteParts = [];
      const noteText = freshNotes ?? entry.notes;
      if (noteText?.trim())           noteParts.push(`Outreach notes:\n${noteText.trim()}`);
      if (entry.last_reply?.trim())   noteParts.push(`Prospect reply:\n${entry.last_reply.trim()}`);

      const deal = await upsertDeal({
        company_id:    resolvedCompany.id,
        company_name:  resolvedCompany.name,
        contact_name:  primaryContact.name  || '',
        contact_email: primaryContact.email || '',
        stage:         'outreach',
        notes:         noteParts.length ? noteParts.join('\n\n') : null,
      });

      // Log note as activity so it appears in the deal's activity log
      if (noteText?.trim() && deal?.id) {
        await addActivity({
          deal_id:       deal.id,
          company_id:    resolvedCompany.id,
          type:          'note',
          summary:       noteText.trim(),
          activity_date: new Date().toISOString().slice(0, 10),
          assigned_to:   'Mike',
        });
      }
      // Kick off AI next step early (concurrent with animation) so it lands before the card opens
      const nextStepPromise = (resolvedCompany.id && noteText?.trim())
        ? generateQuickNextStep(resolvedCompany.name, noteText, deal.notes)
            .then(async nextStep => {
              if (!nextStep) return;
              console.log('[nextStep] generated:', nextStep);
              // Save to company record so AI RECOMMENDED box shows it
              await supabase.from('companies')
                .update({ thesis_next_step: nextStep, updated_at: new Date().toISOString() })
                .eq('id', resolvedCompany.id);
              // Also create a real task in MY NEXT STEPS on the deal card
              if (deal?.id) {
                await addTask({
                  deal_id:       deal.id,
                  company_id:    resolvedCompany.id,
                  title:         nextStep,
                  due_date:      null,
                  assigned_to:   'Mike',
                });
              }
            })
            .catch(e => console.error('generateQuickNextStep failed:', e.message))
        : Promise.resolve();

      // Mark entry as won in DB and remove from list immediately
      await supabase.from('pipeline_entries').update({ status: 'won', updated_at: new Date().toISOString() }).eq('id', entry.id);
      setEntries(es => es.filter(e => e.id !== entry.id));
      // Phase 1: character grabs bills
      setRainAnim({ company: resolvedCompany.name, phase: 'grip' });
      // Phase 2: throw + rain
      setTimeout(() => setRainAnim(r => r ? { ...r, phase: 'rain' } : r), 700);
      // Wait for AI next step to land (or 3s max) before navigating so card sees it on load
      Promise.race([nextStepPromise, new Promise(r => setTimeout(r, 3000))])
        .finally(() => {
          setTimeout(() => { setRainAnim(null); onNavigate?.('deals'); }, 100);
        });
    } catch (e) {
      alert('Error creating deal: ' + e.message);
    } finally {
      setCreatingDeal(p => ({ ...p, [key]: false }));
    }
  };

  return (
    <>
      <div className="page-header">
        <div className="page-header-left">
          <h2>🎯 Pipeline</h2>
          <p>Track all active prospects and their touch status</p>
        </div>
      </div>

      <div className="page-body">
        <div className="stats-row cols-3" style={{ marginBottom: 16 }}>
          <div className="stat-card">
            <div className="stat-val">{active}</div>
            <div className="stat-label">Active Prospects</div>
          </div>
          <div className="stat-card">
            <div className="stat-val" style={{ color: dueTouches > 0 ? 'var(--amber)' : 'var(--green)' }}>{dueTouches}</div>
            <div className="stat-label">Touches Due</div>
          </div>
          <div className="stat-card">
            <div className="stat-val" style={{ color: 'var(--green)' }}>{responded}</div>
            <div className="stat-label">Responded</div>
          </div>
        </div>

        <div className="filter-bar">
          {['all','active','responded','paused','lost'].map(f => (
            <button key={f} className={`filter-btn${filter === f ? ' active' : ''}`} onClick={() => setFilter(f)}>
              {f === 'all' ? 'All' : STATUS_LABELS[f]?.label || f}
              {f === 'all' && ` (${entries.length})`}
              {f !== 'all' && ` (${entries.filter(e => e.status === f).length})`}
            </button>
          ))}
          <input
            className="filter-search"
            placeholder="Search companies…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>

        {loading ? (
          <div className="empty-state"><div className="spinner" /><p style={{ marginTop: 12 }}>Loading pipeline…</p></div>
        ) : filtered.length === 0 ? (
          <div className="empty-state">
            <div className="empty-icon">🎯</div>
            <h3>No prospects yet</h3>
            <p>Use Signal Watch to scan companies, then click "Add to Pipeline" on any high-scoring result.</p>
          </div>
        ) : (
          <div className="card">
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Company</th>
                    <th>ICP</th>
                    <th>Touches (primary contact)</th>
                    <th>Status</th>
                    <th>Next Due</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map(entry => {
                    const company = companies[entry.company_id] || {};
                    const contacts = company.contacts || [];
                    const primaryIdx = primaryContacts[entry.id] || 0;
                    const primaryContact = contacts[primaryIdx] || contacts[0];
                    const primaryName = primaryContact?.name || '';

                    const entryTouches = touches.filter(t => t.pipeline_entry_id === entry.id);

                    // Primary contact touch map — for main row pills
                    const primaryTouchMap = {};
                    entryTouches
                      .filter(t => !contacts.length || t.contact_name === primaryName)
                      .forEach(t => { primaryTouchMap[t.touch_number] = t; });

                    // Per-contact touch maps — for expanded view
                    const touchesByContact = {};
                    entryTouches.forEach(t => {
                      const k = t.contact_name || '';
                      if (!touchesByContact[k]) touchesByContact[k] = {};
                      touchesByContact[k][t.touch_number] = t;
                    });

                    const due = nextTouchDue(entryTouches);
                    const isDue = due.includes('Due');
                    const isExpanded = !!expandedRows[entry.id];

                    return (
                      <Fragment key={entry.id}>
                      <tr
                        onClick={e => { if (e.target.tagName !== 'SELECT' && e.target.tagName !== 'BUTTON' && e.target.tagName !== 'A' && e.target.tagName !== 'INPUT') setExpandedRows(r => ({ ...r, [entry.id]: !r[entry.id] })); }}
                        style={{ cursor: 'pointer' }}
                      >
                        <td>
                          <div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                              <span style={{ fontWeight: 700, fontSize: 13 }}>{company.name || '—'}</span>
                              {(() => {
                                const et = company.engagement_type || 'Sprint';
                                const em = ENGAGEMENT_META[et] || ENGAGEMENT_META.Sprint;
                                return (
                                  <select
                                    value={et}
                                    onChange={e => updateEngagement(company.id, e.target.value)}
                                    style={{ fontSize: 10, fontWeight: 700, padding: '2px 6px', borderRadius: 10, border: `1px solid ${em.color}40`, background: em.color + '18', color: em.color, cursor: 'pointer', outline: 'none', width: 'fit-content', maxWidth: 110 }}
                                    title="Engagement type — drives email messaging"
                                  >
                                    {ENGAGEMENT_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
                                  </select>
                                );
                              })()}
                            </div>
                            {company.website && (
                              <a href={company.website} target="_blank" rel="noreferrer" style={{ fontSize: 11, color: 'var(--text-faint)' }}>
                                {company.website.replace(/https?:\/\//, '')}
                              </a>
                            )}
                            {primaryContact && (
                              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
                                {primaryContact.name}{primaryContact.title ? ` · ${primaryContact.title}` : ''}
                                {contacts.length > 1 && <span style={{ color: 'var(--text-faint)', marginLeft: 4 }}>+{contacts.length - 1} more</span>}
                              </div>
                            )}
                          </div>
                        </td>
                        <td>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                            {company.icp_score && (
                              <span style={{ fontSize: 12, fontWeight: 700, fontFamily: 'monospace', color: company.icp_score >= 7 ? 'var(--green)' : company.icp_score >= 4 ? 'var(--amber)' : 'var(--text-muted)' }}>
                                ICP {company.icp_score}/10
                              </span>
                            )}
                            {company.icp_tier && <span style={{ fontSize: 10, color: 'var(--text-faint)' }}>{company.icp_tier}</span>}
                          </div>
                        </td>
                        <td>
                          <div className="touch-pills">
                            {[1,2,3,4,5].map(n => {
                              const t = primaryTouchMap[n];
                              const cls = !t ? '' : t.status === 'sent' ? 'sent' : t.status === 'responded' ? 'responded' : t.status === 'skipped' ? 'skipped' : t.status === 'ready' ? 'ready' : '';
                              return (
                                <div
                                  key={n}
                                  className={`touch-pill${cls ? ' ' + cls : ''}`}
                                  title={`${TOUCH_LABELS[n]?.label} — ${primaryContact?.name || 'contact'}${t?.status === 'ready' ? ' · Draft saved' : ''}`}
                                  style={{ cursor: 'pointer' }}
                                  onClick={() => setDraftModal({
                                    entry, company,
                                    touchNumber: n,
                                    contacts,
                                    existingTouch: primaryTouchMap[n] || null,
                                    t1Subject: primaryTouchMap[1]?.subject_line || null,
                                    defaultContactIndex: primaryIdx,
                                    emailSignature: icp.emailSignature || '',
                                    engagementType: company.engagement_type || 'Sprint',
                                    linkedinPosts: company.linkedin_posts || [],
                                  })}
                                  onContextMenu={(e) => handleTouchRightClick(e, primaryTouchMap[n])}
                                >
                                  {n}
                                </div>
                              );
                            })}
                          </div>
                        </td>
                        <td>
                          <select
                            className="badge"
                            value={entry.status}
                            onChange={e => updateStatus(entry.id, e.target.value)}
                            style={{ border: 'none', background: 'transparent', cursor: 'pointer', fontSize: 11, fontWeight: 600, padding: '2px 4px' }}
                          >
                            {Object.entries(STATUS_LABELS).map(([v, { label }]) => (
                              <option key={v} value={v}>{label}</option>
                            ))}
                          </select>
                        </td>
                        <td style={{ whiteSpace: 'nowrap' }}>
                          <span style={{ fontSize: 12, color: isDue ? 'var(--red)' : 'var(--text-muted)', fontWeight: isDue ? 700 : 400 }}>
                            {entry.status !== 'active' ? '—' : due}
                          </span>
                        </td>
                        <td style={{ whiteSpace: 'nowrap' }}>
                          <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'nowrap' }}>
                            <button className="btn btn-secondary btn-xs" style={{ borderRadius: 20, whiteSpace: 'nowrap', padding: '4px 12px' }} onClick={() => setResponseModal({ entry, company })}>+ Reply</button>
                            <button className="btn btn-secondary btn-xs" style={{ borderRadius: 20, whiteSpace: 'nowrap', padding: '4px 12px' }} onClick={() => setNotesEntry(entry)}>+ Note</button>
                            <button
                              className="btn btn-primary btn-xs"
                              style={{ borderRadius: 20, whiteSpace: 'nowrap', padding: '4px 12px' }}
                              onClick={() => handleCreateDeal(entry, company)}
                              disabled={!!creatingDeal[entry.id]}
                            >
                              {creatingDeal[entry.id] ? '…' : 'Move to Pipeline'}
                            </button>
                          </div>
                        </td>
                      </tr>
                      {isExpanded && (
                        <tr key={`${entry.id}-expanded`} style={{ background: 'var(--surface)' }}>
                          <td colSpan={6} style={{ padding: '12px 16px 16px', borderTop: '1px solid var(--border)' }}>
                            <div style={{ display: 'grid', gridTemplateColumns: '3fr 2fr', gap: 24 }}>
                              {/* Left: per-contact touch grid */}
                              <div>
                                <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 8 }}>
                                  Contacts &amp; Touches
                                </div>
                                <ContactTouchGrid
                                  entry={entry}
                                  company={company}
                                  contacts={contacts}
                                  primaryIndex={primaryContacts[entry.id] || 0}
                                  onSetPrimary={async (idx) => {
                                    await supabase.from('pipeline_entries').update({ primary_contact_index: idx }).eq('id', entry.id);
                                    setPrimaryContacts(prev => ({ ...prev, [entry.id]: idx }));
                                  }}
                                  onUpdated={(updated) => setCompanies(prev => ({ ...prev, [company.id]: { ...company, contacts: updated } }))}
                                  touchesByContact={touchesByContact}
                                  icp={icp}
                                  onOpenModal={setDraftModal}
                                  onRightClick={handleTouchRightClick}
                                />
                              </div>
                              {/* Right: scan intel */}
                              <div>
                                {company.recommended_angle && (
                                  <div style={{ marginBottom: 12 }}>
                                    <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 4 }}>Recommended Angle</div>
                                    <div style={{ fontSize: 12, color: 'var(--text)' }}>{company.recommended_angle}</div>
                                  </div>
                                )}
                                {company.summary && (
                                  <div style={{ marginBottom: 12 }}>
                                    <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 4 }}>Summary</div>
                                    <div style={{ fontSize: 12, color: 'var(--text)', lineHeight: 1.5 }}>{company.summary}</div>
                                  </div>
                                )}
                                {(company.triggers || []).length > 0 && (
                                  <div>
                                    <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 4 }}>Triggers</div>
                                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                                      {company.triggers.map((t, i) => (
                                        <span key={i} style={{ fontSize: 11, padding: '2px 8px', borderRadius: 10, background: 'var(--surface-2)', color: 'var(--text-muted)', border: '1px solid var(--border)' }}>
                                          {typeof t === 'string' ? t : t.category || t.label || JSON.stringify(t)}
                                        </span>
                                      ))}
                                    </div>
                                  </div>
                                )}
                                {entry.notes && (
                                  <div style={{ marginTop: 12 }}>
                                    <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 4 }}>Notes</div>
                                    <div style={{ fontSize: 12, color: 'var(--text)', lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>{entry.notes}</div>
                                  </div>
                                )}
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {draftModal && (
        <EmailDraftModal
          {...draftModal}
          onClose={() => setDraftModal(null)}
          onSave={() => load()}
          onMarkSent={(touch) => { markTouchSent(touch); setDraftModal(null); }}
        />
      )}

      {responseModal && (
        <ResponseModal
          {...responseModal}
          onClose={() => setResponseModal(null)}
          onSave={() => {
            load();
            const { entry, company } = responseModal;
            setResponseModal(null);
            handleCreateDeal(entry, company);
          }}
        />
      )}

      {notesEntry && (
        <NotesModal
          entry={notesEntry}
          company={companies[notesEntry.company_id] || {}}
          onClose={() => setNotesEntry(null)}
          onSave={(freshNotes) => {
            const entry   = notesEntry;
            const company = companies[notesEntry.company_id] || {};
            load();
            setNotesEntry(null);
            handleCreateDeal(entry, company, freshNotes);
          }}
        />
      )}

      {contextMenu && (
        <>
          <div style={{ position: 'fixed', inset: 0, zIndex: 9998 }} onClick={() => setContextMenu(null)} />
          <div style={{ position: 'fixed', top: contextMenu.y, left: contextMenu.x, background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 6, boxShadow: '0 4px 16px rgba(0,0,0,.15)', zIndex: 9999, minWidth: 168, overflow: 'hidden' }}>
            <div style={{ padding: '6px 12px', fontSize: 10, fontWeight: 700, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '.04em', borderBottom: '1px solid var(--border)' }}>
              T{contextMenu.touch.touch_number}{contextMenu.touch.contact_name ? ` — ${contextMenu.touch.contact_name.split(' ')[0]}` : ''}
            </div>
            {contextMenu.touch.status === 'sent' && (
              <button onClick={undoTouchSent} style={{ display: 'block', width: '100%', textAlign: 'left', padding: '9px 12px', background: 'none', border: 'none', cursor: 'pointer', fontSize: 13, color: 'var(--text)' }}>
                ↩ Undo Sent
              </button>
            )}
            <button onClick={deleteTouchRecord} style={{ display: 'block', width: '100%', textAlign: 'left', padding: '9px 12px', background: 'none', border: 'none', cursor: 'pointer', fontSize: 13, color: 'var(--red)' }}>
              🗑 Delete {contextMenu.touch.status === 'sent' ? 'record' : 'draft'}
            </button>
          </div>
        </>
      )}

      {/* ── Make It Rain overlay ─────────────────────────────────────────── */}
      {rainAnim && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 700,
          background: 'rgba(2, 10, 30, 0.80)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          animation: 'win-overlay-in 0.2s ease-out',
          pointerEvents: 'none',
          overflow: 'hidden',
        }}>
          {/* Raining bills — only during rain phase */}
          {rainAnim.phase === 'rain' && RAIN_BILLS.map((b, i) => (
            <div key={i} style={{
              position: 'absolute', left: b.left, top: -40,
              fontSize: 22, zIndex: 1, pointerEvents: 'none',
              animation: `bill-rain ${b.dur} ease-in ${b.delay} forwards`,
            }}>💵</div>
          ))}

          <div style={{ position: 'relative', display: 'flex', flexDirection: 'column', alignItems: 'center', zIndex: 2 }}>

            {/* Pixel-art character — both arms raised, holding bills */}
            <div className={rainAnim.phase === 'rain' ? 'char-celebrate' : 'char-grip'} style={{ position: 'relative' }}>
              <svg width="80" height="110" viewBox="0 0 80 110" style={{ imageRendering: 'pixelated', display: 'block', overflow: 'visible' }}>
                {/* Hair */}
                <rect x="16" y="4"  width="48" height="8"  rx="2" fill="#1c1917" />
                {/* Head */}
                <rect x="16" y="8"  width="48" height="32" rx="4" fill="#f5c8a0" />
                {/* Eyes */}
                <rect x="24" y="18" width="10" height="10" rx="1" fill="#fff" />
                <rect x="46" y="18" width="10" height="10" rx="1" fill="#fff" />
                <rect x="27" y="20" width="5"  height="6"  rx="1" fill="#1d4ed8" />
                <rect x="49" y="20" width="5"  height="6"  rx="1" fill="#1d4ed8" />
                <rect x="28" y="21" width="2"  height="2"  fill="#000" />
                <rect x="50" y="21" width="2"  height="2"  fill="#000" />
                {/* Smile */}
                <rect x="28" y="32" width="24" height="4" rx="2" fill="#e07060" />
                <rect x="30" y="33" width="20" height="2" rx="1" fill="#fff" />
                {/* Body — sharp suit */}
                <rect x="18" y="40" width="44" height="36" rx="2" fill="#1e3a5f" />
                <rect x="18" y="40" width="44" height="8"  rx="1" fill="#254d7f" />
                {/* Lapels */}
                <polygon points="40,42 30,56 36,56" fill="#e8d5b0" />
                <polygon points="40,42 50,56 44,56" fill="#e8d5b0" />
                {/* Tie */}
                <rect x="37" y="48" width="6" height="20" rx="1" fill="#dc2626" />
                <polygon points="37,68 43,68 40,76" fill="#b91c1c" />
                {/* Belt */}
                <rect x="18" y="72" width="44" height="7" fill="#1c1917" />
                <rect x="34" y="73" width="12" height="5" rx="1" fill="#78350f" />
                <rect x="37" y="74" width="6"  height="3" rx="0" fill="#fbbf24" />
                {/* Legs */}
                <rect x="20" y="79" width="18" height="22" rx="2" fill="#1e3a5f" />
                <rect x="42" y="79" width="18" height="22" rx="2" fill="#1e3a5f" />
                {/* Shoes */}
                <rect x="16" y="95" width="26" height="8" rx="3" fill="#0c0a09" />
                <rect x="38" y="95" width="26" height="8" rx="3" fill="#0c0a09" />
                {/* Left arm — raised high (grip phase: lower; rain phase: up) */}
                <rect x="0"  y="26" width="18" height="24" rx="4" fill="#f5c8a0" />
                <rect x="0"  y="24" width="18" height="10" rx="3" fill="#1e3a5f" />
                {/* Right arm — raised high */}
                <rect x="62" y="26" width="18" height="24" rx="4" fill="#f5c8a0" />
                <rect x="62" y="24" width="18" height="10" rx="3" fill="#1e3a5f" />
                {/* Wad of bills in left hand */}
                <rect x="-4" y="14" width="20" height="12" rx="1" fill="#059669" />
                <rect x="-2" y="12" width="20" height="12" rx="1" fill="#10b981" />
                <rect x="0"  y="10" width="20" height="12" rx="1" fill="#34d399" />
                <rect x="3"  y="13" width="5"  height="5"  rx="0" fill="#065f46" />
                <text x="5" y="19" fontFamily="monospace" fontSize="7" fontWeight="900" fill="#fff">$</text>
                {/* Wad of bills in right hand */}
                <rect x="64" y="14" width="20" height="12" rx="1" fill="#059669" />
                <rect x="62" y="12" width="20" height="12" rx="1" fill="#10b981" />
                <rect x="60" y="10" width="20" height="12" rx="1" fill="#34d399" />
                <rect x="67" y="13" width="5"  height="5"  rx="0" fill="#065f46" />
                <text x="69" y="19" fontFamily="monospace" fontSize="7" fontWeight="900" fill="#fff">$</text>
              </svg>
            </div>

            {/* Ground line */}
            <div style={{ width: 180, height: 5, marginTop: 4, background: 'linear-gradient(90deg, transparent, #10b981 20%, #fbbf24 50%, #10b981 80%, transparent)', borderRadius: 3 }} />

            {/* DEAL CREATED popup — rain phase only */}
            {rainAnim.phase === 'rain' && (
              <div className="win-popup-anim" style={{
                marginTop: 18,
                background: '#020d1f',
                border: '3px solid #fbbf24',
                borderRadius: 3,
                padding: '14px 28px 16px',
                textAlign: 'center',
                boxShadow: '4px 4px 0 #78350f, 0 0 32px rgba(251,191,36,0.5), inset 0 0 0 1px #1e3a5f',
              }}>
                <div style={{ fontFamily: '"Press Start 2P", "Courier New", monospace', fontSize: 14, color: '#fde68a', textShadow: '0 0 14px rgba(251,191,36,0.9), 2px 2px 0 #78350f', letterSpacing: '0.04em', lineHeight: 1.7 }}>
                  IT'S RAINING!
                </div>
                <div style={{ fontFamily: '"Press Start 2P", "Courier New", monospace', fontSize: 9, color: '#86efac', marginTop: 8, textShadow: '0 0 8px rgba(16,185,129,0.7)' }}>
                  {rainAnim.company}
                </div>
                <div style={{ fontFamily: '"Press Start 2P", "Courier New", monospace', fontSize: 6, color: '#4b5563', marginTop: 8, letterSpacing: '0.06em' }}>
                  DEAL CREATED → HEADING TO DEALS
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}

// ── Contact Touch Grid ────────────────────────────────────────────────────────

function ContactTouchGrid({ entry, company, contacts, primaryIndex, onSetPrimary, onUpdated, touchesByContact, icp, onOpenModal, onRightClick }) {
  const [editingIdx, setEditingIdx] = useState(null);
  const [editForm, setEditForm] = useState({});

  const saveEdit = async (idx) => {
    const updated = contacts.map((c, i) => i === idx ? { ...editForm } : c);
    const { error } = await supabase.from('companies').update({ contacts: updated }).eq('id', company.id);
    if (error) { alert('Error saving: ' + error.message); return; }
    onUpdated(updated);
    setEditingIdx(null);
  };

  return (
    <div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 10 }}>
        {contacts.map((contact, contactIdx) => {
          const contactTouches = touchesByContact[contact.name] || {};
          const isPrimary = contactIdx === primaryIndex;

          if (editingIdx === contactIdx) {
            return (
              <div key={contactIdx} style={{ padding: 10, background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 6 }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 8 }}>
                  <input type="text" placeholder="Name *" value={editForm.name || ''} onChange={e => setEditForm(f => ({ ...f, name: e.target.value }))} style={{ fontSize: 12 }} />
                  <input type="text" placeholder="Title" value={editForm.title || ''} onChange={e => setEditForm(f => ({ ...f, title: e.target.value }))} style={{ fontSize: 12 }} />
                  <input type="email" placeholder="Email" value={editForm.email || ''} onChange={e => setEditForm(f => ({ ...f, email: e.target.value }))} style={{ fontSize: 12 }} />
                  <input type="text" placeholder="LinkedIn URL" value={editForm.linkedin || ''} onChange={e => setEditForm(f => ({ ...f, linkedin: e.target.value }))} style={{ fontSize: 12 }} />
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button className="btn btn-primary btn-sm" onClick={() => saveEdit(contactIdx)}>Save</button>
                  <button className="btn btn-ghost btn-sm" onClick={() => setEditingIdx(null)}>Cancel</button>
                </div>
              </div>
            );
          }

          return (
            <div key={contactIdx} style={{ border: `1px solid ${isPrimary ? 'var(--accent)' : 'var(--border)'}`, borderRadius: 6, overflow: 'hidden' }}>
              {/* Contact info row */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 10px', background: isPrimary ? 'var(--accent)11' : 'var(--surface)', flexWrap: 'wrap' }}>
                <button
                  title={isPrimary ? 'Primary contact' : 'Set as primary'}
                  onClick={() => onSetPrimary?.(contactIdx)}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 13, padding: 0, lineHeight: 1, opacity: isPrimary ? 1 : 0.3, flexShrink: 0 }}
                >⭐</button>
                <span style={{ fontWeight: 600, fontSize: 12 }}>
                  {contact.name}
                  {contact.title && <span style={{ fontWeight: 400, color: 'var(--text-muted)' }}> · {contact.title}</span>}
                </span>
                {contact.email && (
                  <a href={`https://mail.google.com/mail/?view=cm&to=${encodeURIComponent(contact.email)}`} target="_blank" rel="noreferrer" style={{ color: 'var(--text-faint)', fontSize: 11 }}>
                    {contact.email}
                  </a>
                )}
                {contact.linkedin && (
                  <a href={contact.linkedin} target="_blank" rel="noreferrer" style={{ color: 'var(--blue)', fontSize: 11 }}>LinkedIn ↗</a>
                )}
                <button
                  className="btn btn-ghost btn-xs"
                  style={{ marginLeft: 'auto', color: 'var(--text-faint)' }}
                  onClick={() => { setEditingIdx(contactIdx); setEditForm({ ...contact }); }}
                >✏️ Edit</button>
              </div>
              {/* Per-contact touch pills */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 10px', background: 'var(--bg)', borderTop: '1px solid var(--border)' }}>
                <span style={{ fontSize: 10, color: 'var(--text-faint)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.04em', marginRight: 2, flexShrink: 0 }}>Touches:</span>
                <div className="touch-pills">
                  {[1,2,3,4,5].map(n => {
                    const t = contactTouches[n];
                    const cls = !t ? '' : t.status === 'sent' ? 'sent' : t.status === 'responded' ? 'responded' : t.status === 'skipped' ? 'skipped' : t.status === 'ready' ? 'ready' : '';
                    return (
                      <div
                        key={n}
                        className={`touch-pill${cls ? ' ' + cls : ''}`}
                        title={`${TOUCH_LABELS[n]?.label} — ${contact.name}${t?.status === 'ready' ? ' · Draft saved' : t?.status === 'sent' ? ' · Sent' : ' · Click to draft'}`}
                        style={{ cursor: 'pointer' }}
                        onClick={() => onOpenModal({
                          entry,
                          company,
                          touchNumber: n,
                          contacts,
                          existingTouch: t || null,
                          t1Subject: (contactTouches[1])?.subject_line || null,
                          defaultContactIndex: contactIdx,
                          emailSignature: icp.emailSignature || '',
                          engagementType: company.engagement_type || 'Sprint',
                          linkedinPosts: company.linkedin_posts || [],
                        })}
                        onContextMenu={(e) => onRightClick?.(e, t)}
                      >
                        {n}
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          );
        })}
      </div>
      <AddContactForm companyId={company.id} existingContacts={contacts} onSaved={onUpdated} />
    </div>
  );
}

// ── Add Contact Form ─────────────────────────────────────────────────────────

function AddContactForm({ companyId, existingContacts, onSaved }) {
  const [show, setShow] = useState(false);
  const [form, setForm] = useState({ name: '', title: '', email: '', linkedin: '' });
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (!form.name.trim()) return;
    setSaving(true);
    try {
      const updated = [...existingContacts, { name: form.name.trim(), title: form.title.trim(), email: form.email.trim(), linkedin: form.linkedin.trim() }];
      const { error } = await supabase.from('companies').update({ contacts: updated }).eq('id', companyId);
      if (error) throw error;
      onSaved(updated);
      setForm({ name: '', title: '', email: '', linkedin: '' });
      setShow(false);
    } catch (e) {
      alert('Error saving contact: ' + e.message);
    } finally {
      setSaving(false);
    }
  };

  if (!show) return (
    <button className="btn btn-ghost btn-xs" onClick={() => setShow(true)} style={{ marginTop: 4 }}>+ Add Contact</button>
  );

  return (
    <div style={{ marginTop: 8, padding: '12px', background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 6 }}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 8 }}>
        <input type="text" placeholder="Name *" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} style={{ fontSize: 12 }} />
        <input type="text" placeholder="Title" value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} style={{ fontSize: 12 }} />
        <input type="email" placeholder="Email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} style={{ fontSize: 12 }} />
        <input type="text" placeholder="LinkedIn URL" value={form.linkedin} onChange={e => setForm(f => ({ ...f, linkedin: e.target.value }))} style={{ fontSize: 12 }} />
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <button className="btn btn-primary btn-sm" onClick={save} disabled={!form.name.trim() || saving}>{saving ? 'Saving…' : 'Save Contact'}</button>
        <button className="btn btn-ghost btn-sm" onClick={() => { setShow(false); setForm({ name: '', title: '', email: '', linkedin: '' }); }}>Cancel</button>
      </div>
    </div>
  );
}

// ── Response Modal ───────────────────────────────────────────────────────────

function ResponseModal({ entry, company, onClose, onSave }) {
  const [responseText, setResponseText] = useState('');
  const [analysis, setAnalysis]         = useState(null);
  const [analyzing, setAnalyzing]       = useState(false);

  const analyze = async () => {
    if (!responseText.trim()) return;
    setAnalyzing(true);
    try {
      const { analyzeResponse } = await import('../lib/anthropic');
      const primary = (company.contacts || [])[0] || { name: 'the contact', title: '' };
      const result = await analyzeResponse(company, primary, 1, responseText);
      handleAnalysis(result);
    } catch (e) {
      alert('Error analyzing response: ' + e.message);
    } finally {
      setAnalyzing(false);
    }
  };

  const save = async () => {
    try {
      const { error } = await supabase.from('pipeline_entries').update({
        status: 'responded',
        last_reply: responseText.trim() || null,
        updated_at: new Date().toISOString(),
      }).eq('id', entry.id);
      if (error) throw new Error(error.message);
      onSave();
    } catch (e) {
      alert('Error saving response: ' + e.message);
    }
  };

  // Also handle analyzeResponse returning an error object instead of throwing
  const handleAnalysis = (result) => {
    if (result?.error) {
      alert('Could not parse AI response — please try again.');
    } else {
      setAnalysis(result);
    }
  };

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <div className="modal-header">
          <div>
            <h3>Log Response — {company.name}</h3>
            <p>Paste the prospect's reply and get AI analysis + suggested next step</p>
          </div>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">
          <div className="form-row">
            <label>Their Reply</label>
            <textarea
              rows={6}
              placeholder="Paste the email reply here…"
              value={responseText}
              onChange={e => setResponseText(e.target.value)}
            />
          </div>
          <button className="btn btn-primary" onClick={analyze} disabled={!responseText.trim() || analyzing}>
            {analyzing ? <><span className="spinner" /> Analyzing…</> : '🤖 Analyze Response'}
          </button>
          {analysis && (
            <div style={{ marginTop: 16 }}>
              <div className="alert alert-info" style={{ marginBottom: 10 }}>
                <div>
                  <strong>Sentiment:</strong> {analysis.sentiment}<br />
                  <strong>What they're saying:</strong> {analysis.interpretation}
                </div>
              </div>
              <div className="alert alert-success">
                <div>
                  <strong>Recommended next step:</strong> {analysis.nextStep}
                </div>
              </div>
              {analysis.suggestedReply && (
                <div style={{ marginTop: 12 }}>
                  <label>Suggested Reply</label>
                  <div className="email-draft">{analysis.suggestedReply}</div>
                </div>
              )}
            </div>
          )}
        </div>
        <div className="modal-footer">
          <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn btn-green" onClick={save} disabled={!responseText.trim()}>
            Save & Mark as Responded
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Notes Modal ──────────────────────────────────────────────────────────────

function NotesModal({ entry, company, onClose, onSave }) {
  const [notes, setNotes] = useState(entry.notes || '');
  const [saving, setSaving] = useState(false);
  const save = async () => {
    setSaving(true);
    try {
      const { error } = await supabase.from('pipeline_entries').update({ notes, updated_at: new Date().toISOString() }).eq('id', entry.id);
      if (error) throw new Error(error.message);
      onSave(notes);
    } catch (e) {
      alert('Error saving notes: ' + e.message);
    } finally {
      setSaving(false);
    }
  };
  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ maxWidth: 480 }}>
        <div className="modal-header">
          <div><h3>Notes — {company.name}</h3></div>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">
          <textarea rows={8} value={notes} onChange={e => setNotes(e.target.value)} placeholder="Add notes about this prospect…" />
        </div>
        <div className="modal-footer">
          <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save Notes'}</button>
        </div>
      </div>
    </div>
  );
}
