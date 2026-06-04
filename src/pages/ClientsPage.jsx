import { useState, useEffect, useRef } from 'react';
import {
  fetchClients, fetchClientDetail,
  upsertClient, addClientItem, deleteClientItem, askClientQuestion,
} from '../lib/clients';

const STATUS_COLOR = { active: '#10b981', completed: '#6366f1', paused: '#f59e0b', archived: '#9ca3af' };
const ACTIVITY_ICONS = { email: '✉️', call: '📞', meeting: '🤝', note: '📝', proposal: '📄', contract: '✍️' };

function fmtDate(d) {
  if (!d) return '';
  return new Date(d + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export default function ClientsPage({ onNavigate, refreshKey }) {
  const [clients, setClients]         = useState([]);
  const [search, setSearch]           = useState('');
  const [selected, setSelected]       = useState(null);  // client id
  const [detail, setDetail]           = useState(null);  // { client, projects, activities, meetings, items }
  const [loadingList, setLoadingList] = useState(true);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [tab, setTab]                 = useState('overview');

  // Edit mode
  const [editing, setEditing]         = useState(false);
  const [editDraft, setEditDraft]     = useState({});
  const [saving, setSaving]           = useState(false);

  // Research
  const [addingItem, setAddingItem]   = useState(false);
  const [itemDraft, setItemDraft]     = useState({ type: 'note', title: '', url: '', body: '' });
  const [savingItem, setSavingItem]   = useState(false);

  // AI chat
  const [aiQ, setAiQ]                 = useState('');
  const [aiMessages, setAiMessages]   = useState([]); // { role, text }
  const [aiLoading, setAiLoading]     = useState(false);
  const aiEndRef                      = useRef(null);

  // ── Load list ─────────────────────────────────────────────────────────────
  useEffect(() => {
    setLoadingList(true);
    fetchClients()
      .then(data => {
        // Only show clients that have at least one project
        const withProjects = data.filter(c => (c.projects || []).length > 0);
        setClients(withProjects);
        if (withProjects.length > 0 && !selected) {
          setSelected(withProjects[0].id);
        }
      })
      .catch(console.error)
      .finally(() => setLoadingList(false));
  }, [refreshKey]);

  // ── Load detail ───────────────────────────────────────────────────────────
  useEffect(() => {
    if (!selected) return;
    setLoadingDetail(true);
    setDetail(null);
    setAiMessages([]);
    setTab('overview');
    fetchClientDetail(selected)
      .then(d => {
        setDetail(d);
        setEditDraft({ name: d.client.name, website: d.client.website || '', linkedin_url: d.client.linkedin_url || '', notes: d.client.notes || '' });
      })
      .catch(console.error)
      .finally(() => setLoadingDetail(false));
  }, [selected]);

  // ── Filtered list ─────────────────────────────────────────────────────────
  const filtered = clients.filter(c =>
    c.name.toLowerCase().includes(search.toLowerCase())
  );

  // Group A-Z
  const grouped = {};
  filtered.forEach(c => {
    const letter = c.name[0].toUpperCase();
    if (!grouped[letter]) grouped[letter] = [];
    grouped[letter].push(c);
  });

  // ── Save client edits ─────────────────────────────────────────────────────
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

  // ── Add research item ─────────────────────────────────────────────────────
  const handleAddItem = async () => {
    if (!itemDraft.title.trim() && !itemDraft.body.trim()) return;
    setSavingItem(true);
    try {
      const item = await addClientItem({
        clientId: selected,
        type:     itemDraft.type,
        title:    itemDraft.title || itemDraft.body.slice(0, 60),
        url:      itemDraft.url  || null,
        body:     itemDraft.body || null,
      });
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

  // ── AI Q&A ────────────────────────────────────────────────────────────────
  const handleAsk = async () => {
    if (!aiQ.trim() || aiLoading || !detail) return;
    const question = aiQ.trim();
    setAiQ('');
    setAiMessages(prev => [...prev, { role: 'user', text: question }]);
    setAiLoading(true);
    try {
      const answer = await askClientQuestion(detail, question);
      setAiMessages(prev => [...prev, { role: 'ai', text: answer }]);
    } catch (e) {
      setAiMessages(prev => [...prev, { role: 'ai', text: `Error: ${e.message}` }]);
    } finally {
      setAiLoading(false);
      setTimeout(() => aiEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 100);
    }
  };

  // ── Merged history timeline ───────────────────────────────────────────────
  const historyItems = detail ? [
    ...(detail.activities || []).map(a => ({
      date: a.activity_date, type: 'activity', icon: ACTIVITY_ICONS[a.type] || '📌',
      title: `${a.type.charAt(0).toUpperCase() + a.type.slice(1)}${a.assigned_to ? ` · ${a.assigned_to}` : ''}`,
      body: a.summary, id: a.id,
    })),
    ...(detail.meetings || []).map(m => ({
      date: m.meeting_date, type: 'meeting', icon: '📝',
      title: m.title || 'Meeting',
      body: m.summary, id: m.id,
      actionItems: m.action_items || [],
    })),
  ].sort((a, b) => {
    if (!a.date && !b.date) return 0;
    if (!a.date) return 1;
    if (!b.date) return -1;
    return new Date(b.date) - new Date(a.date);
  }) : [];

  // ── Contacts (merged across projects) ────────────────────────────────────
  const allContacts = detail ? (() => {
    const seen = new Set();
    const out = [];
    (detail.projects || []).forEach(p => {
      (p.contacts || []).forEach(c => {
        if (c.name && !seen.has(c.name.toLowerCase())) {
          seen.add(c.name.toLowerCase());
          out.push(c);
        }
      });
      if (p.contact_name && !seen.has(p.contact_name.toLowerCase())) {
        seen.add(p.contact_name.toLowerCase());
        out.push({ name: p.contact_name, title: '', email: '' });
      }
    });
    (detail.deals || []).forEach(d => {
      if (d.contact_name && !seen.has(d.contact_name.toLowerCase())) {
        seen.add(d.contact_name.toLowerCase());
        out.push({ name: d.contact_name, title: '', email: d.contact_email || '' });
      }
    });
    return out;
  })() : [];

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div style={{ display: 'flex', height: '100%', overflow: 'hidden' }}>

      {/* ── Left sidebar ── */}
      <div style={{
        width: 240, flexShrink: 0, borderRight: '1px solid var(--border)',
        display: 'flex', flexDirection: 'column', height: '100%', background: 'var(--surface)',
      }}>
        {/* Search */}
        <div style={{ padding: '12px 12px 8px' }}>
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search clients…"
            style={{ width: '100%', fontSize: 12, padding: '7px 10px', borderRadius: 7, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)' }}
          />
        </div>

        {/* List */}
        <div style={{ flex: 1, overflowY: 'auto' }}>
          {loadingList ? (
            <div style={{ padding: '24px 0', textAlign: 'center' }}>
              <span style={{ display: 'inline-block', width: 16, height: 16, border: '2px solid var(--accent)', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 0.7s linear infinite' }} />
            </div>
          ) : filtered.length === 0 ? (
            <div style={{ fontSize: 12, color: 'var(--text-faint)', textAlign: 'center', padding: '24px 12px' }}>
              {search ? 'No clients match' : 'No clients yet'}
            </div>
          ) : (
            Object.keys(grouped).sort().map(letter => (
              <div key={letter}>
                <div style={{ fontSize: 10, fontWeight: 800, color: 'var(--text-faint)', padding: '10px 14px 4px', textTransform: 'uppercase', letterSpacing: '.06em' }}>{letter}</div>
                {grouped[letter].map(c => {
                  const activeCount = (c.projects || []).filter(p => p.status === 'active').length;
                  return (
                    <button
                      key={c.id}
                      onClick={() => setSelected(c.id)}
                      style={{
                        width: '100%', textAlign: 'left', background: selected === c.id ? 'var(--accent)' : 'none',
                        border: 'none', padding: '8px 14px', cursor: 'pointer', borderRadius: 0,
                        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8,
                      }}
                    >
                      <span style={{ fontSize: 13, fontWeight: 600, color: selected === c.id ? '#fff' : 'var(--text)', truncate: true, overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>{c.name}</span>
                      {activeCount > 0 && (
                        <span style={{ fontSize: 10, fontWeight: 700, background: selected === c.id ? 'rgba(255,255,255,0.25)' : '#dcfce7', color: selected === c.id ? '#fff' : '#059669', borderRadius: 10, padding: '1px 6px', flexShrink: 0 }}>{activeCount}</span>
                      )}
                    </button>
                  );
                })}
              </div>
            ))
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
            {/* Client header */}
            <div style={{ padding: '20px 28px 0', flexShrink: 0, borderBottom: '1px solid var(--border)' }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, marginBottom: 16 }}>
                <div>
                  <h2 style={{ fontSize: 22, fontWeight: 800, margin: 0, color: 'var(--text)' }}>{detail.client.name}</h2>
                  <div style={{ display: 'flex', gap: 12, marginTop: 4, flexWrap: 'wrap' }}>
                    {detail.client.website && (
                      <a href={detail.client.website} target="_blank" rel="noreferrer" style={{ fontSize: 12, color: 'var(--accent)', textDecoration: 'none' }}>🌐 {detail.client.website.replace(/^https?:\/\//, '')}</a>
                    )}
                    {detail.client.linkedin_url && (
                      <a href={detail.client.linkedin_url} target="_blank" rel="noreferrer" style={{ fontSize: 12, color: '#0077b5', textDecoration: 'none' }}>in LinkedIn</a>
                    )}
                  </div>
                </div>
                <button
                  onClick={() => { setEditing(true); setTab('overview'); }}
                  style={{ fontSize: 11, fontWeight: 700, padding: '6px 12px', borderRadius: 7, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text-muted)', cursor: 'pointer', flexShrink: 0 }}
                >
                  ✏️ Edit
                </button>
              </div>

              {/* Tab bar */}
              <div style={{ display: 'flex', gap: 0 }}>
                {[
                  { id: 'overview',  label: 'Overview' },
                  { id: 'projects',  label: `Projects${detail.projects.length > 0 ? ` (${detail.projects.length})` : ''}` },
                  { id: 'history',   label: `History${historyItems.length > 0 ? ` (${historyItems.length})` : ''}` },
                  { id: 'research',  label: `Research${detail.items.length > 0 ? ` (${detail.items.length})` : ''}` },
                  { id: 'ai',        label: '✦ Ask AI' },
                ].map(t => (
                  <button
                    key={t.id}
                    onClick={() => setTab(t.id)}
                    style={{
                      fontSize: 13, fontWeight: 600, padding: '8px 16px', border: 'none',
                      background: 'none', cursor: 'pointer',
                      color: tab === t.id ? 'var(--accent)' : 'var(--text-muted)',
                      borderBottom: tab === t.id ? '2px solid var(--accent)' : '2px solid transparent',
                      marginBottom: -1,
                    }}
                  >{t.label}</button>
                ))}
              </div>
            </div>

            {/* Tab content */}
            <div style={{ flex: 1, overflowY: 'auto', padding: '24px 28px' }}>

              {/* ── Overview ── */}
              {tab === 'overview' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 24, maxWidth: 640 }}>
                  {editing ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 14, padding: '20px', background: 'var(--surface)', borderRadius: 12, border: '1px solid var(--border)' }}>
                      <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>Edit Client</div>
                      {[
                        { key: 'name',         label: 'Company Name', placeholder: 'Acme Corp' },
                        { key: 'website',      label: 'Website',      placeholder: 'https://acme.com' },
                        { key: 'linkedin_url', label: 'LinkedIn',     placeholder: 'https://linkedin.com/company/acme' },
                      ].map(f => (
                        <div key={f.key}>
                          <label style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '.04em', display: 'block', marginBottom: 4 }}>{f.label}</label>
                          <input
                            value={editDraft[f.key] || ''}
                            onChange={e => setEditDraft(d => ({ ...d, [f.key]: e.target.value }))}
                            placeholder={f.placeholder}
                            style={{ width: '100%', fontSize: 13, padding: '7px 10px' }}
                          />
                        </div>
                      ))}
                      <div>
                        <label style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '.04em', display: 'block', marginBottom: 4 }}>Notes</label>
                        <textarea
                          value={editDraft.notes || ''}
                          onChange={e => setEditDraft(d => ({ ...d, notes: e.target.value }))}
                          placeholder="Internal notes about this client…"
                          rows={4}
                          style={{ width: '100%', fontSize: 13, padding: '8px 10px', resize: 'vertical', fontFamily: 'inherit' }}
                        />
                      </div>
                      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                        <button onClick={() => setEditing(false)} style={{ fontSize: 12, padding: '7px 14px', borderRadius: 7, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)', cursor: 'pointer' }}>Cancel</button>
                        <button onClick={handleSaveClient} disabled={saving} style={{ fontSize: 12, fontWeight: 700, padding: '7px 18px', borderRadius: 7, border: 'none', background: 'var(--accent)', color: '#fff', cursor: 'pointer', opacity: saving ? 0.6 : 1 }}>{saving ? 'Saving…' : 'Save'}</button>
                      </div>
                    </div>
                  ) : (
                    <>
                      {detail.client.notes && (
                        <div style={{ padding: '14px 16px', background: 'var(--surface)', borderRadius: 10, border: '1px solid var(--border)' }}>
                          <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 6 }}>Notes</div>
                          <p style={{ fontSize: 13, color: 'var(--text)', margin: 0, lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>{detail.client.notes}</p>
                        </div>
                      )}
                    </>
                  )}

                  {/* Contacts */}
                  {allContacts.length > 0 && (
                    <div>
                      <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 10 }}>Contacts</div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                        {allContacts.map((c, i) => (
                          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', background: 'var(--surface)', borderRadius: 9, border: '1px solid var(--border)' }}>
                            <div style={{ width: 34, height: 34, borderRadius: '50%', background: 'var(--accent)', color: '#fff', fontSize: 13, fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                              {c.name[0].toUpperCase()}
                            </div>
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>{c.name}</div>
                              {c.title && <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{c.title}</div>}
                            </div>
                            {c.email && (
                              <a href={`mailto:${c.email}`} style={{ fontSize: 11, color: 'var(--accent)', textDecoration: 'none', flexShrink: 0 }}>{c.email}</a>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {!detail.client.notes && allContacts.length === 0 && !editing && (
                    <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--text-faint)' }}>
                      <div style={{ fontSize: 24, marginBottom: 8 }}>🏢</div>
                      <div style={{ fontSize: 13 }}>No details yet — click Edit to add a website, notes, or LinkedIn.</div>
                    </div>
                  )}
                </div>
              )}

              {/* ── Projects ── */}
              {tab === 'projects' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12, maxWidth: 680 }}>
                  {detail.projects.length === 0 ? (
                    <div style={{ fontSize: 13, color: 'var(--text-faint)', textAlign: 'center', padding: '40px 0' }}>No projects yet.</div>
                  ) : (
                    detail.projects.map(p => (
                      <div
                        key={p.id}
                        onClick={() => onNavigate?.('projects')}
                        style={{ padding: '14px 16px', background: 'var(--surface)', borderRadius: 10, border: '1px solid var(--border)', cursor: 'pointer', transition: 'border-color .15s' }}
                        onMouseEnter={e => e.currentTarget.style.borderColor = 'var(--accent)'}
                        onMouseLeave={e => e.currentTarget.style.borderColor = 'var(--border)'}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
                          <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)' }}>{p.name}</div>
                          <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 10, background: STATUS_COLOR[p.status] + '22', color: STATUS_COLOR[p.status] || '#9ca3af', flexShrink: 0 }}>
                            {p.status}
                          </span>
                        </div>
                        {p.description && <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '4px 0 0', lineHeight: 1.5 }}>{p.description}</p>}
                        <div style={{ fontSize: 11, color: 'var(--text-faint)', marginTop: 6 }}>
                          Started {fmtDate(p.start_date)}{p.end_date ? ` · Ends ${fmtDate(p.end_date)}` : ''}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              )}

              {/* ── History ── */}
              {tab === 'history' && (
                <div style={{ maxWidth: 680 }}>
                  {historyItems.length === 0 ? (
                    <div style={{ fontSize: 13, color: 'var(--text-faint)', textAlign: 'center', padding: '40px 0' }}>No activity or meetings logged yet.</div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 0, position: 'relative' }}>
                      {/* Timeline line */}
                      <div style={{ position: 'absolute', left: 19, top: 24, bottom: 0, width: 2, background: 'var(--border)' }} />
                      {historyItems.map((item, i) => (
                        <div key={item.id + i} style={{ display: 'flex', gap: 14, paddingBottom: 20, position: 'relative' }}>
                          {/* Icon dot */}
                          <div style={{ width: 40, height: 40, borderRadius: '50%', background: 'var(--surface)', border: '2px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16, flexShrink: 0, position: 'relative', zIndex: 1 }}>
                            {item.icon}
                          </div>
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
                  {/* Add item */}
                  {addingItem ? (
                    <div style={{ padding: '16px', background: 'var(--surface)', borderRadius: 10, border: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: 10 }}>
                      <div style={{ display: 'flex', gap: 8 }}>
                        {['note', 'link'].map(t => (
                          <button
                            key={t}
                            onClick={() => setItemDraft(d => ({ ...d, type: t }))}
                            style={{ fontSize: 12, fontWeight: 700, padding: '5px 12px', borderRadius: 7, border: `1px solid ${itemDraft.type === t ? 'var(--accent)' : 'var(--border)'}`, background: itemDraft.type === t ? 'var(--accent)' : 'var(--surface)', color: itemDraft.type === t ? '#fff' : 'var(--text-muted)', cursor: 'pointer' }}
                          >{t === 'note' ? '📝 Note' : '🔗 Link'}</button>
                        ))}
                      </div>
                      <input
                        value={itemDraft.title}
                        onChange={e => setItemDraft(d => ({ ...d, title: e.target.value }))}
                        placeholder={itemDraft.type === 'link' ? 'Title or description' : 'Title (optional)'}
                        style={{ fontSize: 13, padding: '7px 10px' }}
                      />
                      {itemDraft.type === 'link' && (
                        <input
                          value={itemDraft.url}
                          onChange={e => setItemDraft(d => ({ ...d, url: e.target.value }))}
                          placeholder="https://…"
                          style={{ fontSize: 13, padding: '7px 10px' }}
                        />
                      )}
                      <textarea
                        value={itemDraft.body}
                        onChange={e => setItemDraft(d => ({ ...d, body: e.target.value }))}
                        placeholder={itemDraft.type === 'note' ? 'Write your note…' : 'Notes about this link (optional)'}
                        rows={3}
                        style={{ fontSize: 13, padding: '8px 10px', resize: 'vertical', fontFamily: 'inherit' }}
                      />
                      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                        <button onClick={() => setAddingItem(false)} style={{ fontSize: 12, padding: '6px 12px', borderRadius: 7, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)', cursor: 'pointer' }}>Cancel</button>
                        <button onClick={handleAddItem} disabled={savingItem} style={{ fontSize: 12, fontWeight: 700, padding: '6px 16px', borderRadius: 7, border: 'none', background: 'var(--accent)', color: '#fff', cursor: 'pointer', opacity: savingItem ? 0.6 : 1 }}>{savingItem ? 'Saving…' : 'Save'}</button>
                      </div>
                    </div>
                  ) : (
                    <button
                      onClick={() => setAddingItem(true)}
                      style={{ alignSelf: 'flex-start', fontSize: 12, fontWeight: 700, padding: '8px 16px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text-muted)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}
                    >+ Add Note or Link</button>
                  )}

                  {/* Items list */}
                  {detail.items.length === 0 && !addingItem && (
                    <div style={{ fontSize: 13, color: 'var(--text-faint)', textAlign: 'center', padding: '32px 0' }}>
                      No research saved yet. Add notes, links, or articles about this client.
                    </div>
                  )}
                  {detail.items.map(item => (
                    <div key={item.id} style={{ padding: '14px 16px', background: 'var(--surface)', borderRadius: 10, border: '1px solid var(--border)', position: 'relative' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8, marginBottom: item.body ? 6 : 0 }}>
                        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                          <span style={{ fontSize: 13 }}>{item.type === 'note' ? '📝' : '🔗'}</span>
                          {item.url ? (
                            <a href={item.url} target="_blank" rel="noreferrer" style={{ fontSize: 13, fontWeight: 700, color: 'var(--accent)', textDecoration: 'none' }}>{item.title || item.url}</a>
                          ) : (
                            <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>{item.title}</span>
                          )}
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
                    Ask anything about <strong>{detail.client.name}</strong> — I can search across all meetings, activities, notes, and links.
                  </div>

                  {/* Messages */}
                  <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 14, paddingBottom: 16, minHeight: 120 }}>
                    {aiMessages.length === 0 && (
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                        {[
                          `What's the latest on ${detail.client.name}?`,
                          'Who are our main contacts?',
                          'What action items are outstanding?',
                          'Summarize our meeting history',
                        ].map(q => (
                          <button
                            key={q}
                            onClick={() => { setAiQ(q); }}
                            style={{ fontSize: 12, padding: '7px 12px', borderRadius: 20, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text-muted)', cursor: 'pointer' }}
                          >{q}</button>
                        ))}
                      </div>
                    )}
                    {aiMessages.map((m, i) => (
                      <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: 2, alignItems: m.role === 'user' ? 'flex-end' : 'flex-start' }}>
                        <div style={{
                          maxWidth: '85%', padding: '10px 14px', borderRadius: m.role === 'user' ? '12px 12px 4px 12px' : '12px 12px 12px 4px',
                          background: m.role === 'user' ? 'var(--accent)' : 'var(--surface)',
                          color: m.role === 'user' ? '#fff' : 'var(--text)',
                          border: m.role === 'ai' ? '1px solid var(--border)' : 'none',
                          fontSize: 13, lineHeight: 1.6, whiteSpace: 'pre-wrap',
                        }}>{m.text}</div>
                      </div>
                    ))}
                    {aiLoading && (
                      <div style={{ display: 'flex', gap: 6, alignItems: 'center', color: 'var(--text-faint)', fontSize: 12 }}>
                        <span style={{ display: 'inline-block', width: 12, height: 12, border: '2px solid var(--accent)', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 0.7s linear infinite' }} />
                        Thinking…
                      </div>
                    )}
                    <div ref={aiEndRef} />
                  </div>

                  {/* Input */}
                  <div style={{ display: 'flex', gap: 8, paddingTop: 12, borderTop: '1px solid var(--border-light)', flexShrink: 0 }}>
                    <input
                      value={aiQ}
                      onChange={e => setAiQ(e.target.value)}
                      onKeyDown={e => e.key === 'Enter' && !e.shiftKey && handleAsk()}
                      placeholder={`Ask about ${detail.client.name}…`}
                      style={{ flex: 1, fontSize: 13, padding: '9px 12px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)' }}
                    />
                    <button
                      onClick={handleAsk}
                      disabled={!aiQ.trim() || aiLoading}
                      style={{ fontSize: 13, fontWeight: 700, padding: '9px 18px', borderRadius: 8, border: 'none', background: 'var(--accent)', color: '#fff', cursor: !aiQ.trim() || aiLoading ? 'default' : 'pointer', opacity: !aiQ.trim() || aiLoading ? 0.5 : 1 }}
                    >Ask →</button>
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
