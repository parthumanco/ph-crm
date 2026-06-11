import { useState, useEffect, useRef } from 'react';
import {
  fetchDocuments, upsertDocument, DOC_TYPES, DOC_STATUSES,
  defaultSections, docType, docStatus,
  fetchAllCompaniesForPicker, gatherCompanyContext,
} from '../lib/documents';
import { generateDocumentSections } from '../lib/anthropic';
import DocumentEditor from '../components/DocumentEditor';

const fmtDate = d => d
  ? new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  : '—';

// ── Type tile descriptions ────────────────────────────────────────────────────
const TYPE_DESCRIPTIONS = {
  proposal: 'Full project pitch — understanding, strategy, phases, investment',
  goo:      'Intake summary — what we heard, the goal, objectives, outcomes',
  sow:      'Scope of work — deliverables, timeline, cost, standard terms',
  msa:      'Master services agreement — legal contract template',
  mnda:     'Mutual non-disclosure agreement — confidentiality template',
};

// ── Company picker component ──────────────────────────────────────────────────
function CompanyPicker({ onSelect }) {
  const [companies, setCompanies] = useState([]);
  const [query, setQuery]         = useState('');
  const [open, setOpen]           = useState(false);
  const [loading, setLoading]     = useState(true);
  const inputRef = useRef(null);

  useEffect(() => {
    fetchAllCompaniesForPicker()
      .then(setCompanies)
      .catch(e => console.warn('CompanyPicker:', e.message))
      .finally(() => setLoading(false));
    setTimeout(() => inputRef.current?.focus(), 50);
  }, []);

  const filtered = query.trim()
    ? companies.filter(c => c.name.toLowerCase().includes(query.toLowerCase()))
    : companies;

  // Group by source
  const groups = {};
  filtered.forEach(c => {
    if (!groups[c.source]) groups[c.source] = [];
    groups[c.source].push(c);
  });
  const sourceOrder = ['Pipeline', 'Client', 'Past Deal'];

  return (
    <div style={{ marginTop: 28 }}>
      <h3 style={{ fontSize: 17, fontWeight: 700, color: '#111', marginBottom: 16, textAlign: 'center' }}>
        Who is this for?
      </h3>
      <div style={{ maxWidth: 480, margin: '0 auto', position: 'relative' }}>
        <input
          ref={inputRef}
          value={query}
          onChange={e => { setQuery(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          placeholder="Search companies…"
          style={{ width: '100%', padding: '12px 16px', border: '2px solid #e5e7eb', borderRadius: 10, fontSize: 15, fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box', boxShadow: open ? '0 0 0 3px rgba(249,115,22,.15)' : 'none', borderColor: open ? '#f97316' : '#e5e7eb', transition: 'all .15s' }}
          autoComplete="off"
        />
        {open && (
          <>
            <div onClick={() => setOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 10 }} />
            <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, marginTop: 6, background: '#fff', border: '1px solid #e5e7eb', borderRadius: 10, boxShadow: '0 8px 24px rgba(0,0,0,.12)', zIndex: 20, maxHeight: 320, overflowY: 'auto' }}>
              {loading && <p style={{ padding: '14px 16px', color: '#9ca3af', fontSize: 13 }}>Loading companies…</p>}
              {!loading && filtered.length === 0 && (
                <div style={{ padding: 16 }}>
                  <p style={{ fontSize: 13, color: '#6b7280', marginBottom: 10 }}>No match — create new company:</p>
                  <button
                    onClick={() => { onSelect(query.trim()); setOpen(false); }}
                    style={{ padding: '8px 14px', borderRadius: 8, border: 'none', background: '#f97316', color: '#fff', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}
                  >
                    Use "{query.trim()}"
                  </button>
                </div>
              )}
              {!loading && sourceOrder.map(src => {
                const items = groups[src];
                if (!items?.length) return null;
                return (
                  <div key={src}>
                    <div style={{ padding: '8px 14px 4px', fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.06em', color: '#9ca3af' }}>{src}</div>
                    {items.map(c => (
                      <button
                        key={c.name}
                        onClick={() => { onSelect(c.name); setOpen(false); }}
                        style={{ width: '100%', padding: '10px 16px', border: 'none', background: 'none', textAlign: 'left', cursor: 'pointer', fontSize: 14, fontFamily: 'inherit', color: '#111', display: 'flex', alignItems: 'center', gap: 8 }}
                        onMouseEnter={e => e.currentTarget.style.background = '#f9fafb'}
                        onMouseLeave={e => e.currentTarget.style.background = 'none'}
                      >
                        <span style={{ fontSize: 16 }}>{src === 'Client' ? '🏢' : src === 'Pipeline' ? '💵' : '📁'}</span>
                        {c.name}
                      </button>
                    ))}
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function DocumentsPage({ refreshKey = 0 }) {
  const [docs, setDocs]       = useState([]);
  const [loading, setLoading] = useState(true);

  // Creation flow state
  const [selectedType, setSelectedType] = useState(null);  // 'proposal'|'goo'|etc
  const [selectedCompany, setSelectedCompany] = useState(null); // company name string
  const [gathering, setGathering] = useState(false);  // loading context
  const [generating, setGenerating] = useState(false); // AI generation
  const [genError, setGenError] = useState(null);

  // Editor
  const [editorDoc, setEditorDoc] = useState(null);
  const [editorContext, setEditorContext] = useState(null); // raw context string for editor

  // Filters (for saved docs list below)
  const [filterType,   setFilterType]   = useState('all');
  const [filterStatus, setFilterStatus] = useState('all');
  const [search,       setSearch]       = useState('');

  useEffect(() => { load(); }, [refreshKey]);

  async function load() {
    setLoading(true);
    try { setDocs(await fetchDocuments()); }
    catch (e) { console.error('fetchDocuments:', e.message); }
    finally { setLoading(false); }
  }

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

  // Step 2: company selected → gather context + generate
  const handleCompanySelected = async (companyName) => {
    setSelectedCompany(companyName);
    setGenError(null);

    const canGenerate = ['proposal', 'goo', 'sow'].includes(selectedType);

    // Gather context regardless of type (used to pre-fill legal docs too)
    setGathering(true);
    let context = '';
    try {
      context = await gatherCompanyContext(companyName);
      setEditorContext(context);
    } catch (e) {
      console.warn('gatherCompanyContext:', e.message);
      context = `Company: ${companyName}`;
    } finally {
      setGathering(false);
    }

    // For legal templates (MSA, MNDA) — just open editor pre-filled with company name
    if (!canGenerate) {
      const sections = defaultSections(selectedType);
      if (selectedType === 'msa')  sections.client_name = companyName;
      if (selectedType === 'mnda') sections.counterparty_name = companyName;
      setEditorDoc({
        type: selectedType,
        title: `${companyName} — ${DOC_TYPES.find(t => t.id === selectedType)?.label}`,
        status: 'draft',
        company_name: companyName,
        sections,
      });
      setSelectedType(null);
      setSelectedCompany(null);
      return;
    }

    // For AI-generatable docs — run generation
    setGenerating(true);
    try {
      const sections = await generateDocumentSections(selectedType, context);
      const dt = DOC_TYPES.find(t => t.id === selectedType);
      setEditorDoc({
        type: selectedType,
        title: `${companyName} — ${dt?.label}`,
        status: 'draft',
        company_name: companyName,
        sections: { ...defaultSections(selectedType), ...sections },
      });
    } catch (e) {
      setGenError(e.message);
      // Still open editor even if AI failed, with empty sections
      const dt = DOC_TYPES.find(t => t.id === selectedType);
      setEditorDoc({
        type: selectedType,
        title: `${companyName} — ${dt?.label}`,
        status: 'draft',
        company_name: companyName,
        sections: defaultSections(selectedType),
      });
    } finally {
      setGenerating(false);
      setSelectedType(null);
      setSelectedCompany(null);
    }
  };

  // Reset creation flow
  const cancelFlow = () => {
    setSelectedType(null);
    setSelectedCompany(null);
    setGathering(false);
    setGenerating(false);
    setGenError(null);
  };

  // Filtered saved docs
  const filtered = docs.filter(d => {
    if (filterType !== 'all' && d.type !== filterType) return false;
    if (filterStatus !== 'all' && d.status !== filterStatus) return false;
    if (search) { const q = search.toLowerCase(); if (!d.title?.toLowerCase().includes(q) && !d.company_name?.toLowerCase().includes(q)) return false; }
    return true;
  });

  const isFlowActive = selectedType || gathering || generating;

  return (
    <div style={{ padding: '0 0 80px', maxWidth: 1000, margin: '0 auto' }}>

      {/* ── CREATION FLOW ────────────────────────────────────────────────── */}

      {/* Step 1: Type tiles (always visible unless loading/generating) */}
      {!gathering && !generating && (
        <div style={{ marginBottom: 40 }}>
          <h2 style={{ fontSize: 22, fontWeight: 800, color: '#111', textAlign: 'center', marginBottom: 6 }}>
            What do you want to create today?
          </h2>
          <p style={{ fontSize: 14, color: '#9ca3af', textAlign: 'center', marginBottom: 28 }}>
            Choose a document type and we'll pull everything we know about your client to write it.
          </p>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 14 }}>
            {DOC_TYPES.map(t => (
              <button
                key={t.id}
                onClick={() => { setSelectedType(t.id); setSelectedCompany(null); setGenError(null); }}
                style={{
                  padding: '22px 16px',
                  borderRadius: 14,
                  border: `2px solid ${selectedType === t.id ? t.color : '#e5e7eb'}`,
                  background: selectedType === t.id ? t.bg : '#fff',
                  cursor: 'pointer',
                  textAlign: 'left',
                  transition: 'all .15s',
                  boxShadow: selectedType === t.id ? `0 0 0 3px ${t.color}22` : 'none',
                }}
                onMouseEnter={e => { if (selectedType !== t.id) { e.currentTarget.style.borderColor = t.color; e.currentTarget.style.background = t.bg; } }}
                onMouseLeave={e => { if (selectedType !== t.id) { e.currentTarget.style.borderColor = '#e5e7eb'; e.currentTarget.style.background = '#fff'; } }}
              >
                <div style={{ fontSize: 28, marginBottom: 10 }}>{t.icon}</div>
                <div style={{ fontSize: 14, fontWeight: 700, color: '#111', marginBottom: 4 }}>{t.label}</div>
                <div style={{ fontSize: 11, color: '#9ca3af', lineHeight: 1.4 }}>{TYPE_DESCRIPTIONS[t.id]}</div>
              </button>
            ))}
          </div>

          {/* Step 2: Company picker — slides in after type selection */}
          {selectedType && !selectedCompany && (
            <>
              <CompanyPicker onSelect={handleCompanySelected} />
              <div style={{ textAlign: 'center', marginTop: 16 }}>
                <button onClick={cancelFlow} style={{ fontSize: 12, color: '#9ca3af', background: 'none', border: 'none', cursor: 'pointer' }}>
                  ← cancel
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {/* Step 3: Loading state */}
      {(gathering || generating) && (
        <div style={{ textAlign: 'center', padding: '60px 20px' }}>
          <div style={{ fontSize: 40, marginBottom: 20 }}>
            {gathering ? '🔍' : '✍️'}
          </div>
          <h3 style={{ fontSize: 18, fontWeight: 700, color: '#111', marginBottom: 8 }}>
            {gathering
              ? `Gathering everything we know about ${selectedCompany}…`
              : `Writing your ${DOC_TYPES.find(t => t.id === selectedType)?.label}…`}
          </h3>
          <p style={{ fontSize: 13, color: '#9ca3af', marginBottom: 24 }}>
            {gathering
              ? 'Pulling deal history, meetings, thesis, projects, and activities.'
              : 'Using all context to generate a document in Part Human\'s voice.'}
          </p>
          <div style={{ display: 'flex', justifyContent: 'center', gap: 6 }}>
            {[0, 1, 2].map(i => (
              <div key={i} style={{ width: 8, height: 8, borderRadius: '50%', background: '#f97316', animation: `pulse 1.2s ease-in-out ${i * 0.2}s infinite` }} />
            ))}
          </div>
          {genError && (
            <div style={{ marginTop: 20, padding: '10px 16px', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, fontSize: 13, color: '#991b1b' }}>
              AI generation failed: {genError}. The document will open with empty sections for manual editing.
            </div>
          )}
        </div>
      )}

      {/* ── SAVED DOCUMENTS LIST ─────────────────────────────────────────── */}
      {!isFlowActive && (
        <div>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 16, flexWrap: 'wrap' }}>
            <h3 style={{ fontSize: 15, fontWeight: 700, color: '#374151', margin: 0, flex: '0 0 auto' }}>
              Saved Documents {docs.length > 0 && <span style={{ color: '#9ca3af', fontWeight: 400 }}>({docs.length})</span>}
            </h3>
            <div style={{ flex: 1 }} />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search…"
              style={{ padding: '7px 12px', border: '1px solid #e5e7eb', borderRadius: 8, fontSize: 13, fontFamily: 'inherit', width: 160 }}
            />
            <select value={filterType} onChange={e => setFilterType(e.target.value)} style={{ padding: '7px 10px', border: '1px solid #e5e7eb', borderRadius: 8, fontSize: 13, fontFamily: 'inherit' }}>
              <option value="all">All Types</option>
              {DOC_TYPES.map(t => <option key={t.id} value={t.id}>{t.icon} {t.label}</option>)}
            </select>
            <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)} style={{ padding: '7px 10px', border: '1px solid #e5e7eb', borderRadius: 8, fontSize: 13, fontFamily: 'inherit' }}>
              <option value="all">All Statuses</option>
              {DOC_STATUSES.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
            </select>
          </div>

          {loading ? (
            <p style={{ color: '#9ca3af', fontSize: 13, textAlign: 'center', padding: 40 }}>Loading…</p>
          ) : filtered.length === 0 && docs.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '40px 20px', background: '#f9fafb', borderRadius: 12, border: '1px dashed #e5e7eb' }}>
              <p style={{ color: '#9ca3af', fontSize: 13 }}>No documents yet — choose a type above to get started.</p>
            </div>
          ) : filtered.length === 0 ? (
            <p style={{ color: '#9ca3af', fontSize: 13, textAlign: 'center', padding: 20 }}>No documents match your filters.</p>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 12 }}>
              {filtered.map(d => {
                const dt = docType(d.type);
                const ds = docStatus(d.status);
                return (
                  <div
                    key={d.id}
                    onClick={() => { setEditorDoc(d); setEditorContext(null); }}
                    style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 12, padding: '14px 16px', cursor: 'pointer', borderLeft: `4px solid ${dt.color}`, transition: 'box-shadow .15s' }}
                    onMouseEnter={e => e.currentTarget.style.boxShadow = '0 4px 16px rgba(0,0,0,.08)'}
                    onMouseLeave={e => e.currentTarget.style.boxShadow = 'none'}
                  >
                    <div style={{ display: 'flex', gap: 6, marginBottom: 8, flexWrap: 'wrap' }}>
                      <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 20, background: dt.bg, color: dt.color }}>{dt.icon} {dt.label}</span>
                      <span style={{ fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 20, background: '#f3f4f6', color: ds.color }}>{ds.label}</span>
                    </div>
                    <div style={{ fontSize: 14, fontWeight: 700, color: '#111', marginBottom: 4, lineHeight: 1.3 }}>
                      {d.title || <span style={{ color: '#9ca3af', fontStyle: 'italic' }}>Untitled</span>}
                    </div>
                    {d.company_name && <div style={{ fontSize: 12, color: '#6b7280' }}>{d.company_name}</div>}
                    <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 8 }}>Updated {fmtDate(d.updated_at)}</div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ── EDITOR MODAL ─────────────────────────────────────────────────── */}
      {editorDoc && (
        <DocumentEditor
          doc={editorDoc}
          dealContext={editorContext}
          onClose={() => { setEditorDoc(null); setEditorContext(null); }}
          onSaved={(saved, deletedId) => {
            handleEditorSaved(saved, deletedId);
            if (!deletedId) setEditorDoc(saved || editorDoc);
          }}
        />
      )}
    </div>
  );
}
