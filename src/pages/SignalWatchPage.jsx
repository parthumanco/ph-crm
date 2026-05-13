import { useState, useCallback, useEffect, useRef } from 'react';
import { supabase } from '../lib/supabase';
import { scanBatch, scanDeepDive } from '../lib/anthropic';

const TRIGGER_CATEGORIES = [
  { id: 'leadership', label: 'Leadership Change', color: '#f59e0b' },
  { id: 'funding',    label: 'Funding / M&A',     color: '#10b981' },
  { id: 'expansion',  label: 'Expansion / Growth', color: '#3b82f6' },
  { id: 'product',    label: 'Product Launch',     color: '#8b5cf6' },
  { id: 'pain',       label: 'Challenges / Pain',  color: '#ef4444' },
  { id: 'hiring',     label: 'Hiring Signals',     color: '#06b6d4' },
];

const catColor   = id => TRIGGER_CATEGORIES.find(c => c.id === id)?.color || '#94a3b8';
const catLabel   = id => TRIGGER_CATEGORIES.find(c => c.id === id)?.label || id;
const urgColor   = u  => u === 'high' ? '#ef4444' : u === 'medium' ? '#f59e0b' : '#94a3b8';
const scoreColor = s  => s >= 7 ? '#10b981' : s >= 4 ? '#f59e0b' : '#94a3b8';

// Andover MA coordinates
const ANDOVER_LAT = 42.6584;
const ANDOVER_LNG = -71.1370;

function haversineDistance(lat1, lng1, lat2, lng2) {
  const R = 3958.8;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

const BATCH_SIZE = 7;
const SCAN_DELAY = 3000;

function parseCSV(text) {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) return [];
  const headers = lines[0].split(',').map(h => h.trim().toLowerCase().replace(/[^a-z0-9]/g, '_'));

  return lines.slice(1).map((line, idx) => {
    const vals = line.split(',').map(v => v.trim().replace(/^"|"$/g, ''));
    const row = {};
    headers.forEach((h, i) => { row[h] = vals[i] || ''; });

    const name = row.name || row.company || row.company_name || row.organization || '';
    const website = row.website || row.url || row.domain || '';
    const contacts = [];
    const contactName     = row.contact || row.contact_name || row.first_name || '';
    const contactTitle    = row.title || row.contact_title || row.job_title || '';
    const contactEmail    = row.email || row.contact_email || '';
    const contactLinkedin = row.linkedin || row.linkedin_url || '';
    if (contactName) contacts.push({ name: contactName, title: contactTitle, email: contactEmail, linkedin: contactLinkedin });

    return name ? {
      _tempId: `csv-${Date.now()}-${idx}`,
      name,
      website,
      hq: row.hq || row.location || row.city || '',
      contacts,
    } : null;
  }).filter(Boolean);
}

export default function SignalWatchPage({ onNavigate, icp }) {
  // companies: array of {id (db uuid), _tempId, name, website, hq, contacts, ...scan fields}
  const [companies, setCompanies]     = useState([]);
  const [scanning, setScanning]       = useState({});
  const [scanStatus, setScanStatus]   = useState({});
  const [scanningAll, setScanningAll] = useState(false);
  const [scanProgress, setScanProgress] = useState({ done: 0, total: 0 });
  const [search, setSearch]           = useState('');
  const [dragOver, setDragOver]       = useState(false);
  const [sortBy, setSortBy]           = useState('score');
  const [addingToPipeline, setAddingToPipeline] = useState({});
  const [addedToPipeline, setAddedToPipeline]   = useState({});
  const [loading, setLoading]         = useState(true);
  const [importing, setImporting]     = useState(false);
  const [filters, setFilters] = useState({
    series: 'all',
    employees: 'all',
    distance: 'all',
    icp: 'all',
  });
  const cancelRef  = useRef({ cancelled: false });
  const fileInputRef = useRef();

  // ── Load saved results from Supabase on mount ────────────────────────────────

  useEffect(() => {
    async function load() {
      setLoading(true);
      const { data } = await supabase
        .from('companies')
        .select('*')
        .order('scan_date', { ascending: false, nullsFirst: false });
      if (data?.length) {
        // Mark already-in-pipeline companies
        const { data: pipelineEntries } = await supabase
          .from('pipeline_entries')
          .select('company_id');
        const inPipeline = new Set((pipelineEntries || []).map(e => e.company_id));
        const loaded = data.map(c => ({ ...c, _key: c.id }));
        setCompanies(loaded);
        const alreadyAdded = {};
        loaded.forEach(c => { if (inPipeline.has(c.id)) alreadyAdded[c.id] = true; });
        setAddedToPipeline(alreadyAdded);
      }
      setLoading(false);
    }
    load();
  }, []);

  // ── CSV import ──────────────────────────────────────────────────────────────

  const handleFiles = useCallback(async (fileList) => {
    const csvFiles = Array.from(fileList).filter(f => f.name.match(/\.csv$/i));
    if (!csvFiles.length) { alert('Please upload CSV files.'); return; }

    setImporting(true);
    try {
      const allParsed = [];
      for (const file of csvFiles) {
        const text = await file.text();
        const parsed = parseCSV(text);
        allParsed.push(...parsed);
      }

      if (!allParsed.length) {
        alert('No companies found. Make sure your CSV has a "name" or "company" column.');
        return;
      }

      // Separate new vs existing
      const { data: existing } = await supabase.from('companies').select('id, name');
      const existingMap = new Map((existing || []).map(c => [c.name.toLowerCase().trim(), c.id]));

      const toInsert = allParsed.filter(c => !existingMap.has(c.name.toLowerCase().trim()));
      const toMaybeReset = allParsed.filter(c => existingMap.has(c.name.toLowerCase().trim()));

      let resetCount = 0;
      if (toMaybeReset.length > 0) {
        const shouldReset = window.confirm(
          `${toMaybeReset.length} compan${toMaybeReset.length === 1 ? 'y' : 'ies'} already exist.\n\nClick OK to reset their scan data so they'll be re-evaluated.\nClick Cancel to skip them and only import the ${toInsert.length} new ones.`
        );
        if (shouldReset) {
          const resetIds = toMaybeReset.map(c => existingMap.get(c.name.toLowerCase().trim()));
          await supabase.from('companies').update({
            scan_date: null, icp_score: null, overall_score: null, icp_tier: null,
            funding_stage: null, employee_count_num: null, summary: null,
            triggers: [], recommended_angle: null, contact_angles: [],
          }).in('id', resetIds);
          setCompanies(prev => prev.map(c =>
            resetIds.includes(c.id)
              ? { ...c, scan_date: null, icp_score: null, overall_score: null, icp_tier: null, funding_stage: null, employee_count_num: null, summary: null, triggers: [], recommended_angle: null, contact_angles: [], _error: undefined }
              : c
          ));
          resetCount = resetIds.length;
        }
      }

      if (!toInsert.length && resetCount === 0) return;

      let insertedCount = 0;
      if (toInsert.length) {
        const rows = toInsert.map(c => ({
          name: c.name,
          website: c.website || null,
          hq: c.hq || null,
          contacts: c.contacts || [],
        }));
        const { data: inserted, error } = await supabase.from('companies').insert(rows).select('*');
        if (error) throw error;
        if (inserted?.length) {
          setCompanies(prev => [...inserted, ...prev]);
          insertedCount = inserted.length;
        }
      }

      const parts = [];
      if (insertedCount) parts.push(`${insertedCount} new compan${insertedCount === 1 ? 'y' : 'ies'} imported`);
      if (resetCount) parts.push(`${resetCount} reset for re-evaluation`);
      alert(parts.join('. ') + '.');
    } catch (e) {
      alert('Import failed: ' + e.message);
    } finally {
      setImporting(false);
    }
  }, []);

  const onDrop = useCallback(e => {
    e.preventDefault();
    setDragOver(false);
    handleFiles(e.dataTransfer.files);
  }, [handleFiles]);

  // ── Document-level drag-and-drop (works anywhere on the page) ───────────────
  useEffect(() => {
    const onDragOver = e => { e.preventDefault(); setDragOver(true); };
    const onDragLeave = e => { if (!e.relatedTarget) setDragOver(false); };
    const onDropDoc = e => {
      e.preventDefault();
      setDragOver(false);
      if (e.dataTransfer.files?.length) handleFiles(e.dataTransfer.files);
    };
    document.addEventListener('dragover', onDragOver);
    document.addEventListener('dragleave', onDragLeave);
    document.addEventListener('drop', onDropDoc);
    return () => {
      document.removeEventListener('dragover', onDragOver);
      document.removeEventListener('dragleave', onDragLeave);
      document.removeEventListener('drop', onDropDoc);
    };
  }, [handleFiles]);

  // ── Save scan result to Supabase ─────────────────────────────────────────────

  const saveScanResult = useCallback(async (companyId, result) => {
    const update = {
      icp_tier: result.icpTier,
      icp_score: result.icpScore,
      overall_score: result.overallScore,
      funding_stage: result.fundingStage || null,
      employee_count_num: result.employeeCountNum || null,
      employee_count: result.employeeCountNum ? String(result.employeeCountNum) : null,
      summary: result.summary,
      triggers: result.triggers || [],
      recommended_angle: result.recommendedAngle,
      contact_angles: result.contactAngles || [],
      lat: result.lat || null,
      lng: result.lng || null,
      scan_date: new Date().toISOString(),
    };
    await supabase.from('companies').update(update).eq('id', companyId);
    setCompanies(prev => prev.map(c => c.id === companyId ? { ...c, ...update, _scanned: true } : c));
  }, []);

  // ── Single deep scan ─────────────────────────────────────────────────────────

  const scanOne = useCallback(async (company) => {
    const key = company.id || company._tempId;
    setScanning(s => ({ ...s, [key]: true }));
    setScanStatus(s => ({ ...s, [key]: 'Searching the web…' }));
    try {
      const result = await scanDeepDive(company, icp);
      if (company.id) await saveScanResult(company.id, result);
      setScanStatus(s => ({ ...s, [key]: 'Done' }));
    } catch (e) {
      setCompanies(prev => prev.map(c => (c.id || c._tempId) === key ? { ...c, _error: e.message } : c));
      setScanStatus(s => ({ ...s, [key]: 'Error' }));
    } finally {
      setScanning(s => ({ ...s, [key]: false }));
    }
  }, [saveScanResult, icp]);

  // ── Batch scan all ───────────────────────────────────────────────────────────

  const scanAll = useCallback(async () => {
    const unscanned = companies.filter(c => !c.scan_date && !c._error && c.id);
    if (!unscanned.length) { alert('All companies have already been scanned.'); return; }
    cancelRef.current = { cancelled: false };
    setScanningAll(true);
    setScanProgress({ done: 0, total: unscanned.length });

    const batches = [];
    for (let i = 0; i < unscanned.length; i += BATCH_SIZE) batches.push(unscanned.slice(i, i + BATCH_SIZE));

    let done = 0;
    for (const batch of batches) {
      if (cancelRef.current.cancelled) break;
      batch.forEach(c => setScanStatus(s => ({ ...s, [c.id]: 'Scanning…' })));
      try {
        const batchResults = await scanBatch(batch, icp);
        for (let i = 0; i < batch.length; i++) {
          const r = batchResults[i] || { overallScore: 0 };
          await saveScanResult(batch[i].id, r);
          setScanStatus(s => ({ ...s, [batch[i].id]: 'Done' }));
        }
      } catch (e) {
        batch.forEach(c => {
          setCompanies(prev => prev.map(x => x.id === c.id ? { ...x, _error: e.message } : x));
          setScanStatus(s => ({ ...s, [c.id]: 'Error' }));
        });
      }
      done += batch.length;
      setScanProgress({ done, total: unscanned.length });
      if (done < unscanned.length && !cancelRef.current.cancelled) await new Promise(r => setTimeout(r, SCAN_DELAY));
    }
    setScanningAll(false);
  }, [companies, saveScanResult, icp]);

  // ── Add to pipeline ──────────────────────────────────────────────────────────

  const addToPipeline = useCallback(async (company) => {
    if (!company.id || !company.scan_date) return;
    setAddingToPipeline(s => ({ ...s, [company.id]: true }));
    try {
      const today = new Date();
      const monday = new Date(today);
      monday.setDate(today.getDate() - today.getDay() + 1);
      const weekStart = monday.toISOString().slice(0, 10);

      const { error } = await supabase.from('pipeline_entries').insert({
        company_id: company.id,
        current_touch: 0,
        status: 'active',
        week_start: weekStart,
      });
      if (error && !error.message.includes('duplicate')) throw error;
      setAddedToPipeline(s => ({ ...s, [company.id]: true }));
    } catch (e) {
      alert('Error adding to pipeline: ' + e.message);
    } finally {
      setAddingToPipeline(s => ({ ...s, [company.id]: false }));
    }
  }, []);

  // ── Delete company ───────────────────────────────────────────────────────────

  const deleteCompany = useCallback(async (company) => {
    if (!confirm(`Remove ${company.name} from Signal Watch?`)) return;
    if (company.id) await supabase.from('companies').delete().eq('id', company.id);
    setCompanies(prev => prev.filter(c => c.id !== company.id));
  }, []);

  // ── Export CSV ───────────────────────────────────────────────────────────────

  const exportCSV = useCallback(() => {
    const headers = ['name','website','hq','contact','title','email','funding_stage','employee_count','icp_tier','icp_score','overall_score','recommended_angle','summary','scan_date'];
    const escape = v => {
      const s = v == null ? '' : String(v);
      return s.includes(',') || s.includes('"') || s.includes('\n') ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const rows = companies.map(c => {
      const firstContact = (c.contacts || [])[0] || {};
      return [
        c.name, c.website || '', c.hq || '',
        firstContact.name || '', firstContact.title || '', firstContact.email || '',
        c.funding_stage || '', c.employee_count_num || '',
        c.icp_tier || '', c.icp_score || '', c.overall_score || '',
        c.recommended_angle || '', c.summary || '',
        c.scan_date ? c.scan_date.slice(0, 10) : '',
      ].map(escape).join(',');
    });
    const csv = [headers.join(','), ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `signal-watch-${new Date().toISOString().slice(0,10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }, [companies]);

  // ── Clear all ────────────────────────────────────────────────────────────────

  const clearAll = useCallback(async () => {
    if (!window.confirm(`Clear all companies from Signal Watch? Companies already in your pipeline will not be deleted.`)) return;
    try {
      const ids = companies.map(c => c.id).filter(Boolean);
      if (!ids.length) { setCompanies([]); return; }

      // Fetch pipeline company IDs in chunks to avoid URL length limits
      const CHUNK = 100;
      const chunk = (arr) => { const out = []; for (let i = 0; i < arr.length; i += CHUNK) out.push(arr.slice(i, i + CHUNK)); return out; };

      const pipelinedIds = new Set();
      for (const batch of chunk(ids)) {
        const { data } = await supabase.from('pipeline_entries').select('company_id').in('company_id', batch);
        (data || []).forEach(e => pipelinedIds.add(e.company_id));
      }

      const toDelete = ids.filter(id => !pipelinedIds.has(id));
      const toReset  = ids.filter(id =>  pipelinedIds.has(id));

      // Delete non-pipeline companies in chunks
      for (const batch of chunk(toDelete)) {
        const { error } = await supabase.from('companies').delete().in('id', batch);
        if (error) throw error;
      }

      // Reset scan data for pipeline companies in chunks
      for (const batch of chunk(toReset)) {
        await supabase.from('companies').update({
          scan_date: null, icp_score: null, overall_score: null, icp_tier: null,
          funding_stage: null, employee_count_num: null, summary: null,
          triggers: [], recommended_angle: null, contact_angles: [],
        }).in('id', batch);
      }

      setCompanies(prev =>
        prev
          .filter(c => pipelinedIds.has(c.id))
          .map(c => ({ ...c, scan_date: null, icp_score: null, overall_score: null, icp_tier: null, funding_stage: null, employee_count_num: null, summary: null, triggers: [], recommended_angle: null, contact_angles: [], _error: undefined }))
      );

      if (toReset.length) {
        alert(`Cleared. ${toReset.length} compan${toReset.length === 1 ? 'y' : 'ies'} in your pipeline were kept but their scan data was reset.`);
      }
    } catch (e) {
      alert('Clear failed: ' + e.message);
    }
  }, [companies]);

  // ── Filtering ────────────────────────────────────────────────────────────────

  const applyFilters = (list) => {
    return list.filter(c => {
      if (search && !c.name.toLowerCase().includes(search.toLowerCase())) return false;

      if (filters.series !== 'all') {
        const fs = (c.funding_stage || '').toLowerCase();
        if (filters.series === 'seed'     && !fs.includes('seed'))     return false;
        if (filters.series === 'series_a' && !fs.includes('series a')) return false;
        if (filters.series === 'series_b' && !fs.includes('series b')) return false;
        if (filters.series === 'series_c' && !fs.includes('series c') && !fs.includes('series d')) return false;
      }

      if (filters.employees !== 'all' && c.employee_count_num) {
        const n = c.employee_count_num;
        if (filters.employees === '1_30'   && !(n >= 1   && n < 30))  return false;
        if (filters.employees === '30_100' && !(n >= 30  && n < 100)) return false;
        if (filters.employees === '100_500'&& !(n >= 100 && n < 500)) return false;
        if (filters.employees === '500_plus' && n < 500)              return false;
      }

      if (filters.distance !== 'all' && c.lat && c.lng) {
        const miles = haversineDistance(ANDOVER_LAT, ANDOVER_LNG, c.lat, c.lng);
        const max = parseInt(filters.distance);
        if (miles > max) return false;
      }

      if (filters.icp !== 'all' && c.icp_score) {
        if (parseInt(filters.icp) > c.icp_score) return false;
      }

      return true;
    });
  };

  const sorted = [...companies].sort((a, b) => {
    if (sortBy === 'score') return (b.overall_score || 0) - (a.overall_score || 0);
    if (sortBy === 'icp')   return (b.icp_score || 0)    - (a.icp_score || 0);
    if (sortBy === 'name')  return a.name.localeCompare(b.name);
    if (sortBy === 'distance' && a.lat && b.lat) {
      return haversineDistance(ANDOVER_LAT, ANDOVER_LNG, a.lat, a.lng) -
             haversineDistance(ANDOVER_LAT, ANDOVER_LNG, b.lat, b.lng);
    }
    return 0;
  });

  const filtered = applyFilters(sorted);
  const scanned  = companies.filter(c => c.scan_date).length;
  const hot      = companies.filter(c => (c.overall_score || 0) >= 7).length;
  const added    = Object.values(addedToPipeline).filter(Boolean).length;
  const pct      = scanProgress.total ? Math.round((scanProgress.done / scanProgress.total) * 100) : 0;
  const unscannedCount = companies.filter(c => !c.scan_date && c.id).length;

  const setFilter = (key, val) => setFilters(f => ({ ...f, [key]: val }));

  return (
    <>
      <div className="page-header">
        <div className="page-header-left">
          <h2>📡 Signal Watch</h2>
          <p>Import companies, scan for triggers, add high-value prospects to the pipeline</p>
        </div>
        <div className="page-header-actions">
          {companies.length > 0 && (
            <>
              <select value={sortBy} onChange={e => setSortBy(e.target.value)} style={{ width: 'auto', padding: '7px 10px' }}>
                <option value="score">Sort: Signal Score</option>
                <option value="icp">Sort: ICP Score</option>
                <option value="distance">Sort: Distance</option>
                <option value="name">Sort: Name</option>
              </select>
              {scanningAll ? (
                <button className="btn btn-secondary" onClick={() => { cancelRef.current.cancelled = true; setScanningAll(false); }}>
                  ⏹ Stop
                </button>
              ) : (
                <button className="btn btn-primary" onClick={scanAll} disabled={!unscannedCount}>
                  ⚡ Scan Unscanned ({unscannedCount})
                </button>
              )}
            </>
          )}
          <button className="btn btn-secondary" onClick={() => fileInputRef.current?.click()}>
            📂 Import CSV
          </button>
          {companies.length > 0 && (
            <button className="btn btn-secondary" onClick={exportCSV} title="Download all companies as CSV">
              ⬇️ Export CSV
            </button>
          )}
          {companies.length > 0 && (
            <button className="btn btn-ghost btn-sm" onClick={clearAll} style={{ color: 'var(--red)' }} title="Delete all companies">
              🗑️ Clear All
            </button>
          )}
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv"
            multiple
            style={{ display: 'none' }}
            onChange={e => handleFiles(e.target.files)}
          />
        </div>
      </div>

      <div className="page-body">
        {companies.length > 0 && (
          <div className="stats-row cols-4" style={{ marginBottom: 16 }}>
            <div className="stat-card"><div className="stat-val">{companies.length}</div><div className="stat-label">Total Companies</div></div>
            <div className="stat-card"><div className="stat-val">{scanned}</div><div className="stat-label">Scanned</div></div>
            <div className="stat-card"><div className="stat-val">{hot}</div><div className="stat-label">Score 7+ (Hot)</div></div>
            <div className="stat-card"><div className="stat-val">{added}</div><div className="stat-label">In Pipeline</div></div>
          </div>
        )}

        {scanningAll && (
          <div style={{ marginBottom: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4, fontSize: 12, color: 'var(--text-muted)' }}>
              <span>Scanning… {scanProgress.done} of {scanProgress.total}</span>
              <span>{pct}%</span>
            </div>
            <div className="progress-bar-wrap"><div className="progress-bar" style={{ width: `${pct}%` }} /></div>
          </div>
        )}

        {loading ? (
          <div className="empty-state"><div className="spinner" /><p style={{ marginTop: 12 }}>Loading saved results…</p></div>
        ) : companies.length === 0 ? (
          <div
            className={`drop-zone${dragOver ? ' drag-over' : ''}`}
            onDragOver={e => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={onDrop}
            onClick={() => fileInputRef.current?.click()}
          >
            <div className="drop-icon">📂</div>
            <h4>Drop your CSV here or click to browse</h4>
            <p style={{ marginTop: 6 }}>Supports multiple CSVs at once. Columns: name, website, contact, title, email, hq</p>
          </div>
        ) : (
          <>
            {/* Filters */}
            <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '12px 16px', marginBottom: 16 }}>
              <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'center' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '.04em', whiteSpace: 'nowrap' }}>Series</span>
                  <div style={{ display: 'flex', gap: 4 }}>
                    {[['all','All'],['seed','Seed'],['series_a','Series A'],['series_b','Series B'],['series_c','Series C+']].map(([v,l]) => (
                      <button key={v} className={`filter-btn${filters.series === v ? ' active' : ''}`} style={{ padding: '4px 9px', fontSize: 11 }} onClick={() => setFilter('series', v)}>{l}</button>
                    ))}
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '.04em', whiteSpace: 'nowrap' }}>Employees</span>
                  <div style={{ display: 'flex', gap: 4 }}>
                    {[['all','All'],['1_30','1–30'],['30_100','30–100'],['100_500','100–500'],['500_plus','500+']].map(([v,l]) => (
                      <button key={v} className={`filter-btn${filters.employees === v ? ' active' : ''}`} style={{ padding: '4px 9px', fontSize: 11 }} onClick={() => setFilter('employees', v)}>{l}</button>
                    ))}
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '.04em', whiteSpace: 'nowrap' }}>From Andover MA</span>
                  <div style={{ display: 'flex', gap: 4 }}>
                    {[['all','All'],['50','<50mi'],['100','<100mi'],['250','<250mi'],['500','<500mi']].map(([v,l]) => (
                      <button key={v} className={`filter-btn${filters.distance === v ? ' active' : ''}`} style={{ padding: '4px 9px', fontSize: 11 }} onClick={() => setFilter('distance', v)}>{l}</button>
                    ))}
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '.04em', whiteSpace: 'nowrap' }}>ICP Score</span>
                  <div style={{ display: 'flex', gap: 4 }}>
                    {[['all','All'],['7','7+'],['5','5+'],['3','3+']].map(([v,l]) => (
                      <button key={v} className={`filter-btn${filters.icp === v ? ' active' : ''}`} style={{ padding: '4px 9px', fontSize: 11 }} onClick={() => setFilter('icp', v)}>{l}</button>
                    ))}
                  </div>
                </div>
                <input
                  type="text"
                  placeholder="Search…"
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  style={{ marginLeft: 'auto', width: 160, padding: '5px 10px', fontSize: 12 }}
                />
              </div>
              {(filters.series !== 'all' || filters.employees !== 'all' || filters.distance !== 'all' || filters.icp !== 'all' || search) && (
                <div style={{ marginTop: 8, fontSize: 12, color: 'var(--text-muted)' }}>
                  Showing {filtered.length} of {companies.length} companies &nbsp;
                  <button className="btn btn-ghost btn-xs" onClick={() => { setFilters({ series: 'all', employees: 'all', distance: 'all', icp: 'all' }); setSearch(''); }}>
                    Clear filters
                  </button>
                </div>
              )}
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {filtered.map(company => {
                const key = company.id || company._tempId;
                const distMiles = (company.lat && company.lng)
                  ? Math.round(haversineDistance(ANDOVER_LAT, ANDOVER_LNG, company.lat, company.lng))
                  : null;
                return (
                  <CompanyCard
                    key={key}
                    company={company}
                    distMiles={distMiles}
                    status={scanStatus[key]}
                    isScanning={scanning[key]}
                    isAddingToPipeline={addingToPipeline[key]}
                    isAddedToPipeline={addedToPipeline[company.id]}
                    onScan={() => scanOne(company)}
                    onAddToPipeline={() => addToPipeline(company)}
                    onNavigatePipeline={() => onNavigate('pipeline')}
                    onDelete={() => deleteCompany(company)}
                  />
                );
              })}
            </div>
          </>
        )}
      </div>
    </>
  );
}

function CompanyCard({ company, distMiles, status, isScanning, isAddingToPipeline, isAddedToPipeline, onScan, onAddToPipeline, onNavigatePipeline, onDelete }) {
  const [expanded, setExpanded] = useState(false);
  const hasResult = company.scan_date && !company._error;
  const sc = company.overall_score ? scoreColor(company.overall_score) : null;

  return (
    <div className="card">
      <div className="card-header" style={{ cursor: hasResult ? 'pointer' : 'default' }} onClick={() => hasResult && setExpanded(e => !e)}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flex: 1, minWidth: 0 }}>
          {company.website ? (
            <a href={company.website.startsWith('http') ? company.website : `https://${company.website}`} target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()} style={{ fontWeight: 800, fontSize: 14, color: 'inherit', textDecoration: 'none' }}>{company.name}</a>
          ) : (
            <span style={{ fontWeight: 800, fontSize: 14 }}>{company.name}</span>
          )}
          {company.funding_stage && company.funding_stage !== 'Unknown' && (
            <span className="badge badge-blue" style={{ fontSize: 10 }}>{company.funding_stage}</span>
          )}
          {company.icp_tier && (
            <span className="badge badge-gray" style={{ fontSize: 10 }}>{company.icp_tier}</span>
          )}
          {distMiles !== null && (
            <span style={{ fontSize: 10, color: distMiles < 100 ? 'var(--green)' : 'var(--text-faint)', fontWeight: 600 }}>
              📍 {distMiles}mi
            </span>
          )}
          {company.employee_count_num && (
            <span style={{ fontSize: 10, color: 'var(--text-faint)' }}>👥 {company.employee_count_num}</span>
          )}
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexShrink: 0 }}>
          {hasResult && (
            <>
              <span className="score-badge" style={{ background: sc + '22', color: sc, borderColor: sc }}>{company.overall_score}/10</span>
              {company.icp_score && (
                <span className="score-badge" style={{ background: scoreColor(company.icp_score) + '22', color: scoreColor(company.icp_score), borderColor: scoreColor(company.icp_score) }}>
                  ICP {company.icp_score}/10
                </span>
              )}
            </>
          )}
          {status && (
            <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
              {isScanning && <span className="spinner" style={{ marginRight: 4 }} />}{status}
            </span>
          )}
          <button className="btn btn-secondary btn-sm" onClick={e => { e.stopPropagation(); onScan(); }} disabled={isScanning}>
            {isScanning ? <><span className="spinner" /> Scanning…</> : hasResult ? '🔄 Re-scan' : '🔍 Deep Scan'}
          </button>
          {hasResult && (
            isAddedToPipeline ? (
              <button className="btn btn-ghost btn-sm" onClick={e => { e.stopPropagation(); onNavigatePipeline(); }}>✅ In Pipeline →</button>
            ) : (
              <button className="btn btn-green btn-sm" onClick={e => { e.stopPropagation(); onAddToPipeline(); }} disabled={isAddingToPipeline}>
                {isAddingToPipeline ? <><span className="spinner" /> Adding…</> : '+ Add to Pipeline'}
              </button>
            )
          )}
          <button className="btn btn-ghost btn-xs" onClick={e => { e.stopPropagation(); onDelete(); }} title="Remove" style={{ color: 'var(--text-faint)', padding: '3px 6px' }}>✕</button>
        </div>
      </div>

      {company._error && (
        <div className="card-body" style={{ color: 'var(--red)', fontSize: 12 }}>⚠️ {company._error}</div>
      )}

      {hasResult && expanded && (
        <div className="card-body">
          {company.summary && (
            <p style={{ fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.55, marginBottom: 12 }}>{company.summary}</p>
          )}
          {(company.triggers || []).map((t, i) => (
            <div key={i} style={{ padding: '8px 0', borderBottom: '1px solid var(--border-light)', display: 'flex', flexDirection: 'column', gap: 4 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                <span style={{ background: catColor(t.category) + '22', color: catColor(t.category), border: `1px solid ${catColor(t.category)}44`, fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 4 }}>{catLabel(t.category)}</span>
                <span style={{ fontWeight: 700, fontSize: 12, flex: 1 }}>{t.headline}</span>
                <span style={{ background: urgColor(t.urgency) + '22', color: urgColor(t.urgency), border: `1px solid ${urgColor(t.urgency)}44`, fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 4, fontFamily: 'monospace' }}>{(t.urgency || '').toUpperCase()}</span>
              </div>
              {t.detail && <p style={{ fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.5 }}>{t.detail}</p>}
              {(t.source || t.date) && <p style={{ fontSize: 10, color: 'var(--text-faint)' }}>{[t.source, t.date].filter(Boolean).join(' · ')}</p>}
            </div>
          ))}
          {company.recommended_angle && (
            <div style={{ marginTop: 12, padding: '10px 12px', background: 'var(--green-light)', border: '1px solid var(--green-border)', borderRadius: 'var(--radius-sm)' }}>
              <span style={{ fontSize: 10, fontWeight: 800, color: '#16a34a', letterSpacing: '.08em', textTransform: 'uppercase', marginRight: 6 }}>Outreach Angle</span>
              <span style={{ fontSize: 12, color: '#166534', lineHeight: 1.5 }}>{company.recommended_angle}</span>
            </div>
          )}
          {(company.contact_angles || []).length > 0 && (
            <div style={{ marginTop: 10, padding: '10px 12px', background: 'var(--green-light)', border: '1px solid var(--green-border)', borderRadius: 'var(--radius-sm)' }}>
              <div style={{ fontSize: 10, fontWeight: 800, color: '#16a34a', letterSpacing: '.08em', textTransform: 'uppercase', marginBottom: 8 }}>Angles by Contact</div>
              {company.contact_angles.map((ca, i) => (
                <div key={i} style={{ marginBottom: i < company.contact_angles.length - 1 ? 8 : 0 }}>
                  <span style={{ fontWeight: 800, fontSize: 12, color: '#166534' }}>{ca.name}</span>
                  {ca.title && <span style={{ fontSize: 10, color: '#16a34a', background: '#dcfce7', padding: '1px 6px', borderRadius: 3, fontWeight: 600, marginLeft: 6 }}>{ca.title}</span>}
                  <p style={{ fontSize: 12, color: '#166534', lineHeight: 1.5, marginTop: 3 }}>{ca.angle}</p>
                </div>
              ))}
            </div>
          )}
          {(company.contacts || []).length > 0 && (
            <div style={{ marginTop: 12, borderTop: '1px solid var(--border)', paddingTop: 10 }}>
              <div style={{ fontSize: 10, fontWeight: 800, color: 'var(--text-muted)', letterSpacing: '.08em', textTransform: 'uppercase', marginBottom: 6 }}>Contacts</div>
              {company.contacts.map((ct, i) => (
                <div key={i} style={{ display: 'grid', gridTemplateColumns: '2fr 2fr 3fr', gap: 8, alignItems: 'center', padding: '4px 0' }}>
                  <span style={{ fontWeight: 700, fontSize: 12 }}>{ct.linkedin ? <a href={ct.linkedin} target="_blank" rel="noreferrer" style={{ color: 'var(--accent)' }}>{ct.name}</a> : ct.name}</span>
                  <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{ct.title}</span>
                  <span style={{ fontSize: 11 }}>{ct.email ? <a href={`mailto:${ct.email}`} style={{ color: 'var(--accent)' }}>{ct.email}</a> : ''}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {hasResult && !expanded && (
        <div style={{ padding: '6px 18px', fontSize: 11, color: 'var(--text-faint)', cursor: 'pointer', userSelect: 'none' }} onClick={() => setExpanded(true)}>
          {(company.triggers || []).length} trigger{(company.triggers || []).length !== 1 ? 's' : ''} · Click to expand
        </div>
      )}
    </div>
  );
}
