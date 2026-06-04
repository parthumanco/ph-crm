import { useState, useEffect, useRef } from 'react';
import {
  fetchClients, fetchClientDetail, fetchCompanyIntel, runClientDeepScan,
  upsertClient, addClientItem, deleteClientItem, askClientQuestion,
} from '../lib/clients';

const STATUS_COLOR = { active: '#10b981', completed: '#6366f1', paused: '#f59e0b', archived: '#9ca3af' };
const ACTIVITY_ICONS = { email: '✉️', call: '📞', meeting: '🤝', note: '📝', proposal: '📄', contract: '✍️' };

const TRIGGER_CATS = {
  leadership: { label: 'Leadership Change', color: '#f59e0b' },
  funding:    { label: 'Funding / M&A',     color: '#10b981' },
  expansion:  { label: 'Expansion',         color: '#3b82f6' },
  product:    { label: 'Product Launch',    color: '#8b5cf6' },
  pain:       { label: 'Challenge',         color: '#ef4444' },
  hiring:     { label: 'Hiring',            color: '#06b6d4' },
  social:     { label: 'Social Signal',     color: '#ec4899' },
};
const catColor = id => TRIGGER_CATS[id]?.color || '#94a3b8';
const catLabel = id => TRIGGER_CATS[id]?.label || id;
const scoreColor = s => s >= 7 ? '#10b981' : s >= 4 ? '#f59e0b' : '#ef4444';

function fmtDate(d) {
  if (!d) return '';
  return new Date(d + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export default function ClientsPage({ onNavigate, refreshKey, icp }) {
  const [clients, setClients]             = useState([]);
  const [search, setSearch]               = useState('');
  const [selected, setSelected]           = useState(null);
  const [detail, setDetail]               = useState(null);
  const [intel, setIntel]                 = useState(null);   // companies row
  const [loadingList, setLoadingList]     = useState(true);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [tab, setTab]                     = useState('overview');

  // Edit
  const [editing, setEditing]   = useState(false);
  const [editDraft, setEditDraft] = useState({});
  const [saving, setSaving]     = useState(false);

  // Research
  const [addingItem, setAddingItem] = useState(false);
  const [itemDraft, setItemDraft]   = useState({ type: 'note', title: '', url: '', body: '' });
  const [savingItem, setSavingItem] = useState(false);

  // Deep scan
  const [scanning, setScanning]   = useState(false);
  const [scanStatus, setScanStatus] = useState('');

  // AI chat
  const [aiQ, setAiQ]           = useState('');
  const [aiMessages, setAiMessages] = useState([]);
  const [aiLoading, setAiLoading]   = useState(false);
  const aiEndRef                    = useRef(null);

  // ── Load list ──────────────────────────────────────────────────────────────
  useEffect(() => {
    setLoadingList(true);
    fetchClients()
      .then(data => {
        setClients(data);
        if (data.length > 0 && !selected) setSelected(data[0].id);
      })
      .catch(console.error)
      .finally(() => setLoadingList(false));
  }, [refreshKey]);

  // ── Load detail + intel ───────────────────────────────────────────────────
  useEffect(() => {
    if (!selected) return;
    setLoadingDetail(true);
    setDetail(null);
    setIntel(null);
    setAiMessages([]);
    setTab('overview');

    fetchClientDetail(selected).then(d => {
      setDetail(d);
      setEditDraft({ name: d.client.name, website: d.client.website || '', linkedin_url: d.client.linkedin_url || '', notes: d.client.notes || '' });
      // Also fetch matching companies row for intelligence data
      fetchCompanyIntel(d.client.name).then(setIntel).catch(() => setIntel(null));
    })
    .catch(console.error)
    .finally(() => setLoadingDetail(false));
  }, [selected]);

  const filtered = clients.filter(c => c.name.toLowerCase().includes(search.toLowerCase()));

  // ── Handlers ──────────────────────────────────────────────────────────────
  const handleSaveClient = async () => {
    setSaving(true);
    try {
      const saved = await upsertClient({ ...detail.client, ...editDraft });
      setDetail(d => ({ ...d, client: saved }));
      setClients(prev => prev.map(c => c.id === saved.id ? { ...c, ...saved } : c));
      setEditing(false);
    } catch (e) { console.error(e); }
    finally { setSaving(false); }
  };

  const handleAddItem = async () => {
    if (!itemDraft.title.trim() && !itemDraft.body.trim()) return;
    setSavingItem(true);
    try {
      const item = await addClientItem({ clientId: selected, type: itemDraft.type, title: itemDraft.title || itemDraft.body.slice(0, 60), url: itemDraft.url || null, body: itemDraft.body || null });
      setDetail(d => ({ ...d, items: [item, ...d.items] }));
      setItemDraft({ type: 'note', title: '', url: '', body: '' });
      setAddingItem(false);
    } catch (e) { console.error(e); }
    finally { setSavingItem(false); }
  };

  const handleDeleteItem = async (id) => {
    await deleteClientItem(id);
    setDetail(d => ({ ...d, items: d.items.filter(i => i.id !== id) }));
  };

  const handleDeepScan = async () => {
    if (!intel?.id || scanning) return;
    setScanning(true);
    setScanStatus('Researching…');
    try {
      const updated = await runClientDeepScan(intel.id, intel, icp);
      setIntel(updated);
      setScanStatus('Done');
      setTimeout(() => setScanStatus(''), 2000);
    } catch (e) {
      setScanStatus(`Error: ${e.message}`);
      setTimeout(() => setScanStatus(''), 4000);
    } finally {
      setScanning(false);
    }
  };

  const handleAsk = async () => {
    if (!aiQ.trim() || aiLoading || !detail) return;
    const question = aiQ.trim();
    setAiQ('');
    setAiMessages(prev => [...prev, { role: 'user', text: question }]);
    setAiLoading(true);
    try {
      const contextWithIntel = { ...detail, intel };
      const answer = await askClientQuestion(contextWithIntel, question);
      setAiMessages(prev => [...prev, { role: 'ai', text: answer }]);
    } catch (e) {
      setAiMessages(prev => [...prev, { role: 'ai', text: `Error: ${e.message}` }]);
    } finally {
      setAiLoading(false);
      setTimeout(() => aiEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 100);
    }
  };

  // ── Derived data ──────────────────────────────────────────────────────────
  const historyItems = detail ? [
    ...(detail.activities || []).map(a => ({ date: a.activity_date, type: 'activity', icon: ACTIVITY_ICONS[a.type] || '📌', title: `${a.type.charAt(0).toUpperCase() + a.type.slice(1)}${a.assigned_to ? ` · ${a.assigned_to}` : ''}`, body: a.summary, id: a.id })),
    ...(detail.meetings   || []).map(m => ({ date: m.meeting_date,  type: 'meeting',  icon: '📝', title: m.title || 'Meeting', body: m.summary, id: m.id, actionItems: m.action_items || [] })),
  ].sort((a, b) => (!a.date ? 1 : !b.date ? -1 : new Date(b.date) - new Date(a.date))) : [];

  const allContacts = detail ? (() => {
    const seen = new Set();
    const out = [];
    const add = (name, title = '', email = '', linkedin = '') => {
      if (!name || seen.has(name.toLowerCase())) return;
      seen.add(name.toLowerCase());
      out.push({ name, title, email, linkedin });
    };
    (detail.projects || []).forEach(p => {
      (p.contacts || []).forEach(c => add(c.name, c.title, c.email));
      if (p.contact_name) add(p.contact_name);
    });
    (detail.deals || []).forEach(d => add(d.contact_name, '', d.contact_email || ''));
    // Also pull from companies row contacts
    (intel?.contacts || []).forEach(c => add(c.name, c.title, c.email, c.linkedin));
    return out;
  })() : [];

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div style={{ display: 'flex', height: '100%', overflow: 'hidden' }}>

      {/* ── Left sidebar ── */}
      <div style={{ width: 220, flexShrink: 0, borderRight: '1px solid var(--border)', display: 'flex', flexDirection: 'column', height: '100%', background: 'var(--surface)' }}>
        <div style={{ padding: '12px 12px 8px' }}>
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search clients…"
            style={{ width: '100%', fontSize: 12, padding: '7px 10px', borderRadius: 7, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)' }}
          />
        </div>
        <div style={{ flex: 1, overflowY: 'auto', padding: '4px 0' }}>
          {loadingList ? (
            <div style={{ padding: '24px 0', textAlign: 'center' }}>
              <span style={{ display: 'inline-block', width: 16, height: 16, border: '2px solid var(--accent)', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 0.7s linear infinite' }} />
            </div>
          ) : filtered.length === 0 ? (
            <div style={{ fontSize: 12, color: 'var(--text-faint)', textAlign: 'center', padding: '24px 12px' }}>{search ? 'No match' : 'No clients yet'}</div>
          ) : (
            filtered.map(c => {
              const activeCount = (c.projects || []).filter(p => p.status === 'active').length;
              return (
                <button
                  key={c.id}
                  onClick={() => setSelected(c.id)}
                  style={{ width: '100%', textAlign: 'left', background: selected === c.id ? 'var(--accent)' : 'none', border: 'none', padding: '8px 14px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}
                >
                  <span style={{ fontSize: 13, fontWeight: 600, color: selected === c.id ? '#fff' : 'var(--text)', overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>{c.name}</span>
                  {activeCount > 0 && (
                    <span style={{ fontSize: 10, fontWeight: 700, background: selected === c.id ? 'rgba(255,255,255,0.25)' : '#dcfce7', color: selected === c.id ? '#fff' : '#059669', borderRadius: 10, padding: '1px 6px', flexShrink: 0 }}>{activeCount}</span>
                  )}
                </button>
              );
            })
          )}
        </div>
        <div style={{ padding: '8px 12px', borderTop: '1px solid var(--border)', fontSize: 10, color: 'var(--text-faint)' }}>
          {clients.length} client{clients.length !== 1 ? 's' : ''}
        </div>
      </div>

      {/* ── Right panel ── */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {!selected || (!detail && !loadingDetail) ? (
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 12, color: 'var(--text-faint)' }}>
            <div style={{ fontSize: 32 }}>🏢</div>
            <div style={{ fontSize: 14 }}>Select a client</div>
          </div>
        ) : loadingDetail ? (
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <span style={{ display: 'inline-block', width: 24, height: 24, border: '3px solid var(--accent)', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 0.7s linear infinite' }} />
          </div>
        ) : detail ? (
          <>
            {/* Header */}
            <div style={{ padding: '20px 28px 0', flexShrink: 0, borderBottom: '1px solid var(--border)' }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, marginBottom: 14 }}>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                    <h2 style={{ fontSize: 22, fontWeight: 800, margin: 0, color: 'var(--text)' }}>{detail.client.name}</h2>
                    {intel?.icp_tier && (
                      <span style={{ fontSize: 10, fontWeight: 700, padding: '3px 8px', borderRadius: 10, background: '#f0fdf4', color: '#059669', border: '1px solid #bbf7d0' }}>{intel.icp_tier}</span>
                    )}
                    {intel?.icp_score != null && (
                      <span style={{ fontSize: 11, fontWeight: 800, color: scoreColor(intel.icp_score) }}>ICP {intel.icp_score}/10</span>
                    )}
                  </div>
                  <div style={{ display: 'flex', gap: 12, marginTop: 4, flexWrap: 'wrap', alignItems: 'center' }}>
                    {intel?.hq     && <span style={{ fontSize: 11, color: 'var(--text-faint)' }}>📍 {intel.hq}</span>}
                    {intel?.industry && <span style={{ fontSize: 11, color: 'var(--text-faint)' }}>· {intel.industry}</span>}
                    {detail.client.website && <a href={detail.client.website} target="_blank" rel="noreferrer" style={{ fontSize: 11, color: 'var(--accent)', textDecoration: 'none' }}>🌐 {detail.client.website.replace(/^https?:\/\//, '')}</a>}
                    {detail.client.linkedin_url && <a href={detail.client.linkedin_url} target="_blank" rel="noreferrer" style={{ fontSize: 11, color: '#0077b5', textDecoration: 'none' }}>in LinkedIn</a>}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
                  {intel?.id && (
                    <button
                      onClick={handleDeepScan}
                      disabled={scanning}
                      style={{ fontSize: 11, fontWeight: 700, padding: '6px 12px', borderRadius: 7, border: '1px solid var(--border)', background: scanning ? 'var(--surface)' : 'var(--surface)', color: scanning ? 'var(--text-faint)' : 'var(--text-muted)', cursor: scanning ? 'default' : 'pointer', display: 'flex', alignItems: 'center', gap: 5 }}
                    >
                      {scanning ? <><span style={{ display: 'inline-block', width: 10, height: 10, border: '2px solid var(--accent)', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 0.7s linear infinite' }} /> {scanStatus || 'Scanning…'}</> : '🔍 Deep Scan'}
                    </button>
                  )}
                  <button onClick={() => { setEditing(true); setTab('contacts'); }} style={{ fontSize: 11, fontWeight: 700, padding: '6px 12px', borderRadius: 7, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text-muted)', cursor: 'pointer' }}>✏️ Edit</button>
                </div>
              </div>

              {/* Tab bar */}
              <div style={{ display: 'flex' }}>
                {[
                  { id: 'overview',  label: `Overview${intel?.scan_date ? ' ✓' : ''}` },
                  { id: 'projects',  label: `Projects${detail.projects.length > 0 ? ` (${detail.projects.length})` : ''}` },
                  { id: 'contacts',  label: 'Contacts' },
                  { id: 'history',   label: `History${historyItems.length > 0 ? ` (${historyItems.length})` : ''}` },
                  { id: 'research',  label: `Research${detail.items.length > 0 ? ` (${detail.items.length})` : ''}` },
                  { id: 'ai',        label: '✦ Ask AI' },
                ].map(t => (
                  <button key={t.id} onClick={() => setTab(t.id)} style={{ fontSize: 12, fontWeight: 600, padding: '8px 14px', border: 'none', background: 'none', cursor: 'pointer', color: tab === t.id ? 'var(--accent)' : 'var(--text-muted)', borderBottom: tab === t.id ? '2px solid var(--accent)' : '2px solid transparent', marginBottom: -1, whiteSpace: 'nowrap' }}>{t.label}</button>
                ))}
              </div>
            </div>

            {/* Tab content */}
            <div style={{ flex: 1, overflowY: 'auto', padding: '24px 28px' }}>

              {/* ── Overview (Intelligence) ── */}
              {tab === 'overview' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 20, maxWidth: 720 }}>
                  {!intel ? (
                    <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--text-faint)' }}>
                      <div style={{ fontSize: 24, marginBottom: 8 }}>🔍</div>
                      <div style={{ fontSize: 13, marginBottom: 16 }}>No intelligence data yet for {detail.client.name}.</div>
                      <p style={{ fontSize: 12, color: 'var(--text-faint)', maxWidth: 320, margin: '0 auto' }}>This client doesn't have a matching entry in Rate & Review. Add them there first to enable deep scanning.</p>
                    </div>
                  ) : (
                    <>
                      {/* Score + meta row */}
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 10 }}>
                        {[
                          intel.icp_score     != null && { label: 'ICP Score',    value: `${intel.icp_score}/10`,     color: scoreColor(intel.icp_score) },
                          intel.overall_score != null && { label: 'Overall Score', value: `${intel.overall_score}/10`, color: scoreColor(intel.overall_score) },
                          intel.icp_tier              && { label: 'Tier',          value: intel.icp_tier },
                          intel.funding_stage         && { label: 'Funding',       value: intel.funding_stage },
                          intel.employee_count        && { label: 'Employees',     value: intel.employee_count },
                          intel.engagement_type       && { label: 'Engagement',    value: intel.engagement_type },
                          intel.hq                    && { label: 'HQ',            value: intel.hq },
                          intel.industry              && { label: 'Industry',      value: intel.industry },
                        ].filter(Boolean).map((item, i) => (
                          <div key={i} style={{ padding: '12px 14px', background: 'var(--surface)', borderRadius: 9, border: '1px solid var(--border)' }}>
                            <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 4 }}>{item.label}</div>
                            <div style={{ fontSize: 14, fontWeight: 800, color: item.color || 'var(--text)' }}>{item.value}</div>
                          </div>
                        ))}
                      </div>

                      {/* AI Summary */}
                      {intel.summary && (
                        <div style={{ padding: '14px 16px', background: 'var(--surface)', borderRadius: 10, border: '1px solid var(--border)' }}>
                          <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 6 }}>Summary</div>
                          <p style={{ fontSize: 13, color: 'var(--text)', margin: 0, lineHeight: 1.7 }}>{intel.summary}</p>
                        </div>
                      )}

                      {/* Recommended angle */}
                      {intel.recommended_angle && (
                        <div style={{ padding: '14px 16px', background: '#fefce8', borderRadius: 10, border: '1px solid #fef08a' }}>
                          <div style={{ fontSize: 10, fontWeight: 700, color: '#a16207', textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 6 }}>Recommended Angle</div>
                          <p style={{ fontSize: 13, color: '#78350f', margin: 0, lineHeight: 1.6, fontStyle: 'italic' }}>"{intel.recommended_angle}"</p>
                        </div>
                      )}

                      {/* Triggers */}
                      {(intel.triggers || []).length > 0 && (
                        <div>
                          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 10 }}>Signal Triggers ({intel.triggers.length})</div>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                            {intel.triggers.map((t, i) => (
                              <div key={i} style={{ padding: '12px 14px', background: 'var(--surface)', borderRadius: 9, border: '1px solid var(--border)', borderLeft: `3px solid ${catColor(t.category)}` }}>
                                <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 4 }}>
                                  <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 10, background: catColor(t.category) + '22', color: catColor(t.category) }}>{catLabel(t.category)}</span>
                                  {t.urgency === 'high' && <span style={{ fontSize: 10, fontWeight: 700, color: '#ef4444' }}>↑ High</span>}
                                  {t.date && <span style={{ fontSize: 10, color: 'var(--text-faint)', marginLeft: 'auto' }}>{t.date}</span>}
                                </div>
                                <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', marginBottom: 2 }}>{t.headline}</div>
                                {t.detail && <div style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.5 }}>{t.detail}</div>}
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Contact angles */}
                      {(intel.contact_angles || []).length > 0 && (
                        <div>
                          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 10 }}>Contact Angles</div>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                            {intel.contact_angles.map((ca, i) => (
                              <div key={i} style={{ padding: '12px 14px', background: 'var(--surface)', borderRadius: 9, border: '1px solid var(--border)' }}>
                                <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)', marginBottom: 3 }}>{ca.name} {ca.title ? <span style={{ fontWeight: 400, color: 'var(--text-muted)' }}>· {ca.title}</span> : null}</div>
                                <div style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.5, fontStyle: 'italic' }}>"{ca.angle}"</div>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Scan date */}
                      {intel.scan_date && (
                        <div style={{ fontSize: 11, color: 'var(--text-faint)', textAlign: 'right' }}>
                          Last scanned {fmtDate(intel.scan_date.slice(0,10))} · {intel.deep_scanned ? 'Deep scan ✓' : 'Surface scan only'}
                        </div>
                      )}
                    </>
                  )}
                </div>
              )}

              {/* ── Contacts ── */}
              {tab === 'contacts' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 20, maxWidth: 640 }}>
                  {editing ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: '20px', background: 'var(--surface)', borderRadius: 12, border: '1px solid var(--border)' }}>
                      <div style={{ fontSize: 13, fontWeight: 700 }}>Edit Client</div>
                      {[{ key: 'name', label: 'Company Name' }, { key: 'website', label: 'Website', placeholder: 'https://…' }, { key: 'linkedin_url', label: 'LinkedIn', placeholder: 'https://linkedin.com/company/…' }].map(f => (
                        <div key={f.key}>
                          <label style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '.04em', display: 'block', marginBottom: 4 }}>{f.label}</label>
                          <input value={editDraft[f.key] || ''} onChange={e => setEditDraft(d => ({ ...d, [f.key]: e.target.value }))} placeholder={f.placeholder} style={{ width: '100%', fontSize: 13, padding: '7px 10px' }} />
                        </div>
                      ))}
                      <div>
                        <label style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '.04em', display: 'block', marginBottom: 4 }}>Notes</label>
                        <textarea value={editDraft.notes || ''} onChange={e => setEditDraft(d => ({ ...d, notes: e.target.value }))} rows={4} style={{ width: '100%', fontSize: 13, padding: '8px 10px', resize: 'vertical', fontFamily: 'inherit' }} />
                      </div>
                      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                        <button onClick={() => setEditing(false)} style={{ fontSize: 12, padding: '7px 14px', borderRadius: 7, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)', cursor: 'pointer' }}>Cancel</button>
                        <button onClick={handleSaveClient} disabled={saving} style={{ fontSize: 12, fontWeight: 700, padding: '7px 18px', borderRadius: 7, border: 'none', background: 'var(--accent)', color: '#fff', cursor: 'pointer', opacity: saving ? 0.6 : 1 }}>{saving ? 'Saving…' : 'Save'}</button>
                      </div>
                    </div>
                  ) : detail.client.notes ? (
                    <div style={{ padding: '14px 16px', background: 'var(--surface)', borderRadius: 10, border: '1px solid var(--border)' }}>
                      <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 6 }}>Notes</div>
                      <p style={{ fontSize: 13, color: 'var(--text)', margin: 0, lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>{detail.client.notes}</p>
                    </div>
                  ) : null}

                  {allContacts.length > 0 && (
                    <div>
                      <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 10 }}>Contacts</div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                        {allContacts.map((c, i) => (
                          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', background: 'var(--surface)', borderRadius: 9, border: '1px solid var(--border)' }}>
                            <div style={{ width: 34, height: 34, borderRadius: '50%', background: 'var(--accent)', color: '#fff', fontSize: 13, fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>{c.name[0].toUpperCase()}</div>
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>{c.name}</div>
                              {c.title && <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{c.title}</div>}
                            </div>
                            <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
                              {c.email    && <a href={`mailto:${c.email}`}    style={{ fontSize: 11, color: 'var(--accent)',  textDecoration: 'none' }}>{c.email}</a>}
                              {c.linkedin && <a href={c.linkedin} target="_blank" rel="noreferrer" style={{ fontSize: 11, color: '#0077b5', textDecoration: 'none' }}>in</a>}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {!detail.client.notes && allContacts.length === 0 && !editing && (
                    <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--text-faint)' }}>
                      <div style={{ fontSize: 24, marginBottom: 8 }}>👤</div>
                      <div style={{ fontSize: 13 }}>No contacts yet. Click Edit to add notes or a website, or log a meeting to capture contacts automatically.</div>
                    </div>
                  )}
                </div>
              )}

              {/* ── Projects ── */}
              {tab === 'projects' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12, maxWidth: 680 }}>
                  {detail.projects.length === 0 ? (
                    <div style={{ fontSize: 13, color: 'var(--text-faint)', textAlign: 'center', padding: '40px 0' }}>No projects yet.</div>
                  ) : detail.projects.map(p => (
                    <div key={p.id} onClick={() => onNavigate?.('projects')} style={{ padding: '14px 16px', background: 'var(--surface)', borderRadius: 10, border: '1px solid var(--border)', cursor: 'pointer', transition: 'border-color .15s' }} onMouseEnter={e => e.currentTarget.style.borderColor = 'var(--accent)'} onMouseLeave={e => e.currentTarget.style.borderColor = 'var(--border)'}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
                        <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)' }}>{p.name}</div>
                        <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 10, background: (STATUS_COLOR[p.status] || '#9ca3af') + '22', color: STATUS_COLOR[p.status] || '#9ca3af', flexShrink: 0 }}>{p.status}</span>
                      </div>
                      {p.description && <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '4px 0 0', lineHeight: 1.5 }}>{p.description}</p>}
                      <div style={{ fontSize: 11, color: 'var(--text-faint)', marginTop: 6 }}>Started {fmtDate(p.start_date)}{p.end_date ? ` · Ends ${fmtDate(p.end_date)}` : ''}</div>
                    </div>
                  ))}
                </div>
              )}

              {/* ── History ── */}
              {tab === 'history' && (
                <div style={{ maxWidth: 680 }}>
                  {historyItems.length === 0 ? (
                    <div style={{ fontSize: 13, color: 'var(--text-faint)', textAlign: 'center', padding: '40px 0' }}>No activity or meetings logged yet.</div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 0, position: 'relative' }}>
                      <div style={{ position: 'absolute', left: 19, top: 24, bottom: 0, width: 2, background: 'var(--border)' }} />
                      {historyItems.map((item, i) => (
                        <div key={item.id + i} style={{ display: 'flex', gap: 14, paddingBottom: 20, position: 'relative' }}>
                          <div style={{ width: 40, height: 40, borderRadius: '50%', background: 'var(--surface)', border: '2px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16, flexShrink: 0, position: 'relative', zIndex: 1 }}>{item.icon}</div>
                          <div style={{ flex: 1, paddingTop: 8 }}>
                            <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 4 }}>
                              <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)' }}>{item.title}</span>
                              {item.date && <span style={{ fontSize: 11, color: 'var(--text-faint)' }}>{fmtDate(item.date)}</span>}
                            </div>
                            {item.body && <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: 0, lineHeight: 1.6 }}>{item.body}</p>}
                            {item.actionItems?.length > 0 && (
                              <div style={{ marginTop: 6, display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                                {item.actionItems.map((a, ai) => (
                                  <span key={ai} style={{ fontSize: 10, padding: '2px 7px', borderRadius: 10, background: '#f0fdf4', color: '#059669', border: '1px solid #bbf7d0' }}>↗ {a.title}</span>
                                ))}
                              </div>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* ── Research ── */}
              {tab === 'research' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 640 }}>
                  {addingItem ? (
                    <div style={{ padding: '16px', background: 'var(--surface)', borderRadius: 10, border: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: 10 }}>
                      <div style={{ display: 'flex', gap: 8 }}>
                        {['note','link'].map(t => (
                          <button key={t} onClick={() => setItemDraft(d => ({ ...d, type: t }))} style={{ fontSize: 12, fontWeight: 700, padding: '5px 12px', borderRadius: 7, border: `1px solid ${itemDraft.type === t ? 'var(--accent)' : 'var(--border)'}`, background: itemDraft.type === t ? 'var(--accent)' : 'var(--surface)', color: itemDraft.type === t ? '#fff' : 'var(--text-muted)', cursor: 'pointer' }}>{t === 'note' ? '📝 Note' : '🔗 Link'}</button>
                        ))}
                      </div>
                      <input value={itemDraft.title} onChange={e => setItemDraft(d => ({ ...d, title: e.target.value }))} placeholder={itemDraft.type === 'link' ? 'Title or description' : 'Title (optional)'} style={{ fontSize: 13, padding: '7px 10px' }} />
                      {itemDraft.type === 'link' && <input value={itemDraft.url} onChange={e => setItemDraft(d => ({ ...d, url: e.target.value }))} placeholder="https://…" style={{ fontSize: 13, padding: '7px 10px' }} />}
                      <textarea value={itemDraft.body} onChange={e => setItemDraft(d => ({ ...d, body: e.target.value }))} placeholder={itemDraft.type === 'note' ? 'Write your note…' : 'Notes about this link (optional)'} rows={3} style={{ fontSize: 13, padding: '8px 10px', resize: 'vertical', fontFamily: 'inherit' }} />
                      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                        <button onClick={() => setAddingItem(false)} style={{ fontSize: 12, padding: '6px 12px', borderRadius: 7, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)', cursor: 'pointer' }}>Cancel</button>
                        <button onClick={handleAddItem} disabled={savingItem} style={{ fontSize: 12, fontWeight: 700, padding: '6px 16px', borderRadius: 7, border: 'none', background: 'var(--accent)', color: '#fff', cursor: 'pointer', opacity: savingItem ? 0.6 : 1 }}>{savingItem ? 'Saving…' : 'Save'}</button>
                      </div>
                    </div>
                  ) : (
                    <button onClick={() => setAddingItem(true)} style={{ alignSelf: 'flex-start', fontSize: 12, fontWeight: 700, padding: '8px 16px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text-muted)', cursor: 'pointer' }}>+ Add Note or Link</button>
                  )}
                  {detail.items.length === 0 && !addingItem && (
                    <div style={{ fontSize: 13, color: 'var(--text-faint)', textAlign: 'center', padding: '32px 0' }}>No research saved yet. Add notes, links, or articles.</div>
                  )}
                  {detail.items.map(item => (
                    <div key={item.id} style={{ padding: '14px 16px', background: 'var(--surface)', borderRadius: 10, border: '1px solid var(--border)' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8, marginBottom: item.body ? 6 : 0 }}>
                        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                          <span>{item.type === 'note' ? '📝' : '🔗'}</span>
                          {item.url ? <a href={item.url} target="_blank" rel="noreferrer" style={{ fontSize: 13, fontWeight: 700, color: 'var(--accent)', textDecoration: 'none' }}>{item.title || item.url}</a> : <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>{item.title}</span>}
                        </div>
                        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexShrink: 0 }}>
                          <span style={{ fontSize: 10, color: 'var(--text-faint)' }}>{fmtDate(item.created_at?.slice(0,10))}</span>
                          <button onClick={() => handleDeleteItem(item.id)} style={{ background: 'none', border: 'none', fontSize: 13, color: 'var(--text-faint)', cursor: 'pointer', padding: '2px 4px' }}>×</button>
                        </div>
                      </div>
                      {item.body && <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: 0, lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>{item.body}</p>}
                    </div>
                  ))}
                </div>
              )}

              {/* ── Ask AI ── */}
              {tab === 'ai' && (
                <div style={{ display: 'flex', flexDirection: 'column', height: '100%', maxWidth: 680 }}>
                  <div style={{ fontSize: 12, color: 'var(--text-faint)', marginBottom: 16, lineHeight: 1.5 }}>
                    Ask anything about <strong>{detail.client.name}</strong> — searches across all meetings, activities, intelligence, notes, and links.
                  </div>
                  <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 14, paddingBottom: 16, minHeight: 120 }}>
                    {aiMessages.length === 0 && (
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                        {[`What's the latest on ${detail.client.name}?`, 'Who are our main contacts?', 'What action items are outstanding?', 'What is their recommended engagement angle?'].map(q => (
                          <button key={q} onClick={() => setAiQ(q)} style={{ fontSize: 12, padding: '7px 12px', borderRadius: 20, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text-muted)', cursor: 'pointer' }}>{q}</button>
                        ))}
                      </div>
                    )}
                    {aiMessages.map((m, i) => (
                      <div key={i} style={{ display: 'flex', flexDirection: 'column', alignItems: m.role === 'user' ? 'flex-end' : 'flex-start' }}>
                        <div style={{ maxWidth: '85%', padding: '10px 14px', borderRadius: m.role === 'user' ? '12px 12px 4px 12px' : '12px 12px 12px 4px', background: m.role === 'user' ? 'var(--accent)' : 'var(--surface)', color: m.role === 'user' ? '#fff' : 'var(--text)', border: m.role === 'ai' ? '1px solid var(--border)' : 'none', fontSize: 13, lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>{m.text}</div>
                      </div>
                    ))}
                    {aiLoading && <div style={{ display: 'flex', gap: 6, alignItems: 'center', color: 'var(--text-faint)', fontSize: 12 }}><span style={{ display: 'inline-block', width: 12, height: 12, border: '2px solid var(--accent)', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 0.7s linear infinite' }} />Thinking…</div>}
                    <div ref={aiEndRef} />
                  </div>
                  <div style={{ display: 'flex', gap: 8, paddingTop: 12, borderTop: '1px solid var(--border-light)', flexShrink: 0 }}>
                    <input value={aiQ} onChange={e => setAiQ(e.target.value)} onKeyDown={e => e.key === 'Enter' && !e.shiftKey && handleAsk()} placeholder={`Ask about ${detail.client.name}…`} style={{ flex: 1, fontSize: 13, padding: '9px 12px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)' }} />
                    <button onClick={handleAsk} disabled={!aiQ.trim() || aiLoading} style={{ fontSize: 13, fontWeight: 700, padding: '9px 18px', borderRadius: 8, border: 'none', background: 'var(--accent)', color: '#fff', cursor: !aiQ.trim() || aiLoading ? 'default' : 'pointer', opacity: !aiQ.trim() || aiLoading ? 0.5 : 1 }}>Ask →</button>
                  </div>
                </div>
              )}

            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}
