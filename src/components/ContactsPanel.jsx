import { useState } from 'react';
import { upsertClientContacts, deleteClientContact, updateClientContact, setPrimaryClientContact, enrichClientContact, upsertCompanyContacts, deleteCompanyContactFromContacts, updateCompanyContactInContacts, setPrimaryCompanyContact, enrichCompanyContact } from '../lib/clients';
import ContactDossier from './ContactDossier';

const SOURCE_COLORS = { thesis: '#8b5cf6', scan: '#3b82f6', manual: '#10b981' };
const srcColorFor = s => SOURCE_COLORS[s] || '#94a3b8';

function fmtDate(d) {
  if (!d) return '';
  return new Date(d + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

const BLANK_DRAFT = { name: '', title: '', email: '', linkedin: '' };

export default function ContactsPanel({ clientId, companyId, companyName, contacts = [], discovered = [], onContactsChange }) {
  // Derive the right record ID and CRUD functions depending on whether we're
  // backed by the clients table (clientId) or companies table (companyId).
  const recordId = clientId || companyId;
  const fn = clientId ? {
    upsert:     (id, cs) => upsertClientContacts(id, cs),
    delete:     (id, name) => deleteClientContact(id, name),
    update:     (id, orig, patch) => updateClientContact(id, orig, patch),
    setPrimary: (id, name) => setPrimaryClientContact(id, name),
    enrich:     (id, c, co) => enrichClientContact(id, c, co),
  } : {
    upsert:     (id, cs) => upsertCompanyContacts(id, cs),
    delete:     (id, name) => deleteCompanyContactFromContacts(id, name),
    update:     (id, orig, patch) => updateCompanyContactInContacts(id, orig, patch),
    setPrimary: (id, name) => setPrimaryCompanyContact(id, name),
    enrich:     (id, c, co) => enrichCompanyContact(id, c, co),
  };
  const [addingContact, setAddingContact]   = useState(false);
  const [contactDraft, setContactDraft]     = useState(BLANK_DRAFT);
  const [editingContact, setEditingContact] = useState(null); // original name of contact being edited
  const [editDraft, setEditDraft]           = useState(BLANK_DRAFT);
  const [enrichingContact, setEnrichingContact] = useState(null);
  const [expandedContact, setExpandedContact]   = useState(null);
  const [confirmDeleteContact, setConfirmDeleteContact] = useState(null);
  const [deletingContact, setDeletingContact]   = useState(null);
  const [hoveredContactCard, setHoveredContactCard] = useState(null);
  const [settingPrimary, setSettingPrimary] = useState(null);
  const [promoting, setPromoting] = useState(null);

  const handleAddContact = async () => {
    if (!contactDraft.name.trim() || !recordId) return;
    const newContact = { ...contactDraft, id: crypto.randomUUID(), source: 'manual', created_at: new Date().toISOString() };
    const updated = await fn.upsert(recordId, [newContact]);
    onContactsChange(updated);
    setContactDraft(BLANK_DRAFT);
    setAddingContact(false);
    setExpandedContact(newContact.name);
  };

  const startEdit = (c) => {
    setEditingContact(c.name);
    setEditDraft({ name: c.name || '', title: c.title || '', email: c.email || '', linkedin: c.linkedin || '' });
  };

  const handleSaveEdit = async () => {
    if (!editingContact || !editDraft.name.trim() || !recordId) return;
    const updated = await fn.update(recordId, editingContact, editDraft);
    onContactsChange(updated);
    setEditingContact(null);
  };

  const handleSetPrimary = async (c) => {
    if (!recordId || settingPrimary) return;
    setSettingPrimary(c.name);
    try {
      const updated = await fn.setPrimary(recordId, c.name);
      onContactsChange(updated);
    } finally {
      setSettingPrimary(null);
    }
  };

  const handleDeleteContact = async (c) => {
    if (!recordId || deletingContact) return;
    setDeletingContact(c.name);
    try {
      const updated = await fn.delete(recordId, c.name);
      onContactsChange(updated);
      setConfirmDeleteContact(null);
      if (expandedContact === c.name) setExpandedContact(null);
    } catch (e) {
      alert('Error deleting contact: ' + e.message);
    } finally {
      setDeletingContact(null);
    }
  };

  const handleEnrichContact = async (c) => {
    if (!recordId || enrichingContact) return;
    setEnrichingContact(c.name);
    try {
      const updated = await fn.enrich(recordId, c, companyName || '');
      onContactsChange(updated);
      setExpandedContact(c.name);
    } catch (e) {
      console.error('Enrich failed:', e);
    } finally {
      setEnrichingContact(null);
    }
  };

  const handlePromote = async (c) => {
    if (!recordId || promoting) return;
    setPromoting(c.name);
    try {
      const isFirst = contacts.length === 0;
      const updated = await fn.upsert(recordId, [{ ...c, is_primary: isFirst }]);
      onContactsChange(updated);
    } catch (e) {
      alert('Could not add contact: ' + e.message);
    } finally {
      setPromoting(null);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 700 }}>

      {/* Header row */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '.04em' }}>
          {contacts.length} Contact{contacts.length !== 1 ? 's' : ''}
        </div>
        <button onClick={() => setAddingContact(true)} style={{ fontSize: 11, fontWeight: 700, padding: '5px 12px', borderRadius: 7, border: '1px solid var(--accent)', background: 'var(--accent)', color: '#fff', cursor: 'pointer' }}>+ Add Contact</button>
      </div>

      {/* Add contact form */}
      {addingContact && (
        <div style={{ padding: '14px 16px', background: 'var(--surface)', borderRadius: 10, border: '1px solid var(--accent)', display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)' }}>New Contact</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            {[['name','Name *'],['title','Title'],['email','Email'],['linkedin','LinkedIn URL']].map(([k, lbl]) => (
              <input key={k} value={contactDraft[k]} onChange={e => setContactDraft(d => ({ ...d, [k]: e.target.value }))} placeholder={lbl} style={{ fontSize: 12, padding: '6px 10px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)' }} />
            ))}
          </div>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button onClick={() => { setAddingContact(false); setContactDraft(BLANK_DRAFT); }} style={{ fontSize: 12, padding: '5px 12px', borderRadius: 7, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)', cursor: 'pointer' }}>Cancel</button>
            <button onClick={handleAddContact} disabled={!contactDraft.name.trim()} style={{ fontSize: 12, fontWeight: 700, padding: '5px 16px', borderRadius: 7, border: 'none', background: 'var(--accent)', color: '#fff', cursor: 'pointer', opacity: contactDraft.name.trim() ? 1 : 0.5 }}>Save</button>
          </div>
        </div>
      )}

      {contacts.length === 0 && !addingContact && (
        <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--text-faint)' }}>
          <div style={{ fontSize: 24, marginBottom: 8 }}>👤</div>
          <div style={{ fontSize: 13 }}>No contacts yet. Add one manually, or add one from "Discovered" below if research has found any.</div>
        </div>
      )}

      {/* Contact cards */}
      {contacts.map((c, i) => {
        const isExpanded = expandedContact === c.name;
        const isEditing = editingContact === c.name;
        const isEnriching = enrichingContact === c.name;
        const isEnriched = !!(c.enriched_at || c.job_history?.length || c.education?.length || c.posts?.length);
        const initials = c.name.split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase();
        const srcColor = srcColorFor(c.source);

        return (
          <div
            key={c.id || c.name + i}
            onMouseEnter={() => setHoveredContactCard(c.name)}
            onMouseLeave={() => setHoveredContactCard(null)}
            style={{ background: 'var(--surface)', borderRadius: 11, border: `1px solid ${isExpanded || isEditing ? 'var(--accent)' : 'var(--border)'}`, overflow: 'hidden', transition: 'border-color .2s', position: 'relative' }}
          >
            {isEditing ? (
              /* ── Inline edit form ── */
              <div style={{ padding: '14px 16px' }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 10 }}>
                  {[['name','Name *'],['title','Title'],['email','Email'],['linkedin','LinkedIn URL']].map(([k, lbl]) => (
                    <input key={k} autoFocus={k === 'name'} value={editDraft[k]} onChange={e => setEditDraft(d => ({ ...d, [k]: e.target.value }))} placeholder={lbl} style={{ fontSize: 12, padding: '6px 10px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)' }} />
                  ))}
                </div>
                <div style={{ display: 'flex', gap: 8, justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    {confirmDeleteContact === c.name ? (
                      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                        <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>Delete {c.name}?</span>
                        <button onClick={() => handleDeleteContact(c)} disabled={deletingContact === c.name} style={{ fontSize: 11, fontWeight: 700, padding: '4px 10px', borderRadius: 6, border: 'none', background: '#ef4444', color: '#fff', cursor: 'pointer' }}>{deletingContact === c.name ? '…' : 'Yes, delete'}</button>
                        <button onClick={() => setConfirmDeleteContact(null)} style={{ fontSize: 11, padding: '4px 10px', borderRadius: 6, border: '1px solid var(--border)', background: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}>Cancel</button>
                      </div>
                    ) : (
                      <button onClick={() => setConfirmDeleteContact(c.name)} style={{ fontSize: 11, padding: '4px 10px', borderRadius: 6, border: '1px solid #fca5a5', background: 'none', cursor: 'pointer', color: '#dc2626' }}>Delete contact</button>
                    )}
                  </div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button onClick={() => setEditingContact(null)} style={{ fontSize: 11, padding: '4px 12px', borderRadius: 6, border: '1px solid var(--border)', background: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}>Cancel</button>
                    <button onClick={handleSaveEdit} disabled={!editDraft.name.trim()} style={{ fontSize: 11, fontWeight: 700, padding: '4px 14px', borderRadius: 6, border: 'none', background: 'var(--accent)', color: '#fff', cursor: 'pointer' }}>Save</button>
                  </div>
                </div>
              </div>
            ) : (
              <>
                {/* Card header */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px' }}>
                  <div style={{ width: 40, height: 40, borderRadius: '50%', background: 'linear-gradient(135deg, var(--accent), #6366f1)', color: '#fff', fontSize: 14, fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>{initials}</div>
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
                  <div style={{ display: 'flex', gap: 6, flexShrink: 0, alignItems: 'center' }}>
                    {!c.is_primary && (
                      <button
                        onClick={() => handleSetPrimary(c)}
                        disabled={settingPrimary === c.name}
                        style={{ fontSize: 10, fontWeight: 700, padding: '4px 10px', borderRadius: 6, border: '1px solid #bbf7d0', background: '#f0fdf4', color: '#166534', cursor: settingPrimary === c.name ? 'not-allowed' : 'pointer', whiteSpace: 'nowrap' }}
                      >
                        {settingPrimary === c.name ? '…' : 'Set as Primary'}
                      </button>
                    )}
                    <button
                      onClick={() => {
                        if (isExpanded) {
                          setExpandedContact(null);
                        } else {
                          if (!enrichingContact) handleEnrichContact(c);
                          setExpandedContact(c.name);
                        }
                      }}
                      disabled={!!enrichingContact && !isExpanded}
                      style={{ fontSize: 10, fontWeight: 700, padding: '4px 10px', borderRadius: 6, border: '1px solid var(--accent)', background: isEnriching ? 'var(--surface-2)' : 'var(--accent)', color: isEnriching ? 'var(--accent)' : '#fff', cursor: (enrichingContact && !isExpanded) ? 'default' : 'pointer', display: 'flex', alignItems: 'center', gap: 4, whiteSpace: 'nowrap' }}
                    >
                      {isEnriching
                        ? <><span style={{ display: 'inline-block', width: 8, height: 8, border: '1.5px solid var(--accent)', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 0.7s linear infinite' }} /> Building…</>
                        : isExpanded
                          ? '▲ Less'
                          : isEnriched ? 'ↂ Refresh Dossier' : 'ↂ Build Dossier'}
                    </button>
                    <button onClick={() => startEdit(c)} title="Edit contact" style={{ background: 'none', border: '1px solid var(--border)', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 12, padding: '4px 7px', borderRadius: 6 }}>✏️</button>
                  </div>
                </div>

                {/* Expanded dossier */}
                {isExpanded && (
                  <div style={{ borderTop: '1px solid var(--border)', padding: '16px', display: 'flex', flexDirection: 'column', gap: 16 }}>

                    {(c.angle || c.hook) && (
                      <div style={{ padding: '10px 14px', background: '#fefce8', borderRadius: 8, border: '1px solid #fef08a' }}>
                        {c.angle && <div style={{ fontSize: 12, color: '#78350f', fontWeight: 600, marginBottom: c.hook ? 4 : 0 }}>{c.angle}</div>}
                        {c.hook  && <div style={{ fontSize: 12, color: '#92400e', fontStyle: 'italic' }}>"{c.hook}"</div>}
                      </div>
                    )}

                    <ContactDossier contact={c} />

                    <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                      {confirmDeleteContact === c.name ? (
                        <div onClick={e => e.stopPropagation()} style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                          <span style={{ fontSize: 11, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>Delete this contact?</span>
                          <button
                            onClick={() => handleDeleteContact(c)}
                            disabled={deletingContact === c.name}
                            style={{ fontSize: 10, fontWeight: 700, padding: '3px 10px', borderRadius: 20, border: 'none', background: '#ef4444', color: '#fff', cursor: deletingContact === c.name ? 'not-allowed' : 'pointer', whiteSpace: 'nowrap' }}
                          >
                            {deletingContact === c.name ? 'Deleting…' : 'Yes'}
                          </button>
                          <button
                            onClick={() => setConfirmDeleteContact(null)}
                            style={{ fontSize: 10, fontWeight: 600, padding: '3px 10px', borderRadius: 20, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text-muted)', cursor: 'pointer' }}
                          >
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => setConfirmDeleteContact(c.name)}
                          style={{ opacity: hoveredContactCard === c.name ? 1 : 0, transition: 'opacity .15s', fontSize: 10, fontWeight: 600, padding: '3px 10px', borderRadius: 20, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text-muted)', cursor: 'pointer', whiteSpace: 'nowrap' }}
                        >
                          Delete contact
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        );
      })}

      {/* Discovered from research — not yet promoted into the canonical contact list */}
      {discovered.length > 0 && (
        <div style={{ marginTop: 8 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 10 }}>
            Discovered from research ({discovered.length})
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {discovered.map((c, i) => (
              <div key={i} style={{ padding: '12px 14px', background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 8, display: 'flex', alignItems: 'flex-start', gap: 12 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>{c.name}</div>
                  {c.title && <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 1 }}>{c.title}</div>}
                  {c.email && <div style={{ fontSize: 11, color: 'var(--text-faint)', marginTop: 2 }}>{c.email}</div>}
                  {c.linkedin && <a href={c.linkedin} target="_blank" rel="noreferrer" style={{ fontSize: 11, color: 'var(--accent)', marginTop: 2, display: 'inline-block' }}>LinkedIn ↗</a>}
                </div>
                <button
                  onClick={() => handlePromote(c)}
                  disabled={promoting === c.name}
                  style={{ fontSize: 10, fontWeight: 700, padding: '3px 10px', borderRadius: 20, border: '1px solid var(--accent)', background: 'var(--accent)', color: '#fff', cursor: promoting === c.name ? 'not-allowed' : 'pointer', whiteSpace: 'nowrap', flexShrink: 0 }}
                >
                  {promoting === c.name ? '…' : '+ Add'}
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
