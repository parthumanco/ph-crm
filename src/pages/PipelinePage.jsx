import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import EmailDraftModal from '../components/EmailDraftModal';

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

function nextTouchDue(entry, touches) {
  const sent = touches.filter(t => t.pipeline_entry_id === entry.id && t.status === 'sent');
  const lastSent = sent.sort((a, b) => new Date(b.sent_date) - new Date(a.sent_date))[0];
  if (!lastSent) return 'Due now';
  const days = daysSince(lastSent.sent_date);
  if (days >= 7) return `Due (${days}d ago)`;
  return `In ${7 - days}d`;
}

export default function PipelinePage() {
  const [entries, setEntries]     = useState([]);
  const [companies, setCompanies] = useState({});
  const [touches, setTouches]     = useState([]);
  const [loading, setLoading]     = useState(true);
  const [filter, setFilter]       = useState('all');
  const [search, setSearch]       = useState('');
  const [selected, setSelected]   = useState(null);
  const [draftModal, setDraftModal] = useState(null);
  const [responseModal, setResponseModal] = useState(null);
  const [notesEntry, setNotesEntry] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    const [{ data: ents }, { data: comps }, { data: tchs }] = await Promise.all([
      supabase.from('pipeline_entries').select('*').order('created_at', { ascending: false }),
      supabase.from('companies').select('*'),
      supabase.from('touches').select('*'),
    ]);
    setEntries(ents || []);
    const compMap = {};
    (comps || []).forEach(c => { compMap[c.id] = c; });
    setCompanies(compMap);
    setTouches(tchs || []);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const updateStatus = useCallback(async (entryId, status) => {
    await supabase.from('pipeline_entries').update({ status, updated_at: new Date().toISOString() }).eq('id', entryId);
    setEntries(es => es.map(e => e.id === entryId ? { ...e, status } : e));
  }, []);

  const markTouchSent = useCallback(async (touch) => {
    const today = new Date().toISOString().slice(0, 10);
    if (touch.id) {
      await supabase.from('touches').update({ status: 'sent', sent_date: today, updated_at: new Date().toISOString() }).eq('id', touch.id);
    } else {
      await supabase.from('touches').insert({ ...touch, status: 'sent', sent_date: today });
    }
    // advance pipeline touch counter
    const entry = entries.find(e => e.id === touch.pipeline_entry_id);
    if (entry && touch.touch_number >= entry.current_touch) {
      const newTouch = Math.min(touch.touch_number + 1, 5);
      await supabase.from('pipeline_entries').update({ current_touch: newTouch, updated_at: new Date().toISOString() }).eq('id', entry.id);
    }
    load();
  }, [entries, load]);

  const filtered = entries
    .filter(e => filter === 'all' || e.status === filter)
    .filter(e => {
      if (!search) return true;
      const c = companies[e.company_id];
      return c?.name?.toLowerCase().includes(search.toLowerCase());
    });

  // Stats
  const active     = entries.filter(e => e.status === 'active').length;
  const responded  = entries.filter(e => e.status === 'responded').length;
  const dueTouches = entries.filter(e => {
    if (e.status !== 'active') return false;
    const sent = touches.filter(t => t.pipeline_entry_id === e.id && t.status === 'sent');
    if (!sent.length && e.current_touch === 0) return true;
    const last = sent.sort((a, b) => new Date(b.sent_date) - new Date(a.sent_date))[0];
    return last ? daysSince(last.sent_date) >= 7 : true;
  }).length;

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
          {['all','active','responded','paused','won','lost'].map(f => (
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
                    <th>Touches</th>
                    <th>Status</th>
                    <th>Next Touch</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map(entry => {
                    const company = companies[entry.company_id] || {};
                    const entryTouches = touches.filter(t => t.pipeline_entry_id === entry.id);
                    const touchMap = {};
                    entryTouches.forEach(t => { touchMap[t.touch_number] = t; });
                    const nextTouchNum = entry.current_touch < 5 ? (entry.current_touch || 0) + 1 : null;
                    const nextExistingTouch = nextTouchNum ? touchMap[nextTouchNum] : null;
                    const primary = (company.contacts || [])[0];
                    const due = nextTouchDue(entry, touches);
                    const isDue = due.includes('Due');

                    return (
                      <tr key={entry.id}>
                        <td>
                          <div>
                            <div style={{ fontWeight: 700, fontSize: 13 }}>{company.name || '—'}</div>
                            {company.website && (
                              <a href={company.website} target="_blank" rel="noreferrer" style={{ fontSize: 11, color: 'var(--text-faint)' }}>
                                {company.website.replace(/https?:\/\//, '')}
                              </a>
                            )}
                            {primary && <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>{primary.name}{primary.title ? ` · ${primary.title}` : ''}</div>}
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
                              const t = touchMap[n];
                              const cls = !t ? '' : t.status === 'sent' ? 'sent' : t.status === 'responded' ? 'responded' : t.status === 'skipped' ? 'skipped' : t.status === 'ready' ? 'ready' : n === nextTouchNum ? 'ready' : '';
                              return <div key={n} className={`touch-pill${cls ? ' ' + cls : ''}`} title={`${TOUCH_LABELS[n]?.label}${t?.status === 'ready' ? ' · Draft saved' : ''}`}>{n}</div>;
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
                        <td>
                          <span style={{ fontSize: 12, color: isDue ? 'var(--red)' : 'var(--text-muted)', fontWeight: isDue ? 700 : 400 }}>
                            {entry.status !== 'active' ? '—' : nextTouchNum ? due : 'Complete ✓'}
                          </span>
                        </td>
                        <td>
                          <div style={{ display: 'flex', gap: 4 }}>
                            {nextTouchNum && entry.status === 'active' && (
                              <button
                                className={`btn btn-xs ${nextExistingTouch?.status === 'ready' ? 'btn-secondary' : 'btn-primary'}`}
                                onClick={() => setDraftModal({ entry, company, touchNumber: nextTouchNum, touchType: TOUCH_LABELS[nextTouchNum]?.type || 'email', contacts: company.contacts || [], existingTouch: nextExistingTouch || null })}
                              >
                                {nextExistingTouch?.status === 'ready' ? '✏️ Edit T' + nextTouchNum : 'Draft T' + nextTouchNum}
                              </button>
                            )}
                            <button
                              className="btn btn-secondary btn-xs"
                              onClick={() => setResponseModal({ entry, company })}
                            >
                              Log Reply
                            </button>
                            <button
                              className="btn btn-ghost btn-xs"
                              onClick={() => setNotesEntry(entry)}
                            >
                              Notes
                            </button>
                          </div>
                        </td>
                      </tr>
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
          onMarkSent={(touch) => { markTouchSent(touch); setDraftModal(null); }}
        />
      )}

      {responseModal && (
        <ResponseModal
          {...responseModal}
          onClose={() => setResponseModal(null)}
          onSave={() => { load(); setResponseModal(null); }}
        />
      )}

      {notesEntry && (
        <NotesModal
          entry={notesEntry}
          company={companies[notesEntry.company_id] || {}}
          onClose={() => setNotesEntry(null)}
          onSave={() => { load(); setNotesEntry(null); }}
        />
      )}
    </>
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
      const result = await analyzeResponse(company, primary, entry.current_touch, responseText);
      setAnalysis(result);
    } catch (e) {
      alert('Error analyzing response: ' + e.message);
    } finally {
      setAnalyzing(false);
    }
  };

  const save = async () => {
    const sentTouches = entry.current_touch > 0 ? entry.current_touch : 1;
    await supabase.from('touches').update({
      status: 'responded',
      response_text: responseText,
      ai_next_step: analysis?.nextStep || '',
      updated_at: new Date().toISOString(),
    }).eq('pipeline_entry_id', entry.id).eq('touch_number', sentTouches).eq('status', 'sent');
    await supabase.from('pipeline_entries').update({ status: 'responded', updated_at: new Date().toISOString() }).eq('id', entry.id);
    onSave();
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
  const save = async () => {
    await supabase.from('pipeline_entries').update({ notes, updated_at: new Date().toISOString() }).eq('id', entry.id);
    onSave();
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
          <button className="btn btn-primary" onClick={save}>Save Notes</button>
        </div>
      </div>
    </div>
  );
}
