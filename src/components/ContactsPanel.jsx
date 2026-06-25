import { useState } from 'react';
import { upsertClientContacts, deleteClientContact, updateClientContact, setPrimaryClientContact, enrichClientContact, upsertCompanyContacts, deleteCompanyContactFromContacts, updateCompanyContactInContacts, setPrimaryCompanyContact, enrichCompanyContact } from '../lib/clients';
import ContactDossier from './ContactDossier';

const SOURCE_COLORS = { thesis: '#8b5cf6', scan: '#3b82f6', manual: '#10b981' };
const srcColorFor = s => SOURCE_COLORS[s] || '#94a3b8';

const BLANK_DRAFT = { name: '', title: '', email: '', linkedin: '' };

export default function ContactsPanel({ clientId, companyId, companyName, contacts = [], discovered = [], onContactsChange }) {
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

  const [addingContact,        setAddingContact]        = useState(false);
  const [contactDraft,         setContactDraft]         = useState(BLANK_DRAFT);
  const [editingContact,       setEditingContact]       = useState(null);
  const [editDraft,            setEditDraft]            = useState(BLANK_DRAFT);
  const [enrichingContact,     setEnrichingContact]     = useState(null);
  const [overlayContact,       setOverlayContact]       = useState(null); // contact shown in 3/4 overlay
  const [confirmDeleteContact, setConfirmDeleteContact] = useState(null);
  const [deletingContact,      setDeletingContact]      = useState(null);
  const [settingPrimary,       setSettingPrimary]       = useState(null);
  const [promoting,            setPromoting]            = useState(null);

  const handleAddContact = async () => {
    if (!contactDraft.name.trim() || !recordId) return;
    const newContact = { ...contactDraft, id: crypto.randomUUID(), source: 'manual', created_at: new Date().toISOString() };
    const updated = await fn.upsert(recordId, [newContact]);
    onContactsChange(updated);
    setContactDraft(BLANK_DRAFT);
    setAddingContact(false);
  };

  const startEdit = (c) => {
    setEditingContact(c.name);
    setEditDraft({ name: c.name || '', title: c.title || '', email: c.email || '', linkedin: c.linkedin || '' });
  };

  const handleSaveEdit = async () => {
    if (!editingContact || !editDraft.name.trim() || !recordId) return;
    const updated = await fn.update(recordId, editingContact, editDraft);
    onContactsChange(updated);
    // Sync overlayContact if it was open
    if (overlayContact?.name === editingContact) {
      const refreshed = updated.find(c => c.name === editDraft.name.trim()) || null;
      setOverlayContact(refreshed);
    }
    setEditingContact(null);
  };

  const handleSetPrimary = async (c) => {
    if (!recordId || settingPrimary) return;
    setSettingPrimary(c.name);
    try {
      const updated = await fn.setPrimary(recordId, c.name);
      onContactsChange(updated);
      if (overlayContact?.name === c.name) setOverlayContact(updated.find(x => x.name === c.name) || overlayContact);
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
      if (overlayContact?.name === c.name) setOverlayContact(null);
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
      // Sync enriched data into the overlay so it renders without close/reopen
      const enriched = updated.find(x => x.name === c.name) || c;
      setOverlayContact(enriched);
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

  // When contacts prop updates (e.g. after enrich), keep overlayContact in sync
  const overlayLive = overlayContact
    ? (contacts.find(c => c.name === overlayContact.name) || overlayContact)
    : null;

  const isEnrichedContact = (c) => !!(c.enriched_at || c.job_history?.length || c.education?.length || c.posts?.length);
  const isEnrichingOverlay = overlayLive && enrichingContact === overlayLive.name;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

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

      {/* Contact cards — clickable tiles */}
      {(() => {
        const sorted = [...contacts].sort((a, b) => {
          if (a.is_primary && !b.is_primary) return -1;
          if (!a.is_primary && b.is_primary) return 1;
          return (a.name || '').localeCompare(b.name || '');
        });
        const firstPrimaryIdx = sorted.findIndex(c => c.is_primary);
        return sorted.map((c, i) => {
        const isEditing  = editingContact === c.name;
        const isEnriched = isEnrichedContact(c);
        const initials   = (c.name || '?').split(' ').map(w => w[0]).filter(Boolean).slice(0, 2).join('').toUpperCase() || '?';
        const srcColor   = srcColorFor(c.source);
        const showPrimaryBadge = i === firstPrimaryIdx;

        return (
          <div
            key={c.id || c.name + i}
            onClick={() => !isEditing && setOverlayContact(c)}
            style={{
              background: 'var(--surface)', borderRadius: 11,
              border: `1px solid ${isEditing ? 'var(--accent)' : 'var(--border)'}`,
              overflow: 'hidden', transition: 'border-color .15s, box-shadow .15s',
              cursor: isEditing ? 'default' : 'pointer',
              position: 'relative',
            }}
            onMouseEnter={e => { if (!isEditing) { e.currentTarget.style.borderColor = 'var(--accent)'; e.currentTarget.style.boxShadow = '0 2px 8px rgba(0,0,0,0.08)'; } }}
            onMouseLeave={e => { e.currentTarget.style.borderColor = isEditing ? 'var(--accent)' : 'var(--border)'; e.currentTarget.style.boxShadow = 'none'; }}
          >
            {isEditing ? (
              <div style={{ padding: '14px 16px' }} onClick={e => e.stopPropagation()}>
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
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, padding: '12px 16px' }}>
                <div style={{ width: 40, height: 40, borderRadius: '50%', background: 'linear-gradient(135deg, var(--accent), #6366f1)', color: '#fff', fontSize: 14, fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>{initials}</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)' }}>{c.name}</span>
                    {showPrimaryBadge && <span style={{ fontSize: 9, fontWeight: 800, padding: '2px 6px', borderRadius: 8, background: '#fef9c3', color: '#a16207', border: '1px solid #fde68a' }}>PRIMARY</span>}
                    {!showPrimaryBadge && (
                      <button
                        onClick={e => { e.stopPropagation(); handleSetPrimary(c); }}
                        disabled={settingPrimary === c.name}
                        style={{ fontSize: 9, fontWeight: 700, padding: '2px 7px', borderRadius: 8, border: '1px solid var(--border)', background: 'none', color: 'var(--text-faint)', cursor: 'pointer', whiteSpace: 'nowrap' }}
                      >{settingPrimary === c.name ? '…' : 'Set as Primary'}</button>
                    )}
                    {c.source && <span style={{ fontSize: 9, fontWeight: 700, padding: '2px 6px', borderRadius: 8, background: srcColor + '18', color: srcColor }}>{c.source}</span>}
                    {isEnriched && <span style={{ fontSize: 9, fontWeight: 700, color: '#10b981' }}>✓ enriched</span>}
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 1 }}>
                    {[c.title, c.location].filter(Boolean).join(' · ')}
                  </div>
                  <div style={{ display: 'flex', gap: 10, marginTop: 4, flexWrap: 'wrap' }}>
                    {c.email    && <a href={`mailto:${c.email}`} onClick={e => e.stopPropagation()} style={{ fontSize: 11, color: 'var(--accent)', textDecoration: 'none' }}>{c.email}</a>}
                    {c.linkedin && <a href={c.linkedin} target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()} style={{ fontSize: 11, color: '#0077b5', textDecoration: 'none', fontWeight: 600 }}>in LinkedIn</a>}
                    {c.twitter  && <a href={c.twitter}  target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()} style={{ fontSize: 11, color: '#1da1f2', textDecoration: 'none', fontWeight: 600 }}>𝕏 Twitter</a>}
                  </div>
                  {isEnriched && c.bio_summary && (
                    <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '6px 0 0', lineHeight: 1.5, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                      {c.bio_summary}
                    </p>
                  )}
                </div>
              </div>
            )}
          </div>
        );
      });
      })()}

      {/* Discovered from research */}
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

      {/* ── Dossier overlay ── */}
      {overlayLive && (
        <>
          {/* Backdrop */}
          <div
            onClick={() => { setOverlayContact(null); setConfirmDeleteContact(null); }}
            style={{ position: 'fixed', inset: 0, zIndex: 1200, background: 'rgba(0,0,0,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}
          >
          {/* Panel */}
          <div onClick={e => e.stopPropagation()} style={{
            background: 'var(--bg)', border: '1px solid var(--border)',
            borderRadius: 14, width: '100%', maxWidth: 860, maxHeight: '90vh',
            display: 'flex', flexDirection: 'column',
            boxShadow: '0 20px 60px rgba(0,0,0,0.35)',
          }}>
            {/* Overlay header */}
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', padding: '20px 24px 16px', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 18, fontWeight: 800, color: 'var(--text)' }}>{overlayLive.name}</span>
                  {overlayLive.is_primary && <span style={{ fontSize: 9, fontWeight: 800, padding: '2px 7px', borderRadius: 8, background: '#fef9c3', color: '#a16207', border: '1px solid #fde68a' }}>PRIMARY</span>}
                  {overlayLive.source && <span style={{ fontSize: 9, fontWeight: 700, padding: '2px 7px', borderRadius: 8, background: srcColorFor(overlayLive.source) + '18', color: srcColorFor(overlayLive.source) }}>{overlayLive.source}</span>}
                </div>
                <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 3 }}>
                  {[overlayLive.title, overlayLive.location].filter(Boolean).join(' · ')}
                </div>
                <div style={{ display: 'flex', gap: 12, marginTop: 6, flexWrap: 'wrap' }}>
                  {overlayLive.email    && <a href={`mailto:${overlayLive.email}`}       style={{ fontSize: 12, color: 'var(--accent)', textDecoration: 'none' }}>{overlayLive.email}</a>}
                  {overlayLive.linkedin && <a href={overlayLive.linkedin} target="_blank" rel="noreferrer" style={{ fontSize: 12, color: '#0077b5', textDecoration: 'none', fontWeight: 600 }}>in LinkedIn</a>}
                  {overlayLive.twitter  && <a href={overlayLive.twitter}  target="_blank" rel="noreferrer" style={{ fontSize: 12, color: '#1da1f2', textDecoration: 'none', fontWeight: 600 }}>𝕏 Twitter</a>}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexShrink: 0, marginLeft: 16 }}>
                {/* Set as Primary */}
                {!overlayLive.is_primary && (
                  <button
                    onClick={() => handleSetPrimary(overlayLive)}
                    disabled={!!settingPrimary}
                    style={{ fontSize: 11, fontWeight: 700, padding: '5px 12px', borderRadius: 7, border: '1px solid #bbf7d0', background: '#f0fdf4', color: '#166534', cursor: settingPrimary ? 'not-allowed' : 'pointer', whiteSpace: 'nowrap' }}
                  >{settingPrimary === overlayLive.name ? '…' : 'Set as Primary'}</button>
                )}
                {/* Build / Refresh Dossier */}
                <button
                  onClick={() => handleEnrichContact(overlayLive)}
                  disabled={!!enrichingContact}
                  style={{ fontSize: 11, fontWeight: 700, padding: '5px 14px', borderRadius: 7, border: '1px solid var(--accent)', background: isEnrichingOverlay ? 'var(--surface)' : isEnrichedContact(overlayLive) ? 'none' : 'var(--accent)', color: isEnrichingOverlay ? 'var(--text-muted)' : isEnrichedContact(overlayLive) ? 'var(--accent)' : '#fff', cursor: enrichingContact ? 'default' : 'pointer', display: 'flex', alignItems: 'center', gap: 5, whiteSpace: 'nowrap' }}
                >
                  {isEnrichingOverlay
                    ? <><span style={{ display: 'inline-block', width: 9, height: 9, border: '1.5px solid var(--accent)', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 0.7s linear infinite' }} /> Building…</>
                    : isEnrichedContact(overlayLive) ? 'ↂ Refresh Dossier' : 'ↂ Build Dossier'}
                </button>
                {/* Edit */}
                <button onClick={() => { setOverlayContact(null); startEdit(overlayLive); }} style={{ fontSize: 11, padding: '5px 10px', borderRadius: 7, border: '1px solid var(--border)', background: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}>✏️ Edit</button>
                {/* Close */}
                <button onClick={() => { setOverlayContact(null); setConfirmDeleteContact(null); }} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 20, color: 'var(--text-faint)', padding: '2px 4px', lineHeight: 1 }}>✕</button>
              </div>
            </div>

            {/* Overlay body */}
            <div style={{ flex: 1, overflowY: 'auto', padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 20 }}>

              {(overlayLive.angle || overlayLive.hook) && (
                <div style={{ padding: '12px 16px', background: '#fefce8', borderRadius: 10, border: '1px solid #fef08a' }}>
                  {overlayLive.angle && <div style={{ fontSize: 13, color: '#78350f', fontWeight: 600, marginBottom: overlayLive.hook ? 4 : 0 }}>{overlayLive.angle}</div>}
                  {overlayLive.hook  && <div style={{ fontSize: 12, color: '#92400e', fontStyle: 'italic' }}>"{overlayLive.hook}"</div>}
                </div>
              )}

              {isEnrichedContact(overlayLive)
                ? <ContactDossier contact={overlayLive} />
                : (
                  <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--text-faint)' }}>
                    <div style={{ fontSize: 28, marginBottom: 10 }}>📋</div>
                    <div style={{ fontSize: 13 }}>No dossier yet — click <strong>Build Dossier</strong> above to run a deep search on this person.</div>
                  </div>
                )}

              {/* Delete */}
              <div style={{ borderTop: '1px solid var(--border)', paddingTop: 16, marginTop: 8 }}>
                {confirmDeleteContact === overlayLive.name ? (
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Delete {overlayLive.name}?</span>
                    <button onClick={() => handleDeleteContact(overlayLive)} disabled={deletingContact === overlayLive.name} style={{ fontSize: 11, fontWeight: 700, padding: '4px 12px', borderRadius: 6, border: 'none', background: '#ef4444', color: '#fff', cursor: 'pointer' }}>{deletingContact === overlayLive.name ? '…' : 'Yes, delete'}</button>
                    <button onClick={() => setConfirmDeleteContact(null)} style={{ fontSize: 11, padding: '4px 10px', borderRadius: 6, border: '1px solid var(--border)', background: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}>Cancel</button>
                  </div>
                ) : (
                  <button onClick={() => setConfirmDeleteContact(overlayLive.name)} style={{ fontSize: 11, padding: '4px 10px', borderRadius: 6, border: '1px solid #fca5a5', background: 'none', cursor: 'pointer', color: '#dc2626' }}>Delete contact</button>
                )}
              </div>
            </div>
          </div>
          </div>
        </>
      )}
    </div>
  );
}
