import { useState, useEffect } from 'react';
import { fetchDocuments, upsertDocument, DOC_TYPES, DOC_STATUSES, defaultSections, docType, docStatus } from '../lib/documents';
import DocumentEditor from '../components/DocumentEditor';

const fmtDate = d => d
  ? new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  : '—';

export default function DocumentsPage({ refreshKey = 0, onNavigate }) {
  const [docs, setDocs]               = useState([]);
  const [loading, setLoading]         = useState(true);
  const [filterType, setFilterType]   = useState('all');
  const [filterStatus, setFilterStatus] = useState('all');
  const [search, setSearch]           = useState('');
  const [editorDoc, setEditorDoc]     = useState(null); // open editor with this doc (null = closed)
  const [creatingType, setCreatingType] = useState(null); // 'proposal'|'goo'|etc while type picker is open
  const [showTypePicker, setShowTypePicker] = useState(false);

  useEffect(() => {
    load();
  }, [refreshKey]);

  async function load() {
    setLoading(true);
    try {
      const data = await fetchDocuments();
      setDocs(data);
    } catch (e) {
      console.error('fetchDocuments:', e.message);
    } finally {
      setLoading(false);
    }
  }

  // Called by editor on save or delete
  const handleEditorSaved = (savedDoc, deletedId) => {
    if (deletedId) {
      setDocs(prev => prev.filter(d => d.id !== deletedId));
      return;
    }
    if (savedDoc) {
      setDocs(prev => {
        const idx = prev.findIndex(d => d.id === savedDoc.id);
        if (idx >= 0) {
          const next = [...prev];
          next[idx] = savedDoc;
          return next;
        }
        return [savedDoc, ...prev];
      });
    }
  };

  const openNew = type => {
    setShowTypePicker(false);
    setEditorDoc({
      type,
      title: '',
      status: 'draft',
      sections: defaultSections(type),
    });
  };

  // Filter docs
  const filtered = docs.filter(d => {
    if (filterType !== 'all' && d.type !== filterType) return false;
    if (filterStatus !== 'all' && d.status !== filterStatus) return false;
    if (search) {
      const q = search.toLowerCase();
      if (!d.title?.toLowerCase().includes(q)) return false;
    }
    return true;
  });

  // Stats
  const stats = DOC_TYPES.map(t => ({
    ...t,
    count: docs.filter(d => d.type === t.id).length,
  }));
  const signedCount = docs.filter(d => d.status === 'signed').length;

  return (
    <div style={{ padding: '0 0 60px' }}>

      {/* Stats row */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 24, flexWrap: 'wrap' }}>
        {stats.map(t => (
          <div
            key={t.id}
            onClick={() => setFilterType(filterType === t.id ? 'all' : t.id)}
            style={{ padding: '12px 18px', borderRadius: 10, background: filterType === t.id ? t.bg : '#f9fafb', border: `1px solid ${filterType === t.id ? t.color : '#e5e7eb'}`, cursor: 'pointer', transition: 'all .15s', minWidth: 100 }}
          >
            <div style={{ fontSize: 20, marginBottom: 4 }}>{t.icon}</div>
            <div style={{ fontSize: 18, fontWeight: 800, color: '#111' }}>{t.count}</div>
            <div style={{ fontSize: 11, color: '#6b7280', fontWeight: 600 }}>{t.label}</div>
          </div>
        ))}
        <div style={{ padding: '12px 18px', borderRadius: 10, background: '#f0fdf4', border: '1px solid #bbf7d0', minWidth: 100 }}>
          <div style={{ fontSize: 20, marginBottom: 4 }}>✅</div>
          <div style={{ fontSize: 18, fontWeight: 800, color: '#111' }}>{signedCount}</div>
          <div style={{ fontSize: 11, color: '#6b7280', fontWeight: 600 }}>Signed</div>
        </div>
      </div>

      {/* Toolbar */}
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 20, flexWrap: 'wrap' }}>
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search documents…"
          style={{ flex: '1 1 200px', padding: '8px 12px', border: '1px solid #e5e7eb', borderRadius: 8, fontSize: 13, fontFamily: 'inherit', minWidth: 160 }}
        />
        <select
          value={filterType}
          onChange={e => setFilterType(e.target.value)}
          style={{ padding: '8px 12px', border: '1px solid #e5e7eb', borderRadius: 8, fontSize: 13, fontFamily: 'inherit' }}
        >
          <option value="all">All Types</option>
          {DOC_TYPES.map(t => <option key={t.id} value={t.id}>{t.icon} {t.label}</option>)}
        </select>
        <select
          value={filterStatus}
          onChange={e => setFilterStatus(e.target.value)}
          style={{ padding: '8px 12px', border: '1px solid #e5e7eb', borderRadius: 8, fontSize: 13, fontFamily: 'inherit' }}
        >
          <option value="all">All Statuses</option>
          {DOC_STATUSES.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
        </select>

        {/* New document button */}
        <div style={{ position: 'relative' }}>
          <button
            onClick={() => setShowTypePicker(prev => !prev)}
            style={{ padding: '8px 18px', borderRadius: 8, border: 'none', background: '#f97316', color: '#fff', fontSize: 13, fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}
          >
            + New Document ▾
          </button>
          {showTypePicker && (
            <>
              <div onClick={() => setShowTypePicker(false)} style={{ position: 'fixed', inset: 0, zIndex: 90 }} />
              <div style={{ position: 'absolute', top: '100%', right: 0, marginTop: 6, background: '#fff', border: '1px solid #e5e7eb', borderRadius: 10, boxShadow: '0 8px 24px rgba(0,0,0,.12)', zIndex: 100, minWidth: 220, overflow: 'hidden' }}>
                {DOC_TYPES.map(t => (
                  <button
                    key={t.id}
                    onClick={() => openNew(t.id)}
                    style={{ width: '100%', padding: '11px 16px', border: 'none', background: 'none', textAlign: 'left', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 10, fontSize: 13, fontFamily: 'inherit', color: '#111' }}
                    onMouseEnter={e => e.currentTarget.style.background = t.bg}
                    onMouseLeave={e => e.currentTarget.style.background = 'none'}
                  >
                    <span style={{ fontSize: 18 }}>{t.icon}</span>
                    <div>
                      <div style={{ fontWeight: 600 }}>{t.label}</div>
                      <div style={{ fontSize: 11, color: '#9ca3af' }}>
                        {t.id === 'proposal' && 'Full project pitch'}
                        {t.id === 'goo' && 'Intake summary / napkin'}
                        {t.id === 'sow' && 'Scope, deliverables & terms'}
                        {t.id === 'msa' && 'Master services agreement'}
                        {t.id === 'mnda' && 'Mutual NDA'}
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      </div>

      {/* Document list */}
      {loading ? (
        <div style={{ textAlign: 'center', padding: 60, color: '#9ca3af', fontSize: 14 }}>Loading documents…</div>
      ) : filtered.length === 0 ? (
        <div style={{ textAlign: 'center', padding: 60 }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>📄</div>
          <p style={{ fontSize: 16, fontWeight: 600, color: '#374151', marginBottom: 6 }}>
            {docs.length === 0 ? 'No documents yet' : 'No documents match your filters'}
          </p>
          <p style={{ fontSize: 13, color: '#9ca3af', marginBottom: 20 }}>
            {docs.length === 0
              ? 'Create your first Proposal, SOW, MSA, or MNDA.'
              : 'Try adjusting your search or filters.'}
          </p>
          {docs.length === 0 && (
            <button
              onClick={() => setShowTypePicker(true)}
              style={{ padding: '10px 20px', borderRadius: 8, border: 'none', background: '#f97316', color: '#fff', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}
            >
              + New Document
            </button>
          )}
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 14 }}>
          {filtered.map(d => {
            const dt = docType(d.type);
            const ds = docStatus(d.status);
            return (
              <div
                key={d.id}
                onClick={() => setEditorDoc(d)}
                style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 12, padding: '16px 18px', cursor: 'pointer', transition: 'all .15s', borderLeft: `4px solid ${dt.color}` }}
                onMouseEnter={e => { e.currentTarget.style.boxShadow = '0 4px 16px rgba(0,0,0,.08)'; e.currentTarget.style.borderColor = dt.color; }}
                onMouseLeave={e => { e.currentTarget.style.boxShadow = 'none'; e.currentTarget.style.borderColor = '#e5e7eb'; e.currentTarget.style.borderLeftColor = dt.color; }}
              >
                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10, marginBottom: 8 }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 15, fontWeight: 700, color: '#111', marginBottom: 4, lineHeight: 1.3 }}>
                      {d.title || <span style={{ color: '#9ca3af', fontStyle: 'italic' }}>Untitled</span>}
                    </div>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                      <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 20, background: dt.bg, color: dt.color }}>
                        {dt.icon} {dt.label}
                      </span>
                      <span style={{ fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 20, background: '#f3f4f6', color: ds.color }}>
                        {ds.label}
                      </span>
                    </div>
                  </div>
                </div>
                <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 10, display: 'flex', justifyContent: 'space-between' }}>
                  <span>Updated {fmtDate(d.updated_at)}</span>
                  {d.deal_id && <span style={{ color: '#6d28d9' }}>Linked to deal</span>}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Editor modal */}
      {editorDoc && (
        <DocumentEditor
          doc={editorDoc}
          dealContext={null}
          onClose={() => setEditorDoc(null)}
          onSaved={(saved, deletedId) => {
            handleEditorSaved(saved, deletedId);
            if (!deletedId) setEditorDoc(saved || editorDoc);
          }}
        />
      )}
    </div>
  );
}
