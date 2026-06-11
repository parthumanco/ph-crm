import { useState, useEffect } from 'react';
import {
  fetchDocuments, upsertDocument, DOC_TYPES, DOC_STATUSES,
  defaultSections, docType, docStatus,
  fetchAllCompaniesForPicker, fetchContactsForCompany, gatherCompanyContext,
} from '../lib/documents';
import { generateDocumentSections } from '../lib/anthropic';
import DocumentEditor from '../components/DocumentEditor';

const fmtDate = d => d
  ? new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  : '—';

const TYPE_DESCRIPTIONS = {
  proposal: 'Full project pitch',
  goo:      'Goals & intake summary',
  sow:      'Scope, deliverables & cost',
  msa:      'Master services agreement',
  mnda:     'Mutual NDA',
};

export default function DocumentsPage({ refreshKey = 0 }) {
  // Company + contact pickers
  const [companies,    setCompanies]    = useState([]);
  const [companyName,  setCompanyName]  = useState('');
  const [contacts,     setContacts]     = useState([]);
  const [contactName,  setContactName]  = useState('');
  const [loadingCo,    setLoadingCo]    = useState(true);
  const [loadingContacts, setLoadingContacts] = useState(false);

  // Doc type selection
  const [selectedType, setSelectedType] = useState('');

  // Generation state
  const [generating,   setGenerating]   = useState(false);
  const [genStatus,    setGenStatus]    = useState(''); // 'gathering' | 'writing'
  const [genError,     setGenError]     = useState(null);

  // Editor
  const [editorDoc,    setEditorDoc]    = useState(null);
  const [editorContext,setEditorContext]= useState(null);

  // Saved docs list
  const [docs,         setDocs]         = useState([]);
  const [loadingDocs,  setLoadingDocs]  = useState(true);
  const [filterType,   setFilterType]   = useState('all');
  const [search,       setSearch]       = useState('');

  // ── Load companies on mount ───────────────────────────────────────────────
  useEffect(() => {
    fetchAllCompaniesForPicker()
      .then(setCompanies)
      .catch(e => console.warn('companies picker:', e.message))
      .finally(() => setLoadingCo(false));
  }, []);

  // ── Load contacts when company changes ────────────────────────────────────
  useEffect(() => {
    setContacts([]);
    setContactName('');
    if (!companyName) return;
    setLoadingContacts(true);
    fetchContactsForCompany(companyName)
      .then(setContacts)
      .catch(() => setContacts([]))
      .finally(() => setLoadingContacts(false));
  }, [companyName]);

  // ── Load saved docs ───────────────────────────────────────────────────────
  useEffect(() => { loadDocs(); }, [refreshKey]);

  async function loadDocs() {
    setLoadingDocs(true);
    try { setDocs(await fetchDocuments()); }
    catch (e) { console.error('fetchDocuments:', e.message); }
    finally { setLoadingDocs(false); }
  }

  // ── Generate document ─────────────────────────────────────────────────────
  const canGenerate = companyName && selectedType && !generating;

  async function handleGenerate() {
    if (!canGenerate) return;
    setGenerating(true);
    setGenError(null);

    const dt = DOC_TYPES.find(t => t.id === selectedType);
    const canAI = ['proposal', 'goo', 'sow'].includes(selectedType);

    // Step 1: gather context
    setGenStatus('gathering');
    let context = '';
    try {
      context = await gatherCompanyContext(companyName, contactName || null);
      setEditorContext(context);
    } catch (e) {
      context = `Company: ${companyName}${contactName ? `\nContact: ${contactName}` : ''}`;
    }

    // Step 2: AI generation (proposal / GOO / SOW only)
    if (canAI) {
      setGenStatus('writing');
      try {
        const aiSections = await generateDocumentSections(selectedType, context);
        const title = `${companyName}${contactName ? ` — ${contactName}` : ''} — ${dt?.label}`;
        setEditorDoc({
          type: selectedType,
          title,
          status: 'draft',
          company_name: companyName,
          sections: { ...defaultSections(selectedType), ...aiSections },
        });
      } catch (e) {
        setGenError(`AI generation failed: ${e.message}. Document opened with empty sections.`);
        setEditorDoc({
          type: selectedType,
          title: `${companyName} — ${dt?.label}`,
          status: 'draft',
          company_name: companyName,
          sections: defaultSections(selectedType),
        });
      }
    } else {
      // Legal templates — pre-fill company/contact name and open
      const sections = defaultSections(selectedType);
      if (selectedType === 'msa')  { sections.client_name = companyName; sections.effective_date = new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }); }
      if (selectedType === 'mnda') { sections.counterparty_name = companyName; sections.effective_date = new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }); }
      setEditorDoc({
        type: selectedType,
        title: `${companyName} — ${dt?.label}`,
        status: 'draft',
        company_name: companyName,
        sections,
      });
    }

    setGenerating(false);
    setGenStatus('');
  }

  // ── Saved doc helpers ─────────────────────────────────────────────────────
  const handleEditorSaved = (savedDoc, deletedId) => {
    if (deletedId) { setDocs(prev => prev.filter(d => d.id !== deletedId)); return; }
    if (savedDoc) {
      setDocs(prev => {
        const idx = prev.findIndex(d => d.id === savedDoc.id);
        if (idx >= 0) { const n = [...prev]; n[idx] = savedDoc; return n; }
        return [savedDoc, ...prev];
      });
    }
  };

  const filteredDocs = docs.filter(d => {
    if (filterType !== 'all' && d.type !== filterType) return false;
    if (search) {
      const q = search.toLowerCase();
      if (!d.title?.toLowerCase().includes(q) && !d.company_name?.toLowerCase().includes(q)) return false;
    }
    return true;
  });

  // Group companies by source for the <optgroup> select
  const grouped = {};
  companies.forEach(c => {
    if (!grouped[c.source]) grouped[c.source] = [];
    grouped[c.source].push(c);
  });
  const sourceOrder = ['Pipeline', 'Client', 'Past Deal'];

  return (
    <div style={{ padding: '0 0 80px', maxWidth: 960, margin: '0 auto' }}>

      {/* ── CREATE FORM ─────────────────────────────────────────────────── */}
      <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 16, padding: '28px 28px 24px', marginBottom: 32 }}>

        {/* Row 1: Company + Contact */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 24 }}>
          <div>
            <label style={{ display: 'block', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.06em', color: '#9ca3af', marginBottom: 7 }}>
              Company
            </label>
            <select
              value={companyName}
              onChange={e => setCompanyName(e.target.value)}
              style={{ width: '100%', padding: '10px 12px', border: '2px solid #e5e7eb', borderRadius: 10, fontSize: 14, fontFamily: 'inherit', color: companyName ? '#111' : '#9ca3af', background: '#fff', cursor: 'pointer', outline: 'none', appearance: 'none', backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='8' viewBox='0 0 12 8'%3E%3Cpath fill='%239ca3af' d='M1 1l5 5 5-5'/%3E%3C/svg%3E")`, backgroundRepeat: 'no-repeat', backgroundPosition: 'right 12px center', paddingRight: 32 }}
            >
              <option value="">{loadingCo ? 'Loading companies…' : 'Select company…'}</option>
              {sourceOrder.map(src => {
                const items = grouped[src];
                if (!items?.length) return null;
                return (
                  <optgroup key={src} label={src}>
                    {items.map(c => <option key={c.name} value={c.name}>{c.name}</option>)}
                  </optgroup>
                );
              })}
            </select>
          </div>

          <div>
            <label style={{ display: 'block', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.06em', color: '#9ca3af', marginBottom: 7 }}>
              Contact {loadingContacts && <span style={{ fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>— loading…</span>}
            </label>
            <select
              value={contactName}
              onChange={e => setContactName(e.target.value)}
              disabled={!companyName || contacts.length === 0}
              style={{ width: '100%', padding: '10px 12px', border: '2px solid #e5e7eb', borderRadius: 10, fontSize: 14, fontFamily: 'inherit', color: contactName ? '#111' : '#9ca3af', background: '#fff', cursor: companyName && contacts.length > 0 ? 'pointer' : 'default', opacity: !companyName ? 0.5 : 1, outline: 'none', appearance: 'none', backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='8' viewBox='0 0 12 8'%3E%3Cpath fill='%239ca3af' d='M1 1l5 5 5-5'/%3E%3C/svg%3E")`, backgroundRepeat: 'no-repeat', backgroundPosition: 'right 12px center', paddingRight: 32 }}
            >
              <option value="">
                {!companyName ? 'Select a company first' : contacts.length === 0 ? 'No contacts on file' : 'Select contact (optional)…'}
              </option>
              {contacts.map(c => (
                <option key={c.name} value={c.name}>
                  {c.name}{c.title ? ` — ${c.title}` : ''}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Row 2: Doc type tiles */}
        <div style={{ marginBottom: 24 }}>
          <label style={{ display: 'block', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.06em', color: '#9ca3af', marginBottom: 10 }}>
            Document Type
          </label>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            {DOC_TYPES.map(t => (
              <button
                key={t.id}
                onClick={() => setSelectedType(t.id)}
                style={{
                  padding: '10px 16px',
                  borderRadius: 10,
                  border: `2px solid ${selectedType === t.id ? t.color : '#e5e7eb'}`,
                  background: selectedType === t.id ? t.bg : '#fff',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 7,
                  transition: 'all .12s',
                  boxShadow: selectedType === t.id ? `0 0 0 3px ${t.color}22` : 'none',
                }}
                onMouseEnter={e => { if (selectedType !== t.id) { e.currentTarget.style.borderColor = t.color; e.currentTarget.style.background = t.bg; } }}
                onMouseLeave={e => { if (selectedType !== t.id) { e.currentTarget.style.borderColor = '#e5e7eb'; e.currentTarget.style.background = '#fff'; } }}
              >
                <span style={{ fontSize: 18 }}>{t.icon}</span>
                <div style={{ textAlign: 'left' }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: '#111', lineHeight: 1.2 }}>{t.label}</div>
                  <div style={{ fontSize: 11, color: '#9ca3af' }}>{TYPE_DESCRIPTIONS[t.id]}</div>
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* Row 3: Generate button + status */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <button
            onClick={handleGenerate}
            disabled={!canGenerate}
            style={{
              padding: '11px 28px',
              borderRadius: 10,
              border: 'none',
              background: canGenerate ? '#111' : '#e5e7eb',
              color: canGenerate ? '#fff' : '#9ca3af',
              fontSize: 14,
              fontWeight: 700,
              cursor: canGenerate ? 'pointer' : 'default',
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              transition: 'background .12s',
            }}
          >
            {generating ? (
              <>
                <span style={{ display: 'inline-block', width: 14, height: 14, border: '2px solid #fff', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin .7s linear infinite' }} />
                {genStatus === 'gathering' ? 'Gathering company intel…' : 'Writing document…'}
              </>
            ) : (
              <>✦ Create Document</>
            )}
          </button>

          {!companyName && <span style={{ fontSize: 12, color: '#9ca3af' }}>Select a company to get started</span>}
          {companyName && !selectedType && <span style={{ fontSize: 12, color: '#9ca3af' }}>Choose a document type</span>}
          {companyName && selectedType && !generating && (
            <span style={{ fontSize: 12, color: '#6b7280' }}>
              {['proposal', 'goo', 'sow'].includes(selectedType)
                ? `AI will pull all known intel on ${companyName} to write this`
                : `${companyName} details will be pre-filled into the template`}
            </span>
          )}

          {genError && (
            <div style={{ fontSize: 12, color: '#991b1b', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, padding: '8px 12px', flex: 1 }}>
              {genError}
            </div>
          )}
        </div>
      </div>

      {/* ── SAVED DOCS LIST ──────────────────────────────────────────────── */}
      <div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 14, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 13, fontWeight: 700, color: '#374151' }}>
            Saved Documents
            {docs.length > 0 && <span style={{ fontWeight: 400, color: '#9ca3af', marginLeft: 5 }}>({docs.length})</span>}
          </span>
          <div style={{ flex: 1 }} />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search…"
            style={{ padding: '7px 12px', border: '1px solid #e5e7eb', borderRadius: 8, fontSize: 13, fontFamily: 'inherit', width: 160, outline: 'none' }}
          />
          <select
            value={filterType}
            onChange={e => setFilterType(e.target.value)}
            style={{ padding: '7px 10px', border: '1px solid #e5e7eb', borderRadius: 8, fontSize: 13, fontFamily: 'inherit' }}
          >
            <option value="all">All Types</option>
            {DOC_TYPES.map(t => <option key={t.id} value={t.id}>{t.icon} {t.label}</option>)}
          </select>
        </div>

        {loadingDocs ? (
          <p style={{ color: '#9ca3af', fontSize: 13, textAlign: 'center', padding: 32 }}>Loading…</p>
        ) : filteredDocs.length === 0 && docs.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '32px 20px', background: '#f9fafb', borderRadius: 12, border: '1px dashed #e5e7eb' }}>
            <p style={{ color: '#9ca3af', fontSize: 13 }}>No documents yet — create your first one above.</p>
          </div>
        ) : filteredDocs.length === 0 ? (
          <p style={{ color: '#9ca3af', fontSize: 13, textAlign: 'center', padding: 20 }}>No documents match your filters.</p>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 12 }}>
            {filteredDocs.map(d => {
              const dt = docType(d.type);
              const ds = docStatus(d.status);
              return (
                <div
                  key={d.id}
                  onClick={() => { setEditorDoc(d); setEditorContext(null); }}
                  style={{ background: '#fff', border: '1px solid #e5e7eb', borderLeft: `4px solid ${dt.color}`, borderRadius: 12, padding: '14px 16px', cursor: 'pointer', transition: 'box-shadow .12s' }}
                  onMouseEnter={e => e.currentTarget.style.boxShadow = '0 4px 16px rgba(0,0,0,.08)'}
                  onMouseLeave={e => e.currentTarget.style.boxShadow = 'none'}
                >
                  <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
                    <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 20, background: dt.bg, color: dt.color }}>{dt.icon} {dt.label}</span>
                    <span style={{ fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 20, background: '#f3f4f6', color: ds.color }}>{ds.label}</span>
                  </div>
                  <div style={{ fontSize: 14, fontWeight: 700, color: '#111', lineHeight: 1.3, marginBottom: 4 }}>
                    {d.title || <span style={{ color: '#9ca3af', fontStyle: 'italic' }}>Untitled</span>}
                  </div>
                  {d.company_name && <div style={{ fontSize: 12, color: '#6b7280' }}>{d.company_name}</div>}
                  <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 6 }}>Updated {fmtDate(d.updated_at)}</div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ── INLINE EDITOR — new documents generated from the form above ─── */}
      {editorDoc && !editorDoc.id && (
        <div style={{ marginBottom: 32 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
            <div style={{ height: 1, flex: 1, background: '#e5e7eb' }} />
            <span style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.07em', color: '#9ca3af' }}>Generated Document</span>
            <div style={{ height: 1, flex: 1, background: '#e5e7eb' }} />
          </div>
          <DocumentEditor
            inline
            doc={editorDoc}
            dealContext={editorContext}
            onClose={() => { setEditorDoc(null); setEditorContext(null); }}
            onSaved={(saved, deletedId) => {
              handleEditorSaved(saved, deletedId);
              if (deletedId) { setEditorDoc(null); return; }
              if (saved) setEditorDoc(saved); // keep inline but now has an id
            }}
          />
        </div>
      )}

      {/* ── MODAL — reopening a saved document from the list below ───────── */}
      {editorDoc && editorDoc.id && (
        <DocumentEditor
          doc={editorDoc}
          dealContext={editorContext}
          onClose={() => { setEditorDoc(null); setEditorContext(null); }}
          onSaved={(saved, deletedId) => {
            handleEditorSaved(saved, deletedId);
            if (deletedId) { setEditorDoc(null); return; }
            if (saved) setEditorDoc(saved);
          }}
        />
      )}
    </div>
  );
}
