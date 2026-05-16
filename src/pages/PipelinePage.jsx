import { useState, useEffect, useCallback, Fragment } from 'react';
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

function nextTouchDue(entryTouches) {
  const sent = entryTouches.filter(t => t.status === 'sent');
  const lastSent = sent.sort((a, b) => new Date(b.sent_date) - new Date(a.sent_date))[0];
  if (!lastSent) return 'Due now';
  const days = daysSince(lastSent.sent_date);
  if (days >= 7) return `Due (${days}d ago)`;
  return `In ${7 - days}d`;
}

export default function PipelinePage({ icp = {} }) {
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
    const primMap = {};
    (ents || []).forEach(e => { primMap[e.id] = e.primary_contact_index || 0; });
    setPrimaryContacts(primMap);
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
    load();
  }, [load]);

  const handleTouchRightClick = useCallback((e, touch) => {
    if (!touch?.id) return;
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY, touch });
  }, []);

  const undoTouchSent = async () => {
    if (!contextMenu?.touch?.id) return;
    await supabase.from('touches').update({ status: 'ready', sent_date: null, updated_at: new Date().toISOString() }).eq('id', contextMenu.touch.id);
    setContextMenu(null);
    load();
  };

  const deleteTouchRecord = async () => {
    if (!contextMenu?.touch?.id) return;
    await supabase.from('touches').delete().eq('id', contextMenu.touch.id);
    setContextMenu(null);
    load();
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
                    <th style={{ width: 28 }}></th>
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
                      <tr>
                        <td style={{ verticalAlign: 'top', paddingTop: 14 }}>
                          <button
                            onClick={() => setExpandedRows(r => ({ ...r, [entry.id]: !r[entry.id] }))}
                            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: 12, padding: 0, lineHeight: 1 }}
                            title={isExpanded ? 'Collapse' : 'Expand'}
                          >
                            {isExpanded ? '▾' : '▸'}
                          </button>
                        </td>
                        <td>
                          <div>
                            <div style={{ fontWeight: 700, fontSize: 13 }}>{company.name || '—'}</div>
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
                        <td>
                          <span style={{ fontSize: 12, color: isDue ? 'var(--red)' : 'var(--text-muted)', fontWeight: isDue ? 700 : 400 }}>
                            {entry.status !== 'active' ? '—' : due}
                          </span>
                        </td>
                        <td>
                          <div style={{ display: 'flex', gap: 4 }}>
                            <button className="btn btn-secondary btn-xs" onClick={() => setResponseModal({ entry, company })}>Log Reply</button>
                            <button className="btn btn-ghost btn-xs" onClick={() => setNotesEntry(entry)}>Notes</button>
                          </div>
                        </td>
                      </tr>
                      {isExpanded && (
                        <tr key={`${entry.id}-expanded`} style={{ background: 'var(--surface)' }}>
                          <td />
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
      setAnalysis(result);
    } catch (e) {
      alert('Error analyzing response: ' + e.message);
    } finally {
      setAnalyzing(false);
    }
  };

  const save = async () => {
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
