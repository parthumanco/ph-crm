import { useState, useCallback, useEffect, useRef } from 'react';
import { supabase } from '../lib/supabase';
import { scanBatch, scanDeepDive, weeklyRescanBatch } from '../lib/anthropic';
import { loadLastWeeklyScan, saveLastWeeklyScan, isWeeklyScanDue, markWeeklyScanViewed } from '../lib/settings';

const TRIGGER_CATEGORIES = [
  { id: 'leadership', label: 'Leadership Change', color: '#f59e0b' },
  { id: 'funding',    label: 'Funding / M&A',     color: '#10b981' },
  { id: 'expansion',  label: 'Expansion / Growth', color: '#3b82f6' },
  { id: 'product',    label: 'Product Launch',     color: '#8b5cf6' },
  { id: 'pain',       label: 'Challenges / Pain',  color: '#ef4444' },
  { id: 'hiring',     label: 'Hiring Signals',     color: '#06b6d4' },
  { id: 'social',     label: 'Social Signal',      color: '#ec4899' },
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

const BATCH_SIZE = 5;
const SCAN_DELAY = 3000;
const DEEP_SCAN_DELAY = 6000;

function parseCsvLine(line) {
  const vals = [];
  let i = 0;
  while (i <= line.length) {
    if (line[i] === '"') {
      let val = ''; i++;
      while (i < line.length) {
        if (line[i] === '"' && line[i + 1] === '"') { val += '"'; i += 2; }
        else if (line[i] === '"') { i++; break; }
        else val += line[i++];
      }
      vals.push(val.trim());
      if (line[i] === ',') i++;
    } else {
      const end = line.indexOf(',', i);
      if (end === -1) { vals.push(line.slice(i).trim()); break; }
      vals.push(line.slice(i, end).trim());
      i = end + 1;
    }
  }
  return vals;
}

function parseCSV(text) {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) return [];
  const headers = parseCsvLine(lines[0]).map(h => h.toLowerCase().replace(/[^a-z0-9]/g, '_'));

  return lines.slice(1).map((line, idx) => {
    const vals = parseCsvLine(line);
    const row = {};
    headers.forEach((h, i) => { row[h] = vals[i] || ''; });

    const name = row.name || row.company || row.company_name || row.organization || '';
    const website = row.website || row.url || row.domain || '';
    const contacts = [];
    const firstName = row.first_name || '';
    const lastName  = row.last_name || row.surname || '';
    const fullName  = firstName && lastName ? `${firstName} ${lastName}` : firstName || lastName;
    const contactName     = row.contact || row.contact_name || fullName || '';
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
  const [sortBy, setSortBy]           = useState('icp');
  const [addingToPipeline, setAddingToPipeline] = useState({});
  const [addedToPipeline, setAddedToPipeline]   = useState({});
  const [loading, setLoading]         = useState(true);
  const [importing, setImporting]     = useState(false);
  const [autoResume, setAutoResume]   = useState(false);
  const [filters, setFilters] = useState({
    series: 'all',
    employees: 'all',
    distance: 'all',
    icp: 'all',
    sig: 'all',
  });
  const [autoDeepQueue, setAutoDeepQueue]           = useState([]);
  const [autoDeepProgress, setAutoDeepProgress]     = useState({ done: 0, total: 0 });
  const [weeklyScanDue, setWeeklyScanDue]           = useState(false);
  const [weeklyScanRunning, setWeeklyScanRunning]   = useState(false);
  const [weeklyScanProgress, setWeeklyScanProgress] = useState({ done: 0, total: 0 });
  const [weeklyScanChanges, setWeeklyScanChanges]   = useState([]);
  const [lastWeeklyScan, setLastWeeklyScan]         = useState(null);
  const [serverScanNotification, setServerScanNotification] = useState(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [addForm, setAddForm] = useState({ name: '', website: '', hq: '' });
  const [addingManual, setAddingManual] = useState(false);
  const cancelRef        = useRef({ cancelled: false });
  const fileInputRef     = useRef();
  const companiesRef     = useRef([]);
  const autoDeepRunning  = useRef(false);
  const [activeScanId, setActiveScanId] = useState(null);
  const [expandedCards, setExpandedCards] = useState({});
  const cardRefs = useRef({});

  // Keep companiesRef in sync so async callbacks can read latest state
  useEffect(() => { companiesRef.current = companies; }, [companies]);

  // ── Load saved results from Supabase on mount ────────────────────────────────

  useEffect(() => {
    async function load() {
      setLoading(true);
      // Paginate past Supabase's 1000-row default limit
      let allData = [];
      const PAGE = 1000;
      let from = 0;
      while (true) {
        const { data, error } = await supabase
          .from('companies')
          .select('*')
          .order('scan_date', { ascending: false, nullsFirst: false })
          .range(from, from + PAGE - 1);
        if (error || !data?.length) break;
        allData = allData.concat(data);
        if (data.length < PAGE) break;
        from += PAGE;
      }
      if (allData.length) {
        const { data: pipelineEntries } = await supabase.from('pipeline_entries').select('company_id');
        const inPipeline = new Set((pipelineEntries || []).map(e => e.company_id));
        const loaded = allData.map(c => ({ ...c, _key: c.id }));
        setCompanies(loaded);
        const alreadyAdded = {};
        loaded.forEach(c => { if (inPipeline.has(c.id)) alreadyAdded[c.id] = true; });
        setAddedToPipeline(alreadyAdded);
        if (localStorage.getItem('ph_scan_active')) setAutoResume(true);
      }
      const lastScan = await loadLastWeeklyScan();
      setLastWeeklyScan(lastScan);
      if (isWeeklyScanDue(lastScan)) setWeeklyScanDue(true);
      // Show notification if edge function ran while app was closed
      if (lastScan?.viewed === false && lastScan?.changes?.length > 0) {
        setServerScanNotification(lastScan);
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

      // Deduplicate within the CSV: merge contacts for same company name
      const mergedMap = new Map();
      for (const c of allParsed) {
        const key = c.name.toLowerCase().trim();
        if (mergedMap.has(key)) {
          const existing = mergedMap.get(key);
          // Merge contacts, skip duplicates by name
          const existingNames = new Set(existing.contacts.map(ct => ct.name.toLowerCase()));
          for (const ct of c.contacts) {
            if (ct.name && !existingNames.has(ct.name.toLowerCase())) {
              existing.contacts.push(ct);
              existingNames.add(ct.name.toLowerCase());
            }
          }
          // Fill in missing fields from later rows
          if (!existing.website && c.website) existing.website = c.website;
          if (!existing.hq && c.hq) existing.hq = c.hq;
        } else {
          mergedMap.set(key, { ...c, contacts: [...c.contacts] });
        }
      }
      const deduped = Array.from(mergedMap.values());

      // Fetch ALL existing companies from DB with their contacts
      let existingRows = [];
      let from = 0;
      while (true) {
        const { data, error } = await supabase.from('companies').select('id, name, contacts').range(from, from + 999);
        if (error || !data?.length) break;
        existingRows = existingRows.concat(data);
        if (data.length < 1000) break;
        from += 1000;
      }
      const existingMap = new Map(existingRows.map(c => [c.name.toLowerCase().trim(), c]));

      const toInsert = deduped.filter(c => !existingMap.has(c.name.toLowerCase().trim()));
      const toMergeContacts = deduped.filter(c => existingMap.has(c.name.toLowerCase().trim()));

      // Always merge new contacts into existing companies
      let mergedContactCount = 0;
      for (const c of toMergeContacts) {
        const existing = existingMap.get(c.name.toLowerCase().trim());
        const existingContacts = existing.contacts || [];
        const existingNames = new Set(existingContacts.map(ct => ct.name?.toLowerCase()));
        const newContacts = c.contacts.filter(ct => ct.name && !existingNames.has(ct.name.toLowerCase()));
        if (newContacts.length > 0) {
          const merged = [...existingContacts, ...newContacts];
          await supabase.from('companies').update({ contacts: merged }).eq('id', existing.id);
          setCompanies(prev => prev.map(co => co.id === existing.id ? { ...co, contacts: merged } : co));
          mergedContactCount += newContacts.length;
        }
      }

      // Ask about resetting scan data for existing companies
      let resetCount = 0;
      if (toMergeContacts.length > 0) {
        const shouldReset = window.confirm(
          `${toMergeContacts.length} compan${toMergeContacts.length === 1 ? 'y' : 'ies'} already exist${mergedContactCount > 0 ? ` (${mergedContactCount} new contact${mergedContactCount === 1 ? '' : 's'} merged)` : ''}.\n\nClick OK to reset their scan data so they'll be re-evaluated.\nClick Cancel to keep existing scan data.`
        );
        if (shouldReset) {
          const resetIds = toMergeContacts.map(c => existingMap.get(c.name.toLowerCase().trim()).id);
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

      if (!toInsert.length && resetCount === 0 && mergedContactCount === 0) return;

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
      if (mergedContactCount) parts.push(`${mergedContactCount} new contact${mergedContactCount === 1 ? '' : 's'} merged into existing companies`);
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

  const saveScanResult = useCallback(async (companyId, result, overwriteWebsite = false) => {
    const update = {
      icp_tier: result.icpTier || null,
      icp_score: result.icpScore ? Math.round(result.icpScore) : null,
      overall_score: result.overallScore ? Math.round(result.overallScore) : null,
      funding_stage: result.fundingStage || null,
      employee_count_num: result.employeeCountNum ? Math.round(result.employeeCountNum) : null,
      employee_count: result.employeeCountNum ? String(Math.round(result.employeeCountNum)) : null,
      summary: result.summary || null,
      triggers: result.triggers || [],
      recommended_angle: result.recommendedAngle || null,
      contact_angles: result.contactAngles || [],
      lat: result.lat || null,
      lng: result.lng || null,
      scan_date: new Date().toISOString(),
      ...(overwriteWebsite ? { deep_scanned: true } : {}),
      // Deep scan always saves website; batch scan skips (low-confidence guesses)
      ...(result.website && overwriteWebsite ? { website: result.website } : {}),
    };
    const { error } = await supabase.from('companies').update(update).eq('id', companyId);
    if (error) throw new Error(error.message);
    setCompanies(prev => prev.map(c => c.id === companyId ? { ...c, ...update } : c));
  }, []);

  // ── Single deep scan ─────────────────────────────────────────────────────────

  const scanOne = useCallback(async (company) => {
    const key = company.id || company._tempId;
    setActiveScanId(key);
    setScanning(s => ({ ...s, [key]: true }));
    setScanStatus(s => ({ ...s, [key]: 'Searching the web…' }));
    try {
      const result = await scanDeepDive(company, icp);
      if (company.id) await saveScanResult(company.id, result, true);
      setScanStatus(s => ({ ...s, [key]: 'Done' }));
    } catch (e) {
      setCompanies(prev => prev.map(c => (c.id || c._tempId) === key ? { ...c, _error: e.message } : c));
      setScanStatus(s => ({ ...s, [key]: 'Error' }));
    } finally {
      setScanning(s => ({ ...s, [key]: false }));
      setActiveScanId(null);
    }
  }, [saveScanResult, icp]);

  // ── Batch scan all ───────────────────────────────────────────────────────────

  const scanAll = useCallback(async () => {
    const unscanned = companies.filter(c => !c.scan_date && !c._error && c.id);
    if (!unscanned.length) { localStorage.removeItem('ph_scan_active'); return; }
    cancelRef.current = { cancelled: false };
    localStorage.setItem('ph_scan_active', 'true');
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
          // Match by index first, fall back to name match (handles partial recovery)
          const r = batchResults[i]?.companyName
            ? batchResults.find(x => x.companyName?.toLowerCase() === batch[i].name.toLowerCase()) || batchResults[i]
            : batchResults[i];
          if (!r) {
            // No result for this company — leave unscanned so it can be retried
            setScanStatus(s => ({ ...s, [batch[i].id]: 'Retry next scan' }));
            continue;
          }
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
    localStorage.removeItem('ph_scan_active');
    setScanningAll(false);
  }, [companies, saveScanResult, icp]);

  // ── Auto-resume scan after page refresh ─────────────────────────────────────
  useEffect(() => {
    if (autoResume && !loading) {
      setAutoResume(false);
      scanAll();
    }
  }, [autoResume, loading, scanAll]);

  // ── Auto deep scan queue ─────────────────────────────────────────────────────

  const scanOneRef = useRef(null);
  useEffect(() => { scanOneRef.current = scanOne; }, [scanOne]);

  useEffect(() => {
    if (autoDeepQueue.length === 0 || autoDeepRunning.current) return;
    autoDeepRunning.current = true;
    let idx = 0;
    async function processNext() {
      while (idx < autoDeepQueue.length && !cancelRef.current.cancelled) {
        await scanOneRef.current(autoDeepQueue[idx]);
        idx++;
        setAutoDeepProgress(p => ({ ...p, done: idx }));
        if (idx < autoDeepQueue.length && !cancelRef.current.cancelled) {
          await new Promise(r => setTimeout(r, DEEP_SCAN_DELAY));
        }
      }
      autoDeepRunning.current = false;
      setAutoDeepQueue([]);
    }
    processNext();
  }, [autoDeepQueue]);

  // ── Weekly rescan ────────────────────────────────────────────────────────────

  const runWeeklyRescan = useCallback(async () => {
    const toScan = companiesRef.current.filter(c => c.scan_date && c.id);
    if (!toScan.length) return;
    setWeeklyScanRunning(true);
    setWeeklyScanDue(false);
    setWeeklyScanChanges([]);
    setWeeklyScanProgress({ done: 0, total: toScan.length });
    cancelRef.current = { cancelled: false };

    const batches = [];
    for (let i = 0; i < toScan.length; i += BATCH_SIZE) batches.push(toScan.slice(i, i + BATCH_SIZE));

    let done = 0;
    const changes = [];

    for (const batch of batches) {
      if (cancelRef.current.cancelled) break;
      try {
        const results = await weeklyRescanBatch(batch, icp);
        for (let i = 0; i < batch.length; i++) {
          const r = results[i]?.companyName
            ? results.find(x => x.companyName?.toLowerCase() === batch[i].name.toLowerCase()) || results[i]
            : results[i];
          if (!r) continue;
          const prev = batch[i];
          const sigDelta = (r.overallScore || 0) - (prev.overall_score || 0);
          const icpDelta = (r.icpScore || 0) - (prev.icp_score || 0);
          if (sigDelta >= 2 || icpDelta >= 2) {
            changes.push({ company: batch[i], sigDelta, icpDelta, newSig: r.overallScore, newIcp: r.icpScore });
          }
          // Save updated scores + new triggers, don't overwrite website or deep_scanned
          await saveScanResult(batch[i].id, {
            ...r,
            icpTier: r.icpTier || prev.icp_tier,
            fundingStage: r.fundingStage || prev.funding_stage,
            employeeCountNum: r.employeeCountNum || prev.employee_count_num,
            recommendedAngle: r.recommendedAngle || prev.recommended_angle,
            contactAngles: r.contactAngles || prev.contact_angles || [],
            lat: r.lat || prev.lat,
            lng: r.lng || prev.lng,
          }, false);
        }
      } catch { /* skip failed batch, continue */ }
      done += batch.length;
      setWeeklyScanProgress({ done, total: toScan.length });
      if (done < toScan.length && !cancelRef.current.cancelled) await new Promise(r => setTimeout(r, SCAN_DELAY));
    }

    setWeeklyScanChanges(changes);
    setWeeklyScanRunning(false);
    await saveLastWeeklyScan();
    setLastWeeklyScan({ timestamp: new Date().toISOString() });

    // Queue changed high-scorers for deep scan
    if (!cancelRef.current.cancelled) {
      const toDeepScan = changes
        .filter(ch => (ch.newSig >= 7 || ch.newIcp >= 7) && !ch.company.deep_scanned)
        .map(ch => ch.company);
      if (toDeepScan.length > 0) {
        setAutoDeepQueue(toDeepScan);
        setAutoDeepProgress({ done: 0, total: toDeepScan.length });
      }
    }
  }, [icp, saveScanResult]);

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

  // ── Manual add ───────────────────────────────────────────────────────────────

  const addManualCompany = useCallback(async () => {
    const name = addForm.name.trim();
    if (!name) return;
    const existing = companiesRef.current.find(c => c.name.toLowerCase() === name.toLowerCase());
    if (existing) { alert(`${name} is already in Signal Watch.`); return; }
    setAddingManual(true);
    try {
      const { data, error } = await supabase.from('companies').insert({
        name,
        website: addForm.website.trim() || null,
        hq: addForm.hq.trim() || null,
        contacts: [],
      }).select('*').single();
      if (error) throw error;
      setCompanies(prev => [data, ...prev]);
      setAddForm({ name: '', website: '', hq: '' });
      setShowAddForm(false);
    } catch (e) {
      alert('Error adding company: ' + e.message);
    } finally {
      setAddingManual(false);
    }
  }, [addForm]);

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
      const CHUNK = 100;
      const chunk = (arr) => { const out = []; for (let i = 0; i < arr.length; i += CHUNK) out.push(arr.slice(i, i + CHUNK)); return out; };

      // Fetch ALL company IDs from DB (not from React state, which may be capped)
      let allIds = [];
      let from = 0;
      while (true) {
        const { data, error } = await supabase.from('companies').select('id').range(from, from + 999);
        if (error || !data?.length) break;
        allIds = allIds.concat(data.map(c => c.id));
        if (data.length < 1000) break;
        from += 1000;
      }
      if (!allIds.length) { setCompanies([]); return; }

      // Find which are in the pipeline
      const pipelinedIds = new Set();
      for (const batch of chunk(allIds)) {
        const { data } = await supabase.from('pipeline_entries').select('company_id').in('company_id', batch);
        (data || []).forEach(e => pipelinedIds.add(e.company_id));
      }

      const toDelete = allIds.filter(id => !pipelinedIds.has(id));
      const toReset  = allIds.filter(id =>  pipelinedIds.has(id));

      for (const batch of chunk(toDelete)) {
        const { error } = await supabase.from('companies').delete().in('id', batch);
        if (error) throw error;
      }

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
  }, []);

  // ── Start fresh (wipe everything) ───────────────────────────────────────────

  const startFresh = useCallback(async () => {
    if (!window.confirm('Clear all companies from Signal Watch and start over? Companies in your pipeline will not be deleted.')) return;
    try {
      cancelRef.current.cancelled = true;
      setScanningAll(false);
      localStorage.removeItem('ph_scan_active');

      const CHUNK = 100;
      const chunk = (arr) => { const out = []; for (let i = 0; i < arr.length; i += CHUNK) out.push(arr.slice(i, i + CHUNK)); return out; };

      let allIds = [];
      let from = 0;
      while (true) {
        const { data, error } = await supabase.from('companies').select('id').range(from, from + 999);
        if (error || !data?.length) break;
        allIds = allIds.concat(data.map(c => c.id));
        if (data.length < 1000) break;
        from += 1000;
      }
      if (!allIds.length) { setCompanies([]); return; }

      const pipelinedIds = new Set();
      for (const batch of chunk(allIds)) {
        const { data } = await supabase.from('pipeline_entries').select('company_id').in('company_id', batch);
        (data || []).forEach(e => pipelinedIds.add(e.company_id));
      }

      const toDelete = allIds.filter(id => !pipelinedIds.has(id));
      const toReset  = allIds.filter(id =>  pipelinedIds.has(id));

      for (const batch of chunk(toDelete)) {
        const { error } = await supabase.from('companies').delete().in('id', batch);
        if (error) throw error;
      }
      for (const batch of chunk(toReset)) {
        await supabase.from('companies').update({
          scan_date: null, icp_score: null, overall_score: null, icp_tier: null,
          funding_stage: null, employee_count_num: null, summary: null,
          triggers: [], recommended_angle: null, contact_angles: [],
        }).in('id', batch);
      }

      setCompanies(prev =>
        prev.filter(c => pipelinedIds.has(c.id))
          .map(c => ({ ...c, scan_date: null, icp_score: null, overall_score: null, icp_tier: null, funding_stage: null, employee_count_num: null, summary: null, triggers: [], recommended_angle: null, contact_angles: [], _error: undefined }))
      );
      setAddedToPipeline({});
      setScanStatus({});
    } catch (e) {
      alert('Start Fresh failed: ' + e.message);
    }
  }, []);

  // ── Filtering ────────────────────────────────────────────────────────────────

  const applyFilters = (list, pinId = null) => {
    return list.filter(c => {
      // Never filter out the company currently being deep-scanned
      if (pinId && (c.id || c._tempId) === pinId) return true;
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

      if (filters.sig !== 'all' && c.overall_score) {
        if (parseInt(filters.sig) > c.overall_score) return false;
      }

      return true;
    });
  };

  const sorted = [...companies].sort((a, b) => {
    // Pin the actively deep-scanning company to the top always
    const aKey = a.id || a._tempId;
    const bKey = b.id || b._tempId;
    if (aKey === activeScanId) return -1;
    if (bKey === activeScanId) return 1;
    if (sortBy === 'score') return (b.overall_score || 0) - (a.overall_score || 0);
    if (sortBy === 'icp')   return (b.icp_score || 0)    - (a.icp_score || 0);
    if (sortBy === 'name')  return a.name.localeCompare(b.name);
    if (sortBy === 'distance' && a.lat && b.lat) {
      return haversineDistance(ANDOVER_LAT, ANDOVER_LNG, a.lat, a.lng) -
             haversineDistance(ANDOVER_LAT, ANDOVER_LNG, b.lat, b.lng);
    }
    return 0;
  });

  const filtered = applyFilters(sorted, activeScanId);
  const scanned  = companies.filter(c => c.scan_date).length;
  const hot      = companies.filter(c => (c.overall_score || 0) >= 7).length;
  const added    = Object.values(addedToPipeline).filter(Boolean).length;
  const pct      = scanProgress.total ? Math.round((scanProgress.done / scanProgress.total) * 100) : 0;
  const unscannedCount = companies.filter(c => !c.scan_date && c.id).length;
  const isResuming = unscannedCount > 0 && scanned > 0;

  const setFilter = (key, val) => setFilters(f => ({ ...f, [key]: val }));

  const jumpToCompany = (name) => {
    const company = companiesRef.current.find(c => c.name.toLowerCase() === name.toLowerCase());
    if (!company) return;
    const id = company.id || company._tempId;
    setExpandedCards(prev => ({ ...prev, [id]: true }));
    // Clear filters so the card is visible
    setFilters({ series: 'all', employees: 'all', distance: 'all', icp: 'all', sig: 'all' });
    setSearch('');
    setTimeout(() => {
      cardRefs.current[id]?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 100);
  };

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
              {(scanningAll || autoDeepQueue.length > 0) && (
                <button className="btn btn-secondary" onClick={() => { cancelRef.current.cancelled = true; setScanningAll(false); setAutoDeepQueue([]); autoDeepRunning.current = false; localStorage.removeItem('ph_scan_active'); }}>
                  ⏹ Stop
                </button>
              )}
              <button className="btn btn-primary" onClick={scanAll} disabled={scanningAll || !unscannedCount}>
                {unscannedCount ? `▶ Resume Scan (${unscannedCount} left)` : '✅ All Scanned'}
              </button>
              <button
                className="btn btn-secondary"
                disabled={autoDeepQueue.length > 0 || scanningAll}
                onClick={() => {
                  const toDeep = companiesRef.current
                    .filter(c => c.scan_date && !c.deep_scanned && !c._error && c.id)
                    .sort((a, b) => Math.max(b.overall_score || 0, b.icp_score || 0) - Math.max(a.overall_score || 0, a.icp_score || 0));
                  if (!toDeep.length) { alert('All companies have already been deep scanned.'); return; }
                  cancelRef.current = { cancelled: false };
                  setAutoDeepQueue(toDeep);
                  setAutoDeepProgress({ done: 0, total: toDeep.length });
                }}
              >
                🔍 Deep Scan All
              </button>
            </>
          )}
          <button className="btn btn-secondary" onClick={() => setShowAddForm(v => !v)}>
            ➕ Add Company
          </button>
          <button className="btn btn-secondary" onClick={() => fileInputRef.current?.click()}>
            📂 Import CSV
          </button>
          {companies.length > 0 && (
            <button className="btn btn-secondary" onClick={exportCSV} title="Download all companies as CSV">
              ⬇️ Export CSV
            </button>
          )}
          {companies.length > 0 && (
            <button className="btn btn-ghost btn-sm" onClick={clearAll} style={{ color: 'var(--red)' }} title="Delete Signal Watch companies (keeps pipeline)">
              🗑️ Clear All
            </button>
          )}
          <button className="btn btn-ghost btn-sm" onClick={startFresh} style={{ color: 'var(--red)', fontWeight: 700 }} title="Wipe everything and start over">
            ⚠️ Start Fresh
          </button>
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
        {showAddForm && (
          <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '16px', marginBottom: 16, display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap' }}>
            <div style={{ flex: 2, minWidth: 160 }}>
              <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '.04em', display: 'block', marginBottom: 4 }}>Company Name *</label>
              <input
                type="text"
                placeholder="e.g. Skillcat"
                value={addForm.name}
                onChange={e => setAddForm(f => ({ ...f, name: e.target.value }))}
                onKeyDown={e => e.key === 'Enter' && addManualCompany()}
                autoFocus
              />
            </div>
            <div style={{ flex: 3, minWidth: 200 }}>
              <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '.04em', display: 'block', marginBottom: 4 }}>Website</label>
              <input
                type="text"
                placeholder="e.g. https://www.skillcatapp.com"
                value={addForm.website}
                onChange={e => setAddForm(f => ({ ...f, website: e.target.value }))}
                onKeyDown={e => e.key === 'Enter' && addManualCompany()}
              />
            </div>
            <div style={{ flex: 2, minWidth: 140 }}>
              <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '.04em', display: 'block', marginBottom: 4 }}>HQ / City</label>
              <input
                type="text"
                placeholder="e.g. Boston, MA"
                value={addForm.hq}
                onChange={e => setAddForm(f => ({ ...f, hq: e.target.value }))}
                onKeyDown={e => e.key === 'Enter' && addManualCompany()}
              />
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn btn-primary" onClick={addManualCompany} disabled={!addForm.name.trim() || addingManual}>
                {addingManual ? <><span className="spinner" /> Adding…</> : '+ Add'}
              </button>
              <button className="btn btn-ghost btn-sm" onClick={() => { setShowAddForm(false); setAddForm({ name: '', website: '', hq: '' }); }}>Cancel</button>
            </div>
          </div>
        )}

        {companies.length > 0 && (
          <div className="stats-row cols-4" style={{ marginBottom: 16 }}>
            <div className="stat-card"><div className="stat-val">{companies.length}</div><div className="stat-label">Total Companies</div></div>
            <div className="stat-card"><div className="stat-val">{scanned}</div><div className="stat-label">Scanned</div></div>
            <div className="stat-card"><div className="stat-val">{hot}</div><div className="stat-label">Score 7+ (Hot)</div></div>
            <div className="stat-card"><div className="stat-val">{added}</div><div className="stat-label">In Pipeline</div></div>
          </div>
        )}

        {!scanningAll && isResuming && (
          <div className="alert alert-info" style={{ marginBottom: 16 }}>
            <span>▶</span>
            <span><strong>{scanned} of {companies.length} already scanned</strong> — click Resume Scan to continue from where you left off. Already-scanned companies will not be re-scanned.</span>
          </div>
        )}

        {scanningAll && (
          <div style={{ marginBottom: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4, fontSize: 12, color: 'var(--text-muted)' }}>
              <span>Scanning… {scanned} of {companies.length} total ({scanProgress.done} this session)</span>
              <span>{pct}%</span>
            </div>
            <div className="progress-bar-wrap"><div className="progress-bar" style={{ width: `${pct}%` }} /></div>
          </div>
        )}

        {autoDeepQueue.length > 0 && (
          <div style={{ marginBottom: 16, padding: '10px 14px', background: '#fef9c3', border: '1px solid #fde047', borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span className="spinner" />
              <span style={{ fontSize: 13, fontWeight: 600, color: '#854d0e' }}>
                Auto deep scanning all companies, highest score first… {autoDeepProgress.done}/{autoDeepProgress.total}
              </span>
            </div>
            <button className="btn btn-ghost btn-xs" style={{ color: '#854d0e' }} onClick={() => { cancelRef.current.cancelled = true; setAutoDeepQueue([]); autoDeepRunning.current = false; }}>
              Stop
            </button>
          </div>
        )}

        {!scanningAll && !autoDeepQueue.length && autoDeepProgress.total > 0 && (
          <div className="alert alert-info" style={{ marginBottom: 16 }}>
            <span>✅</span>
            <span>Auto deep scan complete — {autoDeepProgress.done} of {autoDeepProgress.total} companies deep scanned.</span>
          </div>
        )}

        {/* Server-side weekly scan notification (edge function ran while app was closed) */}
        {serverScanNotification && (
          <div style={{ marginBottom: 16, padding: '12px 16px', background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 6 }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 700, fontSize: 13, color: '#15803d', marginBottom: 4 }}>
                  📅 Sunday Night Scan — {serverScanNotification.changes.length} compan{serverScanNotification.changes.length === 1 ? 'y' : 'ies'} with new signals
                </div>
                <div style={{ fontSize: 11, color: '#16a34a', marginBottom: 8 }}>
                  {serverScanNotification.scanned} companies scanned on {new Date(serverScanNotification.timestamp).toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })}
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {serverScanNotification.changes.map((ch, i) => (
                    <div key={i} style={{ fontSize: 12, color: '#166534', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      <button onClick={() => jumpToCompany(ch.name)} style={{ fontWeight: 700, background: 'none', border: 'none', padding: 0, color: '#15803d', cursor: 'pointer', textDecoration: 'underline', fontSize: 12 }}>{ch.name}</button>
                      {ch.sigDelta >= 2 && <span style={{ background: '#dcfce7', padding: '1px 6px', borderRadius: 3, fontWeight: 600 }}>SIG +{ch.sigDelta} → {ch.newSig}</span>}
                      {ch.icpDelta >= 2 && <span style={{ background: '#dcfce7', padding: '1px 6px', borderRadius: 3, fontWeight: 600 }}>ICP +{ch.icpDelta} → {ch.newIcp}</span>}
                      {ch.topTrigger && <span style={{ color: '#15803d', fontStyle: 'italic' }}>{ch.topTrigger}</span>}
                    </div>
                  ))}
                </div>
              </div>
              <button
                className="btn btn-ghost btn-xs"
                style={{ color: '#15803d', flexShrink: 0 }}
                onClick={() => {
                  setServerScanNotification(null);
                  markWeeklyScanViewed();
                }}
              >
                ✕ Dismiss
              </button>
            </div>
          </div>
        )}

        {/* Weekly rescan banners */}
        {weeklyScanDue && !weeklyScanRunning && !scanningAll && companies.filter(c => c.scan_date).length > 0 && (
          <div style={{ marginBottom: 16, padding: '12px 16px', background: '#fff7ed', border: '1px solid #fed7aa', borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
            <div>
              <div style={{ fontWeight: 700, fontSize: 13, color: '#9a3412' }}>📅 Weekly Rescan Due</div>
              <div style={{ fontSize: 12, color: '#c2410c', marginTop: 2 }}>
                {lastWeeklyScan
                  ? `Last run ${Math.floor((Date.now() - new Date(lastWeeklyScan?.timestamp || lastWeeklyScan).getTime()) / 86400000)} days ago.`
                  : 'Never run.'} Re-checks all companies for new hires, funding, and news that could change their score.
              </div>
            </div>
            <button className="btn btn-primary btn-sm" style={{ background: '#ea580c', borderColor: '#ea580c', whiteSpace: 'nowrap' }} onClick={runWeeklyRescan}>
              🔄 Run Weekly Rescan
            </button>
          </div>
        )}

        {weeklyScanRunning && (
          <div style={{ marginBottom: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4, fontSize: 12, color: 'var(--text-muted)' }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}><span className="spinner" /> Weekly rescan — checking for new signals… {weeklyScanProgress.done}/{weeklyScanProgress.total}</span>
              <button className="btn btn-ghost btn-xs" onClick={() => { cancelRef.current.cancelled = true; setWeeklyScanRunning(false); }}>Stop</button>
            </div>
            <div className="progress-bar-wrap">
              <div className="progress-bar" style={{ width: `${weeklyScanProgress.total ? Math.round((weeklyScanProgress.done / weeklyScanProgress.total) * 100) : 0}%`, background: '#ea580c' }} />
            </div>
          </div>
        )}

        {!weeklyScanRunning && weeklyScanChanges.length > 0 && (
          <div style={{ marginBottom: 16, padding: '12px 16px', background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 6 }}>
            <div style={{ fontWeight: 700, fontSize: 13, color: '#15803d', marginBottom: 8 }}>
              ✅ Weekly rescan complete — {weeklyScanChanges.length} compan{weeklyScanChanges.length === 1 ? 'y' : 'ies'} with score increases
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {weeklyScanChanges.map((ch, i) => (
                <div key={i} style={{ fontSize: 12, color: '#166534', display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontWeight: 700 }}>{ch.company.name}</span>
                  {ch.sigDelta >= 2 && <span style={{ background: '#dcfce7', padding: '1px 6px', borderRadius: 3, fontWeight: 600 }}>SIG +{ch.sigDelta} → {ch.newSig}</span>}
                  {ch.icpDelta >= 2 && <span style={{ background: '#dcfce7', padding: '1px 6px', borderRadius: 3, fontWeight: 600 }}>ICP +{ch.icpDelta} → {ch.newIcp}</span>}
                </div>
              ))}
            </div>
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
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '.04em', whiteSpace: 'nowrap' }}>SIG Score</span>
                  <div style={{ display: 'flex', gap: 4 }}>
                    {[['all','All'],['7','7+'],['5','5+'],['3','3+']].map(([v,l]) => (
                      <button key={v} className={`filter-btn${filters.sig === v ? ' active' : ''}`} style={{ padding: '4px 9px', fontSize: 11 }} onClick={() => setFilter('sig', v)}>{l}</button>
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
              {(filters.series !== 'all' || filters.employees !== 'all' || filters.distance !== 'all' || filters.icp !== 'all' || filters.sig !== 'all' || search) && (
                <div style={{ marginTop: 8, fontSize: 12, color: 'var(--text-muted)' }}>
                  Showing {filtered.length} of {companies.length} companies &nbsp;
                  <button className="btn btn-ghost btn-xs" onClick={() => { setFilters({ series: 'all', employees: 'all', distance: 'all', icp: 'all', sig: 'all' }); setSearch(''); }}>
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
                    forceExpanded={expandedCards[key]}
                    onExpandedChange={(val) => setExpandedCards(prev => ({ ...prev, [key]: val }))}
                    cardRef={el => { cardRefs.current[key] = el; }}
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

function CompanyCard({ company, distMiles, status, isScanning, isAddingToPipeline, isAddedToPipeline, onScan, onAddToPipeline, onNavigatePipeline, onDelete, forceExpanded, onExpandedChange, cardRef }) {
  const [expanded, setExpanded] = useState(false);
  const hasResult = company.scan_date && !company._error;

  useEffect(() => {
    if (forceExpanded) setExpanded(true);
  }, [forceExpanded]);

  const handleSetExpanded = (val) => {
    setExpanded(val);
    onExpandedChange?.(val);
  };
  const sc = company.overall_score ? scoreColor(company.overall_score) : null;

  return (
    <div className="card" ref={cardRef}>
      <div className="card-header" style={{ cursor: hasResult ? 'pointer' : 'default' }} onClick={() => hasResult && handleSetExpanded(!expanded)}>
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
              <span className="score-badge" style={{ background: sc + '22', color: sc, borderColor: sc }}>SIG {company.overall_score}/10</span>
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
          <button
            className="btn btn-sm"
            style={company.deep_scanned ? { background: '#fef08a', color: '#854d0e', border: '1px solid #fde047' } : {}}
            onClick={e => { e.stopPropagation(); onScan(); }}
            disabled={isScanning}
          >
            {isScanning ? <><span className="spinner" /> Scanning…</> : '🔍 Deep Scan'}
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
        <div className="card-body" style={{ paddingTop: 16 }}>

          {/* Summary + meta row */}
          <div style={{ display: 'flex', gap: 16, marginBottom: 16, flexWrap: 'wrap' }}>
            {company.summary && (
              <p style={{ flex: 1, minWidth: 200, fontSize: 13, color: 'var(--text)', lineHeight: 1.6, margin: 0 }}>{company.summary}</p>
            )}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12, color: 'var(--text-muted)', minWidth: 140 }}>
              {company.hq && <span>📍 {company.hq}</span>}
              {company.funding_stage && company.funding_stage !== 'Unknown' && <span>💰 {company.funding_stage}</span>}
              {company.employee_count_num && <span>👥 {company.employee_count_num} employees</span>}
              {company.website && (
                <a href={company.website.startsWith('http') ? company.website : `https://${company.website}`} target="_blank" rel="noreferrer" style={{ color: 'var(--accent)' }}>
                  🌐 {company.website.replace(/https?:\/\//, '')}
                </a>
              )}
            </div>
          </div>

          {/* Trigger events */}
          {(company.triggers || []).length > 0 && (
            <div style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 11, fontWeight: 800, color: 'var(--text-muted)', letterSpacing: '.06em', textTransform: 'uppercase', marginBottom: 8 }}>
                Trigger Events
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {(company.triggers || []).map((t, i) => (
                  <div key={i} style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 6, padding: '10px 12px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: t.detail ? 6 : 0, flexWrap: 'wrap' }}>
                      <span style={{ background: catColor(t.category) + '22', color: catColor(t.category), border: `1px solid ${catColor(t.category)}44`, fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 4, whiteSpace: 'nowrap' }}>{catLabel(t.category)}</span>
                      <span style={{ fontWeight: 700, fontSize: 13, flex: 1 }}>{t.headline}</span>
                      <span style={{ background: urgColor(t.urgency) + '18', color: urgColor(t.urgency), border: `1px solid ${urgColor(t.urgency)}44`, fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 4, fontFamily: 'monospace', whiteSpace: 'nowrap' }}>{(t.urgency || '').toUpperCase()}</span>
                    </div>
                    {t.detail && <p style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.55, margin: 0 }}>{t.detail}</p>}
                    {(t.source || t.date) && (
                      <p style={{ fontSize: 11, color: 'var(--text-faint)', marginTop: 4, marginBottom: 0 }}>
                        {t.date && <span>{t.date}</span>}
                        {t.date && t.source && <span> · </span>}
                        {t.source && <span>{t.source}</span>}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Outreach angle */}
          {company.recommended_angle && (
            <div style={{ marginBottom: 12, padding: '12px 14px', background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 6 }}>
              <div style={{ fontSize: 11, fontWeight: 800, color: '#15803d', letterSpacing: '.06em', textTransform: 'uppercase', marginBottom: 4 }}>Recommended Outreach Angle</div>
              <p style={{ fontSize: 13, color: '#166534', lineHeight: 1.6, margin: 0 }}>{company.recommended_angle}</p>
            </div>
          )}

          {/* Per-contact angles */}
          {(company.contact_angles || []).length > 0 && (
            <div style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 11, fontWeight: 800, color: 'var(--text-muted)', letterSpacing: '.06em', textTransform: 'uppercase', marginBottom: 8 }}>Angles by Contact</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {company.contact_angles.map((ca, i) => (
                  <div key={i} style={{ padding: '10px 12px', background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 6 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                      <span style={{ fontWeight: 800, fontSize: 13, color: '#15803d' }}>{ca.name}</span>
                      {ca.title && <span style={{ fontSize: 11, color: '#16a34a', background: '#dcfce7', padding: '1px 8px', borderRadius: 3, fontWeight: 600 }}>{ca.title}</span>}
                    </div>
                    <p style={{ fontSize: 12, color: '#166534', lineHeight: 1.55, margin: 0 }}>{ca.angle}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Contacts */}
          {(company.contacts || []).length > 0 && (
            <div style={{ borderTop: '1px solid var(--border)', paddingTop: 12 }}>
              <div style={{ fontSize: 11, fontWeight: 800, color: 'var(--text-muted)', letterSpacing: '.06em', textTransform: 'uppercase', marginBottom: 8 }}>Contacts</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {company.contacts.map((ct, i) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                    <span style={{ fontWeight: 700, fontSize: 13, minWidth: 120 }}>
                      {ct.linkedin ? <a href={ct.linkedin} target="_blank" rel="noreferrer" style={{ color: 'var(--accent)' }}>{ct.name}</a> : ct.name}
                    </span>
                    {ct.title && <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{ct.title}</span>}
                    {ct.email && <a href={`mailto:${ct.email}`} style={{ fontSize: 12, color: 'var(--accent)' }}>{ct.email}</a>}
                  </div>
                ))}
              </div>
            </div>
          )}

        </div>
      )}

      {hasResult && !expanded && (
        <div style={{ padding: '6px 18px', fontSize: 11, color: 'var(--text-faint)', cursor: 'pointer', userSelect: 'none' }} onClick={() => handleSetExpanded(true)}>
          {(company.triggers || []).length} trigger{(company.triggers || []).length !== 1 ? 's' : ''} · Click to expand
        </div>
      )}
    </div>
  );
}
