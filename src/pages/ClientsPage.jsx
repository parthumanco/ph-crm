import { useState, useEffect, useRef } from 'react';
import {
  fetchClients, fetchClientDetail, fetchCompanyIntel, runClientDeepScan, runBuildThesis,
  upsertClient, upsertClientContacts, enrichClientContact,
  addClientItem, deleteClientItem, askClientQuestion,
} from '../lib/clients';

const STATUS_COLOR = { active: '#10b981', completed: '#6366f1', on_hold: '#f59e0b', cancelled: '#ef4444', archived: '#9ca3af' };
const projStatus = p => p.archived_at ? 'archived' : (p.status || 'active');
const projStatusLabel = p => { const s = projStatus(p); return s.charAt(0).toUpperCase() + s.slice(1).replace('_', ' '); };
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
  const [scanning, setScanning]     = useState(false);
  const [scanStatus, setScanStatus] = useState('');

  // Contact dossiers
  const [enrichingContact, setEnrichingContact] = useState(null); // contact name
  const [expandedContact, setExpandedContact]   = useState(null); // contact name
  const [addingContact, setAddingContact]       = useState(false);
  const [contactDraft, setContactDraft]         = useState({ name: '', title: '', email: '', linkedin: '' });

  // Build Thesis
  const [buildingThesis, setBuildingThesis] = useState(false);
  const [thesisPhases, setThesisPhases]     = useState([]); // [{phase,status,detail}]
  const [thesisLog, setThesisLog]           = useState([]); // [{icon,text,phase,ts}]
  const [thesisError, setThesisError]       = useState('');
  const [showThesisModal, setShowThesisModal] = useState(false);
  const thesisLogEndRef                     = useRef(null);

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
      const updated = await runClientDeepScan(intel.id, intel, icp, detail || {}, selected);
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

  const THESIS_PHASES = [
    { phase: 1, label: 'Company & Leadership Discovery',  icon: '🏢' },
    { phase: 2, label: 'Contact Signal Mining',           icon: '👤' },
    { phase: 3, label: 'Trigger Events & Competitive',    icon: '📡' },
    { phase: 4, label: 'Synthesising Full Thesis',        icon: '🧠' },
  ];

  const addThesisLog = (icon, text, phase) => {
    const entry = { icon, text, phase, ts: new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }) };
    setThesisLog(prev => [...prev, entry]);
    setTimeout(() => thesisLogEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 60);
  };

  const handleBuildThesis = async () => {
    if (!intel?.id || buildingThesis) return;
    setBuildingThesis(true);
    setThesisError('');
    setThesisLog([]);
    setShowThesisModal(true);
    setThesisPhases(THESIS_PHASES.map(p => ({ ...p, status: 'waiting', detail: null })));
    setTab('overview');
    try {
      const updated = await runBuildThesis(intel.id, intel, icp, detail || {}, (phase, status, data, message) => {
        setThesisPhases(prev => prev.map(p => p.phase === phase ? { ...p, status, detail: data } : p));
        if (message) addThesisLog(
          status === 'running' ? '🔍' : status === 'done' ? '✅' : status === 'log' ? '  →' : '⚙️',
          message, phase
        );
      }, selected);
      setIntel(updated);
      addThesisLog('✅', `Thesis complete — ICP ${updated.icp_score ?? '?'}/10 · ${updated.icp_tier ?? ''}`, 4);
    } catch (e) {
      setThesisError(e.message || 'Thesis build failed');
      addThesisLog('❌', `Error: ${e.message}`, 0);
    } finally {
      setBuildingThesis(false);
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

  // Rich contacts: clients.contacts is the primary store; supplement with project/deal contacts
  const allContacts = detail ? (() => {
    const map = new Map();
    // Priority 1: stored rich contacts on the clients table
    (detail.client?.contacts || []).forEach(c => {
      if (!c.name) return;
      map.set(c.name.toLowerCase(), c);
    });
    // Priority 2: project contacts (lower priority — don't overwrite richer data)
    (detail.projects || []).forEach(p => {
      (p.contacts || []).forEach(c => {
        if (!c.name) return;
        const k = c.name.toLowerCase();
        if (!map.has(k)) map.set(k, { name: c.name, title: c.title || '', email: c.email || '', source: 'project' });
      });
      if (p.contact_name && !map.has(p.contact_name.toLowerCase())) map.set(p.contact_name.toLowerCase(), { name: p.contact_name, source: 'project' });
    });
    (detail.deals || []).forEach(d => {
      if (!d.contact_name) return;
      const k = d.contact_name.toLowerCase();
      if (!map.has(k)) map.set(k, { name: d.contact_name, email: d.contact_email || '', source: 'deal' });
    });
    // Priority 3: intel contact_angles (scan data)
    (intel?.contact_angles || []).forEach(c => {
      if (!c.name) return;
      const k = c.name.toLowerCase();
      if (!map.has(k)) map.set(k, { name: c.name, title: c.title || '', linkedin: c.linkedinUrl || c.linkedin || null, source: 'scan' });
    });
    return Array.from(map.values());
  })() : [];

  const handleEnrichContact = async (contact) => {
    if (!selected || enrichingContact) return;
    setEnrichingContact(contact.name);
    try {
      const updated = await enrichClientContact(selected, contact, detail?.client?.name || '');
      setDetail(d => ({ ...d, client: { ...d.client, contacts: updated } }));
      setExpandedContact(contact.name);
    } catch (e) { console.error('Enrich failed:', e); }
    finally { setEnrichingContact(null); }
  };

  const handleAddManualContact = async () => {
    if (!contactDraft.name.trim() || !selected) return;
    const newContact = { ...contactDraft, id: crypto.randomUUID(), source: 'manual', created_at: new Date().toISOString() };
    const updated = await upsertClientContacts(selected, [newContact]);
    setDetail(d => ({ ...d, client: { ...d.client, contacts: updated } }));
    setContactDraft({ name: '', title: '', email: '', linkedin: '' });
    setAddingContact(false);
    setExpandedContact(newContact.name);
  };

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
              const activeCount = (c.projects || []).filter(p => !p.archived_at && p.status === 'active').length;
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
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', position: 'relative' }}>
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
                <div style={{ display: 'flex', gap: 8, flexShrink: 0, flexWrap: 'wrap' }}>
                  {intel?.id && (
                    <>
                      <button
                        onClick={handleDeepScan}
                        disabled={scanning || buildingThesis}
                        style={{ fontSize: 11, fontWeight: 700, padding: '6px 12px', borderRadius: 7, border: '1px solid var(--border)', background: 'var(--surface)', color: (scanning || buildingThesis) ? 'var(--text-faint)' : 'var(--text-muted)', cursor: (scanning || buildingThesis) ? 'default' : 'pointer', display: 'flex', alignItems: 'center', gap: 5 }}
                      >
                        {scanning ? <><span style={{ display: 'inline-block', width: 10, height: 10, border: '2px solid var(--accent)', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 0.7s linear infinite' }} /> {scanStatus || 'Scanning…'}</> : '🔍 Quick Scan'}
                      </button>
                      <button
                        onClick={handleBuildThesis}
                        disabled={scanning || buildingThesis}
                        style={{ fontSize: 11, fontWeight: 700, padding: '6px 14px', borderRadius: 7, border: '1px solid var(--accent)', background: buildingThesis ? 'var(--surface)' : 'var(--accent)', color: buildingThesis ? 'var(--text-faint)' : '#fff', cursor: (scanning || buildingThesis) ? 'default' : 'pointer', display: 'flex', alignItems: 'center', gap: 5 }}
                      >
                        {buildingThesis ? <><span style={{ display: 'inline-block', width: 10, height: 10, border: '2px solid var(--accent)', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 0.7s linear infinite' }} /> Building…</> : '🧠 Build Thesis'}
                      </button>
                    </>
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
                      <p style={{ fontSize: 12, color: 'var(--text-faint)', maxWidth: 320, margin: '0 auto' }}>This client doesn't have a matching entry in Watch List. Add them there first to enable deep scanning.</p>
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

                      {/* ── Full Thesis (only if thesis_built) ── */}
                      {intel.thesis_built && intel.thesis && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, borderTop: '2px solid var(--accent)', paddingTop: 20, marginTop: 4 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <span style={{ fontSize: 13, fontWeight: 800, color: 'var(--text)' }}>🧠 Full Thesis</span>
                            {intel.thesis_date && <span style={{ fontSize: 10, color: 'var(--text-faint)' }}>Built {fmtDate(intel.thesis_date.slice(0,10))}</span>}
                          </div>
                          <div style={{ fontSize: 13, color: 'var(--text)', lineHeight: 1.8, whiteSpace: 'pre-wrap', padding: '14px 16px', background: 'var(--surface)', borderRadius: 10, border: '1px solid var(--border)' }}>
                            {intel.thesis}
                          </div>
                          {/* Entry contact */}
                          {(() => {
                            const entry = (intel.contact_angles || []).find(ca => ca.is_primary);
                            if (!entry) return null;
                            return (
                              <div style={{ padding: '14px 16px', background: '#f0fdf4', borderRadius: 10, border: '1px solid #bbf7d0' }}>
                                <div style={{ fontSize: 10, fontWeight: 700, color: '#059669', textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 8 }}>Primary Entry Point</div>
                                <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>{entry.name} {entry.title && <span style={{ fontWeight: 400, color: 'var(--text-muted)' }}>· {entry.title}</span>}</div>
                                {entry.linkedin && <a href={entry.linkedin} target="_blank" rel="noreferrer" style={{ fontSize: 11, color: '#0077b5', textDecoration: 'none', display: 'block', marginTop: 2 }}>↗ LinkedIn</a>}
                                <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 6, lineHeight: 1.5, fontStyle: 'italic' }}>"{entry.angle}"</div>
                                {entry.hook && <div style={{ fontSize: 12, color: '#059669', marginTop: 6, lineHeight: 1.5 }}>Hook: {entry.hook}</div>}
                              </div>
                            );
                          })()}
                          {/* Risks */}
                          {(intel.thesis_risks || []).length > 0 && (
                            <div style={{ padding: '12px 16px', background: '#fff7ed', borderRadius: 9, border: '1px solid #fed7aa' }}>
                              <div style={{ fontSize: 10, fontWeight: 700, color: '#c2410c', textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 8 }}>Risks & Sensitivities</div>
                              <ul style={{ margin: 0, paddingLeft: 16, display: 'flex', flexDirection: 'column', gap: 4 }}>
                                {intel.thesis_risks.map((r, i) => <li key={i} style={{ fontSize: 12, color: '#78350f', lineHeight: 1.5 }}>{r}</li>)}
                              </ul>
                            </div>
                          )}
                          {/* Next step */}
                          {intel.thesis_next_step && (
                            <div style={{ padding: '10px 14px', background: 'var(--surface)', borderRadius: 9, border: '1px solid var(--border)' }}>
                              <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 4 }}>Recommended Next Step</div>
                              <div style={{ fontSize: 13, color: 'var(--text)', lineHeight: 1.5 }}>{intel.thesis_next_step}</div>
                            </div>
                          )}
                        </div>
                      )}

                      {/* Scan date */}
                      {intel.scan_date && (
                        <div style={{ fontSize: 11, color: 'var(--text-faint)', textAlign: 'right' }}>
                          Last scanned {fmtDate(intel.scan_date.slice(0,10))} · {intel.thesis_built ? 'Full thesis ✓' : intel.deep_scanned ? 'Deep scan ✓' : 'Surface scan only'}
                        </div>
                      )}
                    </>
                  )}
                </div>
              )}

              {/* ── Contacts ── */}
              {tab === 'contacts' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 700 }}>

                  {/* Client notes + edit form */}
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
                    <div style={{ padding: '12px 16px', background: 'var(--surface)', borderRadius: 10, border: '1px solid var(--border)' }}>
                      <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 5 }}>Notes</div>
                      <p style={{ fontSize: 13, color: 'var(--text)', margin: 0, lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>{detail.client.notes}</p>
                    </div>
                  ) : null}

                  {/* Header row */}
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '.04em' }}>
                      {allContacts.length} Contact{allContacts.length !== 1 ? 's' : ''}
                    </div>
                    <button onClick={() => setAddingContact(true)} style={{ fontSize: 11, fontWeight: 700, padding: '5px 12px', borderRadius: 7, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text-muted)', cursor: 'pointer' }}>+ Add Contact</button>
                  </div>

                  {/* Add contact form */}
                  {addingContact && (
                    <div style={{ padding: '14px 16px', background: 'var(--surface)', borderRadius: 10, border: '1px solid var(--accent)', display: 'flex', flexDirection: 'column', gap: 10 }}>
                      <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)' }}>New Contact</div>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                        {[['name','Name *'],['title','Title'],['email','Email'],['linkedin','LinkedIn URL']].map(([k, lbl]) => (
                          <input key={k} value={contactDraft[k]} onChange={e => setContactDraft(d => ({...d, [k]: e.target.value}))} placeholder={lbl} style={{ fontSize: 12, padding: '6px 10px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)' }} />
                        ))}
                      </div>
                      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                        <button onClick={() => setAddingContact(false)} style={{ fontSize: 12, padding: '5px 12px', borderRadius: 7, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)', cursor: 'pointer' }}>Cancel</button>
                        <button onClick={handleAddManualContact} disabled={!contactDraft.name.trim()} style={{ fontSize: 12, fontWeight: 700, padding: '5px 16px', borderRadius: 7, border: 'none', background: 'var(--accent)', color: '#fff', cursor: 'pointer', opacity: contactDraft.name.trim() ? 1 : 0.5 }}>Save</button>
                      </div>
                    </div>
                  )}

                  {allContacts.length === 0 && !addingContact && (
                    <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--text-faint)' }}>
                      <div style={{ fontSize: 24, marginBottom: 8 }}>👤</div>
                      <div style={{ fontSize: 13 }}>No contacts yet. Run a Quick Scan or Build Thesis to auto-discover the leadership team, or add contacts manually.</div>
                    </div>
                  )}

                  {/* Contact cards */}
                  {allContacts.map((c, i) => {
                    const isExpanded = expandedContact === c.name;
                    const isEnriching = enrichingContact === c.name;
                    const isEnriched = !!(c.enriched_at || c.job_history?.length || c.education?.length || c.posts?.length);
                    const initials = c.name.split(' ').map(w => w[0]).slice(0,2).join('').toUpperCase();
                    const SOURCE_COLORS = { thesis: '#8b5cf6', scan: '#3b82f6', manual: '#10b981', project: '#f59e0b', deal: '#f59e0b' };
                    const srcColor = SOURCE_COLORS[c.source] || '#94a3b8';

                    return (
                      <div key={c.id || c.name + i} style={{ background: 'var(--surface)', borderRadius: 11, border: `1px solid ${isExpanded ? 'var(--accent)' : 'var(--border)'}`, overflow: 'hidden', transition: 'border-color .2s' }}>

                        {/* Card header */}
                        <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px' }}>
                          <div style={{ width: 40, height: 40, borderRadius: '50%', background: `linear-gradient(135deg, var(--accent), #6366f1)`, color: '#fff', fontSize: 14, fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>{initials}</div>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                              <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)' }}>{c.name}</span>
                              {c.is_primary && <span style={{ fontSize: 9, fontWeight: 800, padding: '2px 6px', borderRadius: 8, background: '#fef9c3', color: '#a16207', border: '1px solid #fde68a' }}>PRIMARY</span>}
                              {c.source && <span style={{ fontSize: 9, fontWeight: 700, padding: '2px 6px', borderRadius: 8, background: srcColor + '18', color: srcColor }}>{c.source}</span>}
                              {isEnriched && <span style={{ fontSize: 9, fontWeight: 700, color: '#10b981' }}>✓ enriched</span>}
                            </div>
                            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 1 }}>
                              {[c.title, c.location].filter(Boolean).join(' · ')}
                            </div>
                            <div style={{ display: 'flex', gap: 10, marginTop: 4, flexWrap: 'wrap' }}>
                              {c.email    && <a href={`mailto:${c.email}`} style={{ fontSize: 11, color: 'var(--accent)', textDecoration: 'none' }}>{c.email}</a>}
                              {c.linkedin && <a href={c.linkedin} target="_blank" rel="noreferrer" style={{ fontSize: 11, color: '#0077b5', textDecoration: 'none', fontWeight: 600 }}>in LinkedIn</a>}
                              {c.twitter  && <a href={c.twitter}  target="_blank" rel="noreferrer" style={{ fontSize: 11, color: '#1da1f2', textDecoration: 'none', fontWeight: 600 }}>𝕏 Twitter</a>}
                            </div>
                          </div>
                          <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                            <button
                              onClick={() => handleEnrichContact(c)}
                              disabled={!!enrichingContact}
                              title="Enrich with AI — builds full dossier from web search"
                              style={{ fontSize: 10, fontWeight: 700, padding: '4px 10px', borderRadius: 6, border: '1px solid var(--border)', background: isEnriching ? 'var(--surface-2)' : 'var(--surface)', color: isEnriching ? 'var(--accent)' : 'var(--text-muted)', cursor: enrichingContact ? 'default' : 'pointer', display: 'flex', alignItems: 'center', gap: 4 }}
                            >
                              {isEnriching ? <><span style={{ display: 'inline-block', width: 8, height: 8, border: '1.5px solid var(--accent)', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 0.7s linear infinite' }} /> enriching…</> : '🔬 Enrich'}
                            </button>
                            <button onClick={() => setExpandedContact(isExpanded ? null : c.name)} style={{ fontSize: 10, fontWeight: 700, padding: '4px 10px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text-muted)', cursor: 'pointer' }}>
                              {isExpanded ? '▲ Less' : '▼ Dossier'}
                            </button>
                          </div>
                        </div>

                        {/* Expanded dossier */}
                        {isExpanded && (
                          <div style={{ borderTop: '1px solid var(--border)', padding: '16px', display: 'flex', flexDirection: 'column', gap: 16 }}>

                            {/* Angle/hook from scan/thesis */}
                            {(c.angle || c.hook) && (
                              <div style={{ padding: '10px 14px', background: '#fefce8', borderRadius: 8, border: '1px solid #fef08a' }}>
                                {c.angle && <div style={{ fontSize: 12, color: '#78350f', fontWeight: 600, marginBottom: c.hook ? 4 : 0 }}>{c.angle}</div>}
                                {c.hook  && <div style={{ fontSize: 12, color: '#92400e', fontStyle: 'italic' }}>"{c.hook}"</div>}
                              </div>
                            )}

                            {/* Bio summary */}
                            {c.bio_summary && (
                              <div>
                                <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 5 }}>Bio</div>
                                <p style={{ fontSize: 12, color: 'var(--text)', margin: 0, lineHeight: 1.65 }}>{c.bio_summary}</p>
                              </div>
                            )}

                            {/* Job history */}
                            {(c.job_history || []).length > 0 && (
                              <div>
                                <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 8 }}>Career History</div>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                                  {c.job_history.map((j, ji) => (
                                    <div key={ji} style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                                      <div style={{ width: 6, height: 6, borderRadius: '50%', background: j.is_current ? 'var(--accent)' : 'var(--border)', marginTop: 5, flexShrink: 0 }} />
                                      <div>
                                        <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)' }}>{j.title}</span>
                                        <span style={{ fontSize: 12, color: 'var(--text-muted)' }}> · {j.company}</span>
                                        {(j.from || j.to) && <span style={{ fontSize: 11, color: 'var(--text-faint)', marginLeft: 6 }}>{j.from}{j.to ? ` – ${j.to}` : j.is_current ? ' – present' : ''}</span>}
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )}

                            {/* Education */}
                            {(c.education || []).length > 0 && (
                              <div>
                                <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 8 }}>Education</div>
                                {c.education.map((e, ei) => (
                                  <div key={ei} style={{ fontSize: 12, color: 'var(--text)', marginBottom: 3 }}>
                                    {e.school}{e.degree ? ` — ${e.degree}` : ''}{e.years ? ` (${e.years})` : ''}
                                  </div>
                                ))}
                              </div>
                            )}

                            {/* Recent posts */}
                            {(c.posts || []).length > 0 && (
                              <div>
                                <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 8 }}>Recent Posts & Activity</div>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                                  {c.posts.map((p, pi) => (
                                    <div key={pi} style={{ padding: '10px 12px', background: 'var(--bg)', borderRadius: 8, border: '1px solid var(--border)' }}>
                                      <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 4 }}>
                                        <span style={{ fontSize: 10, fontWeight: 700, padding: '1px 6px', borderRadius: 8, background: p.platform === 'linkedin' ? '#e0f2fe' : '#f0f9ff', color: p.platform === 'linkedin' ? '#0369a1' : '#0284c7' }}>{p.platform}</span>
                                        {p.date && <span style={{ fontSize: 10, color: 'var(--text-faint)' }}>{p.date}</span>}
                                        {p.url && <a href={p.url} target="_blank" rel="noreferrer" style={{ fontSize: 10, color: 'var(--accent)', marginLeft: 'auto' }}>↗</a>}
                                      </div>
                                      <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)', marginBottom: 3 }}>{p.headline}</div>
                                      {p.summary && <div style={{ fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.5 }}>{p.summary}</div>}
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )}

                            {/* Articles & talks */}
                            {(c.articles_talks || []).length > 0 && (
                              <div>
                                <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 8 }}>Articles & Talks</div>
                                {c.articles_talks.map((a, ai) => (
                                  <div key={ai} style={{ fontSize: 12, color: 'var(--text)', marginBottom: 5 }}>
                                    {a.url ? <a href={a.url} target="_blank" rel="noreferrer" style={{ color: 'var(--accent)', fontWeight: 600, textDecoration: 'none' }}>{a.title}</a> : <span style={{ fontWeight: 600 }}>{a.title}</span>}
                                    {a.outlet && <span style={{ color: 'var(--text-muted)' }}> · {a.outlet}</span>}
                                    {a.date   && <span style={{ color: 'var(--text-faint)', fontSize: 11 }}> ({a.date})</span>}
                                  </div>
                                ))}
                              </div>
                            )}

                            {/* Interests & fun facts */}
                            {((c.interests || []).length > 0 || (c.fun_facts || []).length > 0) && (
                              <div>
                                <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 8 }}>Interests & Background</div>
                                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                                  {[...(c.interests || []), ...(c.fun_facts || [])].map((item, ii) => (
                                    <span key={ii} style={{ fontSize: 11, padding: '3px 9px', borderRadius: 12, background: 'var(--surface-2, var(--bg))', border: '1px solid var(--border)', color: 'var(--text-muted)' }}>{item}</span>
                                  ))}
                                </div>
                              </div>
                            )}

                            {!isEnriched && (
                              <div style={{ fontSize: 12, color: 'var(--text-faint)', textAlign: 'center', padding: '8px 0' }}>
                                No dossier data yet. Click <strong>🔬 Enrich</strong> to run a deep search on this person.
                              </div>
                            )}

                            {c.enriched_at && <div style={{ fontSize: 10, color: 'var(--text-faint)', textAlign: 'right' }}>Enriched {fmtDate(c.enriched_at.slice(0,10))}</div>}
                          </div>
                        )}
                      </div>
                    );
                  })}
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
                        <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 10, background: (STATUS_COLOR[projStatus(p)] || '#9ca3af') + '22', color: STATUS_COLOR[projStatus(p)] || '#9ca3af', flexShrink: 0 }}>{projStatusLabel(p)}</span>
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

        {/* ── Thesis live progress modal ── */}
        {showThesisModal && (
          <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50 }}>
            <div style={{ background: 'var(--bg)', borderRadius: 14, width: 560, maxHeight: '80vh', boxShadow: '0 24px 64px rgba(0,0,0,0.35)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

              {/* Header */}
              <div style={{ padding: '20px 24px 16px', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                  <div>
                    <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--text)' }}>
                      {buildingThesis ? `Building Thesis` : `Thesis Complete ✓`}
                      <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-muted)', marginLeft: 8 }}>{detail?.client?.name}</span>
                    </div>
                  </div>
                  {!buildingThesis && (
                    <button onClick={() => setShowThesisModal(false)} style={{ fontSize: 11, fontWeight: 700, padding: '6px 16px', borderRadius: 7, border: 'none', background: 'var(--accent)', color: '#fff', cursor: 'pointer' }}>View Results →</button>
                  )}
                </div>

                {/* Phase strip */}
                <div style={{ display: 'flex', gap: 4, marginTop: 14 }}>
                  {thesisPhases.map((p, i) => {
                    const isActive  = p.status === 'running';
                    const isDone    = p.status === 'done';
                    const isWaiting = p.status === 'waiting';
                    return (
                      <div key={p.phase} style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 4 }}>
                        <div style={{ height: 4, borderRadius: 3, background: isDone ? 'var(--accent)' : isActive ? '#93c5fd' : 'var(--border)', transition: 'background .3s' }} />
                        <div style={{ fontSize: 10, fontWeight: 600, color: isDone ? 'var(--accent)' : isActive ? '#3b82f6' : 'var(--text-faint)', display: 'flex', alignItems: 'center', gap: 4 }}>
                          {isActive && <span style={{ display: 'inline-block', width: 7, height: 7, border: '1.5px solid #3b82f6', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 0.7s linear infinite', flexShrink: 0 }} />}
                          {isDone && <span style={{ color: 'var(--accent)' }}>✓</span>}
                          {p.label}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Live log */}
              <div style={{ flex: 1, overflowY: 'auto', padding: '14px 24px 20px', fontFamily: 'ui-monospace, "SF Mono", Menlo, monospace' }}>
                {thesisLog.length === 0 && (
                  <div style={{ fontSize: 12, color: 'var(--text-faint)', fontFamily: 'inherit' }}>Starting…</div>
                )}
                {thesisLog.map((entry, i) => (
                  <div key={i} style={{ display: 'flex', gap: 10, marginBottom: 6, alignItems: 'flex-start' }}>
                    <span style={{ fontSize: 11, color: 'var(--text-faint)', flexShrink: 0, paddingTop: 1, minWidth: 60 }}>{entry.ts}</span>
                    <span style={{ fontSize: 13, flexShrink: 0 }}>{entry.icon}</span>
                    <span style={{ fontSize: 12, color: entry.icon === '❌' ? '#ef4444' : entry.icon === '✅' ? '#10b981' : entry.icon === '  →' ? 'var(--text-muted)' : 'var(--text)', lineHeight: 1.5 }}>{entry.text}</span>
                  </div>
                ))}
                {buildingThesis && (
                  <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 4 }}>
                    <span style={{ fontSize: 11, color: 'transparent', minWidth: 60 }}>--:--:--</span>
                    <span style={{ display: 'inline-block', width: 10, height: 10, border: '2px solid var(--accent)', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 0.7s linear infinite', flexShrink: 0 }} />
                    <span style={{ fontSize: 12, color: 'var(--text-faint)', fontStyle: 'italic' }}>Working…</span>
                  </div>
                )}
                <div ref={thesisLogEndRef} />
              </div>

              {/* Error */}
              {thesisError && (
                <div style={{ padding: '10px 24px', borderTop: '1px solid var(--border)', background: '#fef2f2', flexShrink: 0 }}>
                  <span style={{ fontSize: 12, color: '#ef4444' }}>❌ {thesisError}</span>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
