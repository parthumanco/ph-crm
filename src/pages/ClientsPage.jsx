import { useState, useEffect, useRef } from 'react';
import { supabase } from '../lib/supabase';
import {
  fetchClients, fetchClientDetail, fetchCompanyIntel, runClientDeepScan, runBuildThesis,
  upsertClient, findOrCreateCompany,
  addClientItem, deleteClientItem, askClientQuestion, silentRefreshThesis,
} from '../lib/clients';
import { fetchDocuments, fetchCompanyFiles, docType, deleteCompanyFile } from '../lib/documents';
import { deleteProject, restoreProject, upsertProject } from '../lib/projects';
import { fetchOldGoldForCompany, OG_STATUS } from '../lib/oldGold';
import DocumentEditor from '../components/DocumentEditor';
import CompanyIntelPanel from '../components/CompanyIntelPanel';
import ContactsPanel from '../components/ContactsPanel';

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

// Compact "mm/dd/yy" formatter for "Last scanned" labels next to scan/thesis actions.
function ddmyy(d) {
  if (!d) return '';
  const dt = new Date(d);
  return `${String(dt.getMonth() + 1).padStart(2, '0')}/${String(dt.getDate()).padStart(2, '0')}/${String(dt.getFullYear()).slice(-2)}`;
}

export default function ClientsPage({ onNavigate, refreshKey, icp, targetClientName = null, onTargetClientConsumed }) {
  const [clients, setClients]             = useState([]);
  const [search, setSearch]               = useState('');
  const [selected, setSelected]           = useState(null);
  const [detail, setDetail]               = useState(null);
  const [intel, setIntel]                 = useState(null);   // companies row
  const [loadingList, setLoadingList]     = useState(true);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [tab, setTab]                     = useState('overview');
  const [hoveredProjectId, setHoveredProjectId]       = useState(null); // archived project row being hovered
  const [confirmDeleteProjectId, setConfirmDeleteProjectId] = useState(null); // project id awaiting delete confirmation
  const [deletingProjectId, setDeletingProjectId]     = useState(null);
  const [restoringProjectId, setRestoringProjectId]   = useState(null);
  const [showArchivedClients, setShowArchivedClients] = useState(false);
  const [archivingClientId, setArchivingClientId]     = useState(null);
  const [confirmArchiveId, setConfirmArchiveId]       = useState(null);

  // New client
  const [showNewClient, setShowNewClient] = useState(false);
  const [newClientDraft, setNewClientDraft] = useState({ name: '', website: '', linkedin_url: '', notes: '' });
  const [creatingClient, setCreatingClient] = useState(false);
  const [newClientError, setNewClientError] = useState('');

  // New project (from client's Projects tab)
  const [addingProject, setAddingProject] = useState(false);
  const [newProjectName, setNewProjectName] = useState('');
  const [newProjectStart, setNewProjectStart] = useState(() => new Date().toISOString().slice(0, 10));
  const [creatingProject, setCreatingProject] = useState(false);
  const [newProjectError, setNewProjectError] = useState('');

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

  // Contact dossiers — card UI, edit/primary/enrich/delete now all live in <ContactsPanel>
  const [hoveredClientFile, setHoveredClientFile] = useState(null); // file id — hover-reveal delete pill
  const [confirmDeleteClientFile, setConfirmDeleteClientFile] = useState(null); // file id awaiting confirm
  const [deletingClientFile, setDeletingClientFile] = useState(null); // file id

  // Watch List link — override company name used for intel lookup
  const [watchListName,      setWatchListName]      = useState('');
  const [watchListNameDraft, setWatchListNameDraft] = useState('');
  const [editingWatchLink,   setEditingWatchLink]   = useState(false);
  const [savingWatchLink,    setSavingWatchLink]     = useState(false);

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

  // Old Gold history tab
  const [ogHistory,        setOgHistory]        = useState(null); // null=not loaded
  const [ogHistoryLoading, setOgHistoryLoading] = useState(false);

  // Documents + files tab
  const [clientDocs,        setClientDocs]        = useState([]);
  const [clientFiles,       setClientFiles]        = useState([]);
  const [docsLoading,       setDocsLoading]        = useState(false);
  const [openDoc,           setOpenDoc]            = useState(null); // doc open in editor
  const [researchDragOver,  setResearchDragOver]   = useState(false);
  const [researchUploading, setResearchUploading]  = useState(false);
  const [researchLinkInput, setResearchLinkInput]  = useState('');
  const [researchLinkSaving,setResearchLinkSaving] = useState(false);

  // Background thesis auto-refresh — fires after any add (item/contact/etc.)
  // so the AI thesis stays current without a manual "Build Thesis" click.
  const autoRefreshingRef = useRef(false);
  const triggerThesisRefresh = (overrides = {}) => {
    if (!detail?.client?.name || autoRefreshingRef.current) return;
    autoRefreshingRef.current = true;
    silentRefreshThesis(detail.client.name, { ...detail, intel, ...overrides }, selected)
      .then(updated => { if (updated) setIntel(prev => ({ ...prev, ...updated })); })
      .catch(e => console.warn('[ClientsPage] thesis auto-refresh failed:', e.message))
      .finally(() => { autoRefreshingRef.current = false; });
  };

  // ── Load Old Gold history when that tab is first opened ───────────────────
  useEffect(() => {
    if (tab !== 'oldgold' || ogHistory !== null || ogHistoryLoading || !detail?.client?.name) return;
    setOgHistoryLoading(true);
    fetchOldGoldForCompany(detail.client.name)
      .then(data => { setOgHistory(data); })
      .catch(() => { setOgHistory([]); })
      .finally(() => setOgHistoryLoading(false));
  }, [tab, detail, ogHistory, ogHistoryLoading]);

  // Reset OG history when client changes
  useEffect(() => { setOgHistory(null); }, [selected]);

  // ── Load documents + files for current client ─────────────────────────────
  useEffect(() => {
    if (!detail || tab !== 'documents') return;
    const name = detail.client.name;
    setDocsLoading(true);
    Promise.all([
      fetchDocuments({ companyName: name }),
      fetchCompanyFiles(name),
    ]).then(([docs, files]) => {
      setClientDocs(docs);
      setClientFiles(files);
    }).catch(console.error).finally(() => setDocsLoading(false));
  }, [tab, detail]);

  // ── Load list ──────────────────────────────────────────────────────────────
  useEffect(() => {
    setLoadingList(true);
    fetchClients()
      .then(data => {
        setClients(data);
        if (data.length > 0 && !selected) setSelected((data.find(c => !c.archived_at) || data[0]).id);
      })
      .catch(console.error)
      .finally(() => setLoadingList(false));
  }, [refreshKey]);

  // ── Deep-link to a specific client by name ────────────────────────────────
  useEffect(() => {
    if (!targetClientName || clients.length === 0) return;
    const match = clients.find(c => c.name?.toLowerCase() === targetClientName.toLowerCase());
    if (match) setSelected(match.id);
    onTargetClientConsumed?.();
  }, [targetClientName, clients]);

  // ── Load detail + intel ───────────────────────────────────────────────────
  useEffect(() => {
    if (!selected) return;
    let cancelled = false;
    setLoadingDetail(true);
    setDetail(null);
    setIntel(null);
    setAiMessages([]);
    setTab('overview');
    setConfirmArchiveId(null);

    // Reset watch list link state
    setWatchListName('');
    setWatchListNameDraft('');
    setEditingWatchLink(false);

    fetchClientDetail(selected).then(async d => {
      if (cancelled) return;
      setDetail(d);
      setEditDraft({ name: d.client.name, website: d.client.website || '', linkedin_url: d.client.linkedin_url || '', notes: d.client.notes || '' });
      // Load any saved watch list name override
      const { data: setting } = await supabase.from('app_settings').select('value').eq('key', `client_watch_name_${selected}`).maybeSingle();
      const linkedName = setting?.value || '';
      if (!cancelled) { setWatchListName(linkedName); setWatchListNameDraft(linkedName); }
      // Fetch intel using override name if set, otherwise client name
      fetchCompanyIntel(linkedName || d.client.name).then(data => {
        if (cancelled) return;
        setIntel(data);
      }).catch(() => { if (!cancelled) setIntel(null); });
    })
    .catch(e => { if (!cancelled) console.error(e); })
    .finally(() => { if (!cancelled) setLoadingDetail(false); });

    return () => { cancelled = true; };
  }, [selected]);

  const filtered = clients.filter(c =>
    c.name.toLowerCase().includes(search.toLowerCase()) &&
    (showArchivedClients ? !!c.archived_at : !c.archived_at)
  );

  // ── Handlers ──────────────────────────────────────────────────────────────
  const handleCreateClient = async () => {
    const name = newClientDraft.name.trim();
    if (!name) { setNewClientError('Name is required'); return; }
    const dupe = clients.find(c => c.name.toLowerCase() === name.toLowerCase());
    if (dupe) {
      // Already exists — just navigate there instead of creating a duplicate.
      setSelected(dupe.id);
      setShowNewClient(false);
      setNewClientDraft({ name: '', website: '', linkedin_url: '', notes: '' });
      setNewClientError('');
      return;
    }
    setCreatingClient(true);
    setNewClientError('');
    try {
      const saved = await upsertClient({
        name,
        website: newClientDraft.website.trim() || null,
        linkedin_url: newClientDraft.linkedin_url.trim() || null,
        notes: newClientDraft.notes.trim() || null,
      });
      // Also create the matching companies row up front, so Quick Scan / Build
      // Thesis / contact discovery are available immediately — exactly like a
      // client that got created automatically via a won deal or project.
      await findOrCreateCompany(name).catch(e => console.warn('findOrCreateCompany failed:', e.message));
      setClients(prev => [...prev, saved].sort((a, b) => a.name.localeCompare(b.name)));
      setSelected(saved.id);
      setShowNewClient(false);
      setNewClientDraft({ name: '', website: '', linkedin_url: '', notes: '' });
    } catch (e) {
      setNewClientError(e.message || 'Failed to create client');
    } finally {
      setCreatingClient(false);
    }
  };

  const handleCreateProject = async () => {
    const name = newProjectName.trim();
    if (!name || !detail?.client) { setNewProjectError('Project name is required'); return; }
    setCreatingProject(true);
    setNewProjectError('');
    try {
      const saved = await upsertProject({
        name,
        client_name: detail.client.name,
        start_date: newProjectStart || null,
        status: 'active',
      });
      setDetail(d => ({ ...d, projects: [saved, ...d.projects] }));
      setAddingProject(false);
      setNewProjectName('');
      setNewProjectStart(new Date().toISOString().slice(0, 10));
      // Jump straight to the new project on the Projects page.
      onNavigate?.('projects', null, saved.id);
    } catch (e) {
      setNewProjectError(e.message || 'Failed to create project');
    } finally {
      setCreatingProject(false);
    }
  };

  const handleArchiveClient = async (clientId) => {
    setArchivingClientId(clientId);
    try {
      const archived_at = new Date().toISOString();
      await supabase.from('clients').update({ archived_at }).eq('id', clientId);
      const nextClientId = clients.find(c => !c.archived_at && c.id !== clientId)?.id || null;
      setClients(prev => prev.map(c => c.id === clientId ? { ...c, archived_at } : c));
      if (selected === clientId) setSelected(nextClientId);
    } catch (e) { console.error(e); }
    finally { setArchivingClientId(null); }
  };

  const handleRestoreClient = async (clientId) => {
    setArchivingClientId(clientId);
    try {
      await supabase.from('clients').update({ archived_at: null }).eq('id', clientId);
      setClients(prev => prev.map(c => c.id === clientId ? { ...c, archived_at: null } : c));
    } catch (e) { console.error(e); }
    finally { setArchivingClientId(null); }
  };

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
      let newItems;
      setDetail(d => { newItems = [item, ...d.items]; return { ...d, items: newItems }; });
      setItemDraft({ type: 'note', title: '', url: '', body: '' });
      setAddingItem(false);
      triggerThesisRefresh({ items: newItems });
    } catch (e) { console.error(e); }
    finally { setSavingItem(false); }
  };

  const handleDeleteItem = async (id) => {
    await deleteClientItem(id);
    const remaining = (detail?.items || []).filter(i => i.id !== id);
    setDetail(d => ({ ...d, items: remaining }));
    triggerThesisRefresh({ items: remaining });
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
    if (buildingThesis) return;
    setBuildingThesis(true);
    setThesisError('');
    setThesisLog([]);
    setShowThesisModal(true);
    setThesisPhases(THESIS_PHASES.map(p => ({ ...p, status: 'waiting', detail: null })));
    setTab('overview');
    try {
      // If no companies row yet, create one for this client so thesis has somewhere to save
      let targetIntel = intel;
      if (!targetIntel?.id) {
        targetIntel = await findOrCreateCompany(watchListName || detail.client.name);
        setIntel(targetIntel);
      }
      const updated = await runBuildThesis(targetIntel.id, targetIntel, icp, detail || {}, (phase, status, data, message) => {
        setThesisPhases(prev => prev.map(p => p.phase === phase ? { ...p, status, detail: data } : p));
        if (message) addThesisLog(
          status === 'running' ? '🔍' : status === 'done' ? '✅' : status === 'log' ? '  →' : '⚙️',
          message, phase
        );
      }, selected);
      setIntel(updated);
      addThesisLog('✅', `Thesis complete — ICP ${updated.icp_score ?? '?'}/10 · ${updated.icp_tier ?? ''}`, 4);
      setTimeout(() => setShowThesisModal(false), 1500);
    } catch (e) {
      setThesisError(e.message || 'Thesis build failed');
      addThesisLog('❌', `Error: ${e.message}`, 0);
    } finally {
      setBuildingThesis(false);
    }
  };

  // Export the Overview tab's intelligence (summary, positioning, contacts, thesis)
  // as a printable PDF — same "open blank tab, write HTML, trigger print" pattern
  // used by the deal card's Export PDF button.
  const handleExportPdf = () => {
    if (!detail?.client) return;
    const client = detail.client;
    const esc = s => (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const fmtDateLong = d => d ? new Date(d).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) : '—';
    const entry = (intel?.contact_angles || []).find(ca => ca.is_primary);

    const html = `<!DOCTYPE html><html><head><meta charset="utf-8">
<title>${esc(client.name)} — Part Human</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; font-size: 13px; color: #1a1a1a; line-height: 1.5; padding: 40px 48px; max-width: 820px; margin: 0 auto; }
  h1 { font-size: 26px; font-weight: 800; color: #111; margin-bottom: 4px; }
  h2 { font-size: 13px; font-weight: 800; text-transform: uppercase; letter-spacing: .06em; color: #6b7280; margin: 28px 0 10px; padding-bottom: 6px; border-bottom: 1.5px solid #e5e7eb; }
  .meta { display: flex; gap: 10px; flex-wrap: wrap; margin: 8px 0 6px; }
  .badge { display: inline-block; font-size: 11px; font-weight: 700; padding: 2px 10px; border-radius: 20px; }
  .badge-green { background: #f0fdf4; color: #15803d; }
  .summary { font-size: 13px; color: #374151; line-height: 1.65; margin-bottom: 10px; }
  .triggers { display: flex; flex-wrap: wrap; gap: 6px; margin: 8px 0; }
  .trigger { font-size: 11px; padding: 3px 10px; border-radius: 20px; background: #f3f4f6; color: #374151; border: 1px solid #e5e7eb; }
  .block { background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 8px; padding: 12px 14px; margin-bottom: 8px; }
  .block-title { font-size: 13px; font-weight: 700; color: #111; margin-bottom: 4px; }
  .block-body { font-size: 12px; color: #374151; line-height: 1.6; white-space: pre-wrap; }
  .contact-row { display: flex; justify-content: space-between; gap: 10px; padding: 8px 0; border-top: 1px solid #f3f4f6; font-size: 12px; }
  .contact-row:first-child { border-top: none; }
  .risks { margin-top: 10px; }
  .risk { padding: 8px 12px; background: #fffbeb; border: 1px solid #fde68a; border-radius: 6px; margin-bottom: 6px; font-size: 12px; color: #92400e; }
  .thesis-text { font-size: 13px; color: #374151; line-height: 1.7; white-space: pre-wrap; }
  .next-action { padding: 10px 12px; background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 8px; margin-bottom: 10px; font-size: 12px; color: #14532d; }
  .footer { margin-top: 40px; padding-top: 14px; border-top: 1px solid #e5e7eb; font-size: 10px; color: #9ca3af; display: flex; justify-content: space-between; }
  @media print { body { padding: 24px 32px; } }
</style></head><body>

<h1>${esc(client.name)}</h1>
${client.website ? `<div style="font-size:12px;color:#9ca3af;margin-bottom:6px;">${esc(client.website)}</div>` : ''}
<div class="meta">
  ${intel?.icp_tier ? `<span class="badge badge-green">${esc(intel.icp_tier)}</span>` : ''}
  ${intel?.icp_score != null ? `<span style="font-size:12px;font-weight:700;color:#374151;">ICP ${intel.icp_score}/10</span>` : ''}
  ${intel?.hq ? `<span style="font-size:12px;color:#6b7280;">📍 ${esc(intel.hq)}</span>` : ''}
  ${intel?.industry ? `<span style="font-size:12px;color:#6b7280;">${esc(intel.industry)}</span>` : ''}
</div>

${intel?.summary ? `<h2>Company</h2><div class="summary">${esc(intel.summary)}</div>` : ''}

${intel?.recommended_angle ? `<h2>Positioning Angle</h2><div class="block"><div class="block-body">${esc(intel.recommended_angle)}</div></div>` : ''}

${intel?.thesis_built && intel.thesis ? `
<h2>Full Thesis</h2>
<div class="thesis-text">${esc(intel.thesis)}</div>
${entry ? `<div class="block" style="margin-top:10px;"><div class="block-title">Primary Entry Point — ${esc(entry.name)}${entry.title ? ` (${esc(entry.title)})` : ''}</div>${entry.angle ? `<div class="block-body" style="font-style:italic;">"${esc(entry.angle)}"</div>` : ''}${entry.hook ? `<div class="block-body">Hook: ${esc(entry.hook)}</div>` : ''}</div>` : ''}
${(intel.thesis_risks || []).length ? `<div class="risks">${intel.thesis_risks.map(r => `<div class="risk">${esc(r)}</div>`).join('')}</div>` : ''}
` : ''}

${intel?.thesis_next_step ? `<h2>Recommended Next Step</h2><div class="next-action">${esc(intel.thesis_next_step)}</div>` : ''}

${(intel?.triggers || []).length ? `
<h2>Signals & Triggers (${intel.triggers.length})</h2>
${intel.triggers.map(t => {
  let tt = t;
  if (typeof t === 'string') { try { tt = JSON.parse(t); } catch { tt = { detail: t }; } }
  const color = catColor(tt.category);
  return `<div class="block" style="border-left:3px solid ${color};">
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px;">
      ${tt.category ? `<span style="font-size:10px;font-weight:700;padding:2px 7px;border-radius:10px;background:${color}22;color:${color};">${esc(catLabel(tt.category))}</span>` : ''}
      ${tt.urgency === 'high' ? `<span style="font-size:10px;font-weight:700;color:#ef4444;">↑ High</span>` : ''}
      ${tt.date ? `<span style="font-size:10px;color:#9ca3af;margin-left:auto;">${esc(tt.date)}</span>` : ''}
    </div>
    <div class="block-title">${esc(tt.headline || tt.title || tt.text || '—')}</div>
    ${tt.detail ? `<div class="block-body">${esc(tt.detail)}</div>` : ''}
  </div>`;
}).join('')}
` : ''}

${(intel?.contact_angles || []).length ? `
<h2>Contact Angles (${intel.contact_angles.length})</h2>
${intel.contact_angles.map(ca => `<div class="block">
    <div class="block-title">${esc(ca.name)}${ca.title ? ` <span style="font-weight:400;color:#6b7280;">· ${esc(ca.title)}</span>` : ''}</div>
    ${ca.angle ? `<div class="block-body" style="font-style:italic;">"${esc(ca.angle)}"</div>` : ''}
    ${ca.hook ? `<div class="block-body">Hook: ${esc(ca.hook)}</div>` : ''}
  </div>`).join('')}
` : ''}

${allContacts.length ? `
<h2>Contacts (${allContacts.length})</h2>
${allContacts.map(c => `<div class="contact-row"><div><strong>${esc(c.name)}</strong>${c.title ? ` — ${esc(c.title)}` : ''}</div><div style="color:#9ca3af;">${esc(c.email || '')}</div></div>`).join('')}
` : ''}

<div class="footer">
  <span>Part Human · Sales Intelligence</span>
  <span>Exported ${fmtDateLong(new Date())}</span>
</div>

<script>window.onload = () => { window.print(); }</script>
</body></html>`;

    const win = window.open('', '_blank');
    if (!win) { alert('Could not open print window — please allow pop-ups for this site.'); return; }
    win.document.write(html);
    win.document.close();
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
    ...(detail.meetings   || []).map(m => ({ date: m.meeting_date,  type: 'meeting',  icon: '📝', title: m.title || 'Meeting', body: m.summary, id: m.id, actionItems: m.action_items || [], fromDeal: !!m.deal_id })),
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

  // Candidates not yet in clients.contacts — shown in ContactsPanel's "Discovered"
  // section with a one-click "+ Add" to promote them into the canonical list.
  const discoveredContacts = detail ? (() => {
    const addedNames = new Set((detail.client?.contacts || []).map(c => c.name?.trim().toLowerCase()));
    const pool = new Map();
    (intel?.contact_angles || []).forEach(c => {
      if (!c.name?.trim()) return;
      const key = c.name.trim().toLowerCase();
      if (!addedNames.has(key)) pool.set(key, { name: c.name.trim(), title: c.title || '', email: c.email || '', linkedin: c.linkedinUrl || c.linkedin || '' });
    });
    return Array.from(pool.values());
  })() : [];


  const handleResearchFileDrop = async (e) => {
    e.preventDefault();
    setResearchDragOver(false);
    const file = e.dataTransfer?.files?.[0];
    if (!file || !detail?.client?.name) return;
    setResearchUploading(true);
    try {
      const slug = detail.client.name.toLowerCase().replace(/[^a-z0-9]/g, '-');
      const storagePath = `company-files/${slug}/research-${Date.now()}-${file.name}`;
      const { error: upErr } = await supabase.storage.from('project-files').upload(storagePath, file, { contentType: file.type, upsert: false });
      if (upErr) throw new Error(upErr.message);
      const { data: urlData } = supabase.storage.from('project-files').getPublicUrl(storagePath);
      const { data: row, error: dbErr } = await supabase.from('company_files').insert({
        company_name: detail.client.name, name: file.name, size: file.size,
        mime_type: file.type, storage_path: storagePath, url: urlData?.publicUrl || '',
        source: 'research', created_at: new Date().toISOString(),
      }).select().single();
      if (dbErr) throw new Error(dbErr.message);
      setClientFiles(prev => [...prev, row]);
    } catch (e) { alert('Upload failed: ' + e.message); }
    finally { setResearchUploading(false); }
  };

  const handleResearchLinkSave = async () => {
    const url = researchLinkInput.trim();
    if (!url || !detail?.client?.name) return;
    setResearchLinkSaving(true);
    try {
      const label = (() => { try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return url; } })();
      const { data: row, error } = await supabase.from('company_files').insert({
        company_name: detail.client.name, name: label, size: null,
        mime_type: 'text/uri-list', storage_path: null, url,
        source: 'research', created_at: new Date().toISOString(),
      }).select().single();
      if (error) throw new Error(error.message);
      setClientFiles(prev => [...prev, row]);
      setResearchLinkInput('');
    } catch (e) { alert('Could not save link: ' + e.message); }
    finally { setResearchLinkSaving(false); }
  };

  const handleDeleteClientFile = async (file) => {
    if (deletingClientFile) return;
    setDeletingClientFile(file.id);
    try {
      await deleteCompanyFile(file.id, file.storage_path);
      setClientFiles(prev => prev.filter(f => f.id !== file.id));
      setConfirmDeleteClientFile(null);
      triggerThesisRefresh();
    } catch (e) {
      alert('Error deleting file: ' + e.message);
    } finally {
      setDeletingClientFile(null);
    }
  };

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div style={{ display: 'flex', height: '100%', overflow: 'hidden' }}>

      {/* ── Left sidebar ── */}
      <div style={{ width: 220, flexShrink: 0, borderRight: '1px solid var(--border)', display: 'flex', flexDirection: 'column', height: '100%', background: 'var(--surface)' }}>
        <div style={{ padding: '12px 12px 8px', display: 'flex', flexDirection: 'column', gap: 8 }}>
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search clients…"
            style={{ width: '100%', fontSize: 12, padding: '7px 10px', borderRadius: 7, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)' }}
          />
          <button
            onClick={() => { setShowNewClient(true); setNewClientDraft({ name: '', website: '', linkedin_url: '', notes: '' }); setNewClientError(''); }}
            style={{ width: '100%', fontSize: 12, fontWeight: 700, padding: '7px 10px', borderRadius: 7, border: '1px solid var(--accent)', background: 'var(--accent)', color: '#fff', cursor: 'pointer' }}
          >+ New Client</button>
        </div>
        <div style={{ flex: 1, overflowY: 'auto', padding: '4px 0' }}>
          {loadingList ? (
            <div style={{ padding: '24px 0', textAlign: 'center' }}>
              <span style={{ display: 'inline-block', width: 16, height: 16, border: '2px solid var(--accent)', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 0.7s linear infinite' }} />
            </div>
          ) : filtered.length === 0 ? (
            <div style={{ fontSize: 12, color: 'var(--text-faint)', textAlign: 'center', padding: '24px 12px' }}>{search ? 'No match' : showArchivedClients ? 'No archived clients' : 'No clients yet'}</div>
          ) : (
            filtered.map(c => {
              const activeCount = (c.projects || []).filter(p => !p.archived_at && p.status === 'active').length;
              const isSelected = selected === c.id;
              return (
                <button
                  key={c.id}
                  onClick={() => setSelected(c.id)}
                  style={{ width: '100%', textAlign: 'left', background: isSelected ? 'var(--accent)' : 'none', border: 'none', padding: '8px 14px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}
                >
                  <span style={{ fontSize: 13, fontWeight: 600, color: isSelected ? '#fff' : 'var(--text)', overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis', flex: 1 }}>{c.name}</span>
                  {!showArchivedClients && activeCount > 0 && (
                    <span style={{ fontSize: 10, fontWeight: 700, background: isSelected ? 'rgba(255,255,255,0.25)' : '#dcfce7', color: isSelected ? '#fff' : '#059669', borderRadius: 10, padding: '1px 6px', flexShrink: 0 }}>{activeCount}</span>
                  )}
                  {showArchivedClients && (
                    <span style={{ fontSize: 9, fontWeight: 700, background: isSelected ? 'rgba(255,255,255,0.2)' : '#f3f4f6', color: isSelected ? '#fff' : '#6b7280', borderRadius: 8, padding: '1px 5px', flexShrink: 0 }}>ARCHIVED</span>
                  )}
                </button>
              );
            })
          )}
        </div>
        <div style={{ padding: '8px 12px', borderTop: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
          <span style={{ fontSize: 10, color: 'var(--text-faint)' }}>
            {showArchivedClients
              ? `${clients.filter(c => !!c.archived_at).length} archived`
              : `${clients.filter(c => !c.archived_at).length} active`}
          </span>
          {clients.some(c => !!c.archived_at) && (
            <button
              onClick={() => { setShowArchivedClients(v => !v); setSelected(null); }}
              style={{ fontSize: 10, fontWeight: 600, padding: '2px 8px', borderRadius: 8, border: '1px solid var(--border)', background: showArchivedClients ? 'var(--accent)' : 'none', color: showArchivedClients ? '#fff' : 'var(--text-muted)', cursor: 'pointer' }}
            >{showArchivedClients ? '← Active' : `Archived (${clients.filter(c => !!c.archived_at).length})`}</button>
          )}
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
            <div style={{ padding: '20px 28px 0', flexShrink: 0 }}>
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
                <div style={{ display: 'flex', gap: 8, flexShrink: 0, flexWrap: 'wrap', alignItems: 'center' }}>
                  {intel?.scan_date && (
                    <span style={{ fontSize: 10, color: 'var(--text-faint)', whiteSpace: 'nowrap' }}>
                      Last scanned: {ddmyy(intel.scan_date)}
                    </span>
                  )}
                  {intel?.id && (
                    <>
                      <button
                        onClick={handleDeepScan}
                        disabled={scanning || buildingThesis}
                        title={intel?.deep_scanned && intel?.scan_date ? `Deep scanned ${fmtDate(intel.scan_date.slice(0,10))} — click to rescan` : 'Run a deep scan'}
                        style={{ fontSize: 11, fontWeight: 700, padding: '6px 12px', borderRadius: 20, border: `1px solid ${intel?.deep_scanned && !scanning && !buildingThesis ? '#86efac' : 'var(--accent)'}`, background: scanning || buildingThesis ? 'var(--surface)' : intel?.deep_scanned ? '#dcfce7' : 'var(--accent)', color: scanning || buildingThesis ? 'var(--text-faint)' : intel?.deep_scanned ? '#15803d' : '#fff', cursor: scanning || buildingThesis ? 'default' : 'pointer', display: 'flex', alignItems: 'center', gap: 5 }}
                      >
                        {scanning ? <><span style={{ display: 'inline-block', width: 10, height: 10, border: '2px solid var(--accent)', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 0.7s linear infinite' }} /> {scanStatus || 'Scanning…'}</> : intel?.deep_scanned ? '✓ Scanned — Rescan' : 'Quick Scan'}
                      </button>
                      <button
                        onClick={handleBuildThesis}
                        disabled={scanning || buildingThesis}
                        style={{ fontSize: 11, fontWeight: 700, padding: '6px 14px', borderRadius: 20, border: '1px solid var(--accent)', background: buildingThesis ? 'var(--surface)' : 'var(--accent)', color: buildingThesis ? 'var(--text-faint)' : '#fff', cursor: (scanning || buildingThesis) ? 'default' : 'pointer', display: 'flex', alignItems: 'center', gap: 5 }}
                      >
                        {buildingThesis
                          ? <><span style={{ display: 'inline-block', width: 10, height: 10, border: '2px solid var(--accent)', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 0.7s linear infinite' }} /> Building…</>
                          : intel?.thesis_built ? 'Refresh Thesis' : 'Build Thesis'}
                      </button>
                    </>
                  )}
                  <button onClick={() => { setEditing(true); setTab('contacts'); }} style={{ fontSize: 11, fontWeight: 700, padding: '6px 12px', borderRadius: 20, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text-muted)', cursor: 'pointer' }}>Edit</button>
                  <button onClick={handleExportPdf} style={{ fontSize: 11, fontWeight: 700, padding: '6px 12px', borderRadius: 20, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text-muted)', cursor: 'pointer' }}>Share</button>
                </div>
              </div>

              {/* Tab bar */}
              <div className="tab-bar" style={{ marginTop: 14 }}>
                {[
                  { id: 'overview',  label: 'Company Overview' },
                  { id: 'projects',  label: `Projects${detail.projects.length > 0 ? ` (${detail.projects.length})` : ''}` },
                  { id: 'contacts',  label: 'Contacts' },
                  { id: 'documents', label: `Documents${clientDocs.length + clientFiles.length > 0 ? ` (${clientDocs.length + clientFiles.length})` : ''}` },
                  { id: 'oldgold',   label: `Old Gold${ogHistory?.length ? ` (${ogHistory.length})` : ''}` },
                  { id: 'ai',        label: '✦ Ask AI' },
                ].map(t => (
                  <button key={t.id} className={`tab-btn${tab === t.id ? ' active' : ''}`} onClick={() => {
                    setTab(t.id);
                    if (t.id === 'overview' && detail?.client?.name) {
                      fetchCompanyIntel(watchListName || detail.client.name).then(data => { if (data) setIntel(data); }).catch(() => {});
                    }
                  }}>{t.label}</button>
                ))}
              </div>
            </div>

            {/* Tab content */}
            <div style={{ flex: 1, overflowY: 'auto', padding: '24px 28px' }}>

              {/* ── Overview (Intelligence) ── */}
              {tab === 'overview' && (
                <>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 16, flexWrap: 'wrap' }}>
                    {intel?.id && (
                      <button
                        onClick={handleDeepScan}
                        disabled={scanning || buildingThesis}
                        style={{ fontSize: 12, fontWeight: 700, padding: '7px 14px', borderRadius: 20, border: `1px solid ${intel?.deep_scanned && !scanning ? '#86efac' : 'var(--accent)'}`, background: scanning ? 'var(--surface)' : intel?.deep_scanned ? '#dcfce7' : 'var(--accent)', color: scanning ? 'var(--text-faint)' : intel?.deep_scanned ? '#15803d' : '#fff', cursor: (scanning || buildingThesis) ? 'default' : 'pointer', display: 'flex', alignItems: 'center', gap: 5 }}
                      >
                        {scanning ? <><span style={{ display: 'inline-block', width: 10, height: 10, border: '2px solid var(--accent)', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 0.7s linear infinite' }} /> {scanStatus || 'Scanning…'}</> : intel?.deep_scanned ? '✓ Scanned — Rescan' : 'Quick Scan'}
                      </button>
                    )}
                    <button
                      onClick={handleBuildThesis}
                      disabled={scanning || buildingThesis}
                      style={{ fontSize: 12, fontWeight: 700, padding: '7px 16px', borderRadius: 20, border: '1px solid var(--accent)', background: buildingThesis ? 'var(--surface)' : 'var(--accent)', color: buildingThesis ? 'var(--text-faint)' : '#fff', cursor: (scanning || buildingThesis) ? 'default' : 'pointer', display: 'flex', alignItems: 'center', gap: 5 }}
                    >
                      {buildingThesis ? <><span style={{ display: 'inline-block', width: 10, height: 10, border: '2px solid var(--accent)', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 0.7s linear infinite' }} /> Building…</> : intel?.thesis_built ? 'Refresh Thesis' : 'Build Thesis'}
                    </button>
                  </div>
                  {/* Watch List link */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16, fontSize: 11, color: 'var(--text-faint)' }}>
                    {editingWatchLink ? (
                      <>
                        <span style={{ fontWeight: 600 }}>Watch List name:</span>
                        <input
                          autoFocus
                          value={watchListNameDraft}
                          onChange={e => setWatchListNameDraft(e.target.value)}
                          placeholder={detail.client.name}
                          style={{ fontSize: 11, padding: '3px 8px', borderRadius: 6, border: '1px solid var(--accent)', background: 'var(--bg)', color: 'var(--text)', width: 220 }}
                          onKeyDown={async e => {
                            if (e.key === 'Escape') { setEditingWatchLink(false); setWatchListNameDraft(watchListName); }
                            if (e.key === 'Enter') {
                              setSavingWatchLink(true);
                              const val = watchListNameDraft.trim();
                              await supabase.from('app_settings').upsert({ key: `client_watch_name_${selected}`, value: val }, { onConflict: 'key' });
                              setWatchListName(val);
                              setEditingWatchLink(false);
                              setSavingWatchLink(false);
                              const data = await fetchCompanyIntel(val || detail.client.name);
                              setIntel(data);
                            }
                          }}
                        />
                        <button
                          disabled={savingWatchLink}
                          onClick={async () => {
                            setSavingWatchLink(true);
                            const val = watchListNameDraft.trim();
                            await supabase.from('app_settings').upsert({ key: `client_watch_name_${selected}`, value: val }, { onConflict: 'key' });
                            setWatchListName(val);
                            setEditingWatchLink(false);
                            setSavingWatchLink(false);
                            const data = await fetchCompanyIntel(val || detail.client.name);
                            setIntel(data);
                          }}
                          style={{ fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 6, border: 'none', background: 'var(--accent)', color: '#fff', cursor: 'pointer' }}
                        >{savingWatchLink ? '…' : 'Link'}</button>
                        <button onClick={() => { setEditingWatchLink(false); setWatchListNameDraft(watchListName); }} style={{ fontSize: 11, padding: '3px 8px', borderRadius: 6, border: '1px solid var(--border)', background: 'none', color: 'var(--text-faint)', cursor: 'pointer' }}>Cancel</button>
                      </>
                    ) : (
                      <>
                        <span>{watchListName ? <>Linked to <strong style={{ color: 'var(--text-muted)' }}>{watchListName}</strong></> : `Watch List: ${detail.client.name}`}</span>
                        <button onClick={() => setEditingWatchLink(true)} style={{ fontSize: 10, padding: '2px 7px', borderRadius: 5, border: '1px solid var(--border)', background: 'none', color: 'var(--text-faint)', cursor: 'pointer' }}>
                          {watchListName ? 'Change' : 'Link different name'}
                        </button>
                      </>
                    )}
                  </div>

                  <CompanyIntelPanel
                    intel={intel}
                    extraSources={detail.items}
                    emptyMessage={`No intelligence data yet. Click "Build Thesis" above to run research on ${detail.client.name}.`}
                  />
                  <div style={{ padding: '12px 24px 20px', borderTop: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 8 }}>
                    {confirmArchiveId === detail.client.id ? (
                      <>
                        <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>Archive {detail.client.name}?</span>
                        <button
                          onClick={() => { setConfirmArchiveId(null); handleArchiveClient(detail.client.id); }}
                          disabled={archivingClientId === detail.client.id}
                          style={{ fontSize: 11, fontWeight: 700, padding: '5px 14px', borderRadius: 20, border: '1px solid #fca5a5', background: '#fef2f2', color: '#dc2626', cursor: 'pointer' }}
                        >Yes, archive</button>
                        <button
                          onClick={() => setConfirmArchiveId(null)}
                          style={{ fontSize: 11, padding: '5px 12px', borderRadius: 20, border: '1px solid var(--border)', background: 'none', color: 'var(--text-faint)', cursor: 'pointer' }}
                        >Cancel</button>
                      </>
                    ) : (
                      <button
                        onClick={() => detail.client.archived_at ? handleRestoreClient(detail.client.id) : setConfirmArchiveId(detail.client.id)}
                        disabled={archivingClientId === detail.client.id}
                        style={{ fontSize: 11, fontWeight: 600, padding: '5px 14px', borderRadius: 20, border: '1px solid var(--border)', background: 'none', color: 'var(--text-faint)', cursor: 'pointer' }}
                      >
                        {archivingClientId === detail.client.id ? '…' : detail.client.archived_at ? '↩ Restore client' : 'Archive client'}
                      </button>
                    )}
                  </div>
                </>
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

                  <ContactsPanel
                    clientId={selected}
                    companyName={detail.client.name}
                    contacts={detail.client.contacts || []}
                    discovered={discoveredContacts}
                    onContactsChange={updated => { setDetail(d => ({ ...d, client: { ...d.client, contacts: updated } })); triggerThesisRefresh(); }}
                  />
                </div>
              )}


              {/* ── Projects ── */}
              {tab === 'projects' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12, maxWidth: 680 }}>
                  <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                    {addingProject ? (
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'flex-end', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, padding: 12, width: '100%' }}>
                        <div style={{ flex: '1 1 200px' }}>
                          <label style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '.04em', display: 'block', marginBottom: 3 }}>Project Name</label>
                          <input
                            autoFocus
                            value={newProjectName}
                            onChange={e => setNewProjectName(e.target.value)}
                            onKeyDown={e => { if (e.key === 'Enter') handleCreateProject(); if (e.key === 'Escape') setAddingProject(false); }}
                            placeholder="e.g. Rebrand & Website Redesign"
                            style={{ width: '100%', fontSize: 13, padding: '6px 10px' }}
                          />
                        </div>
                        <div>
                          <label style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '.04em', display: 'block', marginBottom: 3 }}>Start Date</label>
                          <input
                            type="date"
                            value={newProjectStart}
                            onChange={e => setNewProjectStart(e.target.value)}
                            style={{ fontSize: 13, padding: '6px 10px' }}
                          />
                        </div>
                        <button onClick={handleCreateProject} disabled={creatingProject || !newProjectName.trim()} style={{ fontSize: 12, fontWeight: 700, padding: '7px 16px', borderRadius: 7, border: 'none', background: 'var(--accent)', color: '#fff', cursor: 'pointer', opacity: creatingProject || !newProjectName.trim() ? 0.6 : 1 }}>
                          {creatingProject ? 'Creating…' : 'Create'}
                        </button>
                        <button onClick={() => { setAddingProject(false); setNewProjectError(''); }} style={{ fontSize: 12, padding: '7px 14px', borderRadius: 7, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text-muted)', cursor: 'pointer' }}>Cancel</button>
                        {newProjectError && <div style={{ fontSize: 12, color: '#ef4444', width: '100%' }}>{newProjectError}</div>}
                      </div>
                    ) : (
                      <button onClick={() => setAddingProject(true)} style={{ fontSize: 12, fontWeight: 700, padding: '7px 16px', borderRadius: 8, border: '1px solid var(--accent)', background: 'var(--accent)', color: '#fff', cursor: 'pointer' }}>+ Add Project</button>
                    )}
                  </div>
                  {detail.projects.length === 0 ? (
                    <div style={{ fontSize: 13, color: 'var(--text-faint)', textAlign: 'center', padding: '40px 0' }}>No projects yet.</div>
                  ) : detail.projects.map(p => {
                    const isArchived = projStatus(p) === 'archived';
                    return (
                    <div
                      key={p.id}
                      onClick={() => onNavigate?.('projects', null, p.id)}
                      onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--accent)'; }}
                      onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border)'; }}
                      style={{ padding: '14px 16px', background: 'var(--surface)', borderRadius: 10, border: '1px solid var(--border)', cursor: 'pointer', transition: 'border-color .15s', position: 'relative' }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
                        <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)' }}>{p.name}</div>
                        <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexShrink: 0 }}>
                          {isArchived && (
                            <button
                              onClick={async e => {
                                e.stopPropagation();
                                setRestoringProjectId(p.id);
                                try {
                                  await restoreProject(p.id);
                                  setDetail(d => ({ ...d, projects: d.projects.map(proj => proj.id === p.id ? { ...proj, archived_at: null, status: 'active' } : proj) }));
                                } catch (e2) {
                                  alert('Error restoring project: ' + e2.message);
                                } finally {
                                  setRestoringProjectId(null);
                                }
                              }}
                              disabled={restoringProjectId === p.id}
                              style={{ width: 70, textAlign: 'center', fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 10, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text-muted)', cursor: restoringProjectId === p.id ? 'not-allowed' : 'pointer' }}
                            >
                              {restoringProjectId === p.id ? '…' : 'Restore'}
                            </button>
                          )}
                          <span style={{ width: 70, textAlign: 'center', fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 10, background: (STATUS_COLOR[projStatus(p)] || '#9ca3af') + '22', color: STATUS_COLOR[projStatus(p)] || '#9ca3af', flexShrink: 0 }}>{projStatusLabel(p)}</span>
                        </div>
                      </div>
                      {p.description && <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '4px 0 0', lineHeight: 1.5 }}>{p.description}</p>}
                      <div style={{ fontSize: 11, color: 'var(--text-faint)', marginTop: 6 }}>Started {fmtDate(p.start_date)}{p.end_date ? ` · Ends ${fmtDate(p.end_date)}` : ''}</div>

                      {isArchived && (
                        <div
                          onMouseEnter={e => { e.stopPropagation(); setHoveredProjectId(p.id); }}
                          onMouseLeave={e => { e.stopPropagation(); setHoveredProjectId(null); }}
                          style={{ position: 'absolute', top: 38, right: 12, height: 22, display: 'flex', alignItems: 'center' }}
                        >
                          {confirmDeleteProjectId === p.id ? (
                            <div
                              onClick={e => e.stopPropagation()}
                              style={{ display: 'flex', gap: 4, alignItems: 'center', background: 'var(--surface)', padding: 2, borderRadius: 20 }}
                            >
                              <span style={{ fontSize: 10, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>Delete permanently?</span>
                              <button
                                onClick={async () => {
                                  setDeletingProjectId(p.id);
                                  try {
                                    await deleteProject(p.id);
                                    setDetail(d => ({ ...d, projects: d.projects.filter(proj => proj.id !== p.id) }));
                                  } catch (e) {
                                    alert('Error deleting project: ' + e.message);
                                  } finally {
                                    setDeletingProjectId(null);
                                    setConfirmDeleteProjectId(null);
                                  }
                                }}
                                disabled={deletingProjectId === p.id}
                                style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 20, border: 'none', background: '#ef4444', color: '#fff', cursor: deletingProjectId === p.id ? 'not-allowed' : 'pointer', whiteSpace: 'nowrap' }}
                              >
                                {deletingProjectId === p.id ? 'Deleting…' : 'Yes'}
                              </button>
                              <button
                                onClick={() => setConfirmDeleteProjectId(null)}
                                style={{ fontSize: 10, fontWeight: 600, padding: '2px 8px', borderRadius: 20, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text-muted)', cursor: 'pointer' }}
                              >
                                Cancel
                              </button>
                            </div>
                          ) : (
                            <button
                              onClick={e => { e.stopPropagation(); setConfirmDeleteProjectId(p.id); }}
                              style={{ width: 70, textAlign: 'center', opacity: hoveredProjectId === p.id ? 1 : 0, transition: 'opacity .15s', fontSize: 10, fontWeight: 600, padding: '2px 8px', borderRadius: 20, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text-muted)', cursor: 'pointer' }}
                            >
                              Delete
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  );})}
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
                            <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 4, flexWrap: 'wrap' }}>
                              <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)' }}>{item.title}</span>
                              {item.fromDeal && (
                                <span style={{ fontSize: 9, fontWeight: 800, padding: '1px 6px', borderRadius: 4, background: '#f0fdf4', color: '#059669', border: '1px solid #bbf7d0', textTransform: 'uppercase', letterSpacing: '.05em', whiteSpace: 'nowrap' }}>From Deal</span>
                              )}
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

              {/* ── Old Gold History ── */}
              {tab === 'oldgold' && (
                <div>
                  {ogHistoryLoading && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '20px 0', color: 'var(--text-faint)', fontSize: 13 }}>
                      <span className="spinner" /> Loading Old Gold history…
                    </div>
                  )}
                  {!ogHistoryLoading && ogHistory?.length === 0 && (
                    <div style={{ fontSize: 13, color: 'var(--text-faint)', fontStyle: 'italic', padding: '20px 0' }}>
                      No Old Gold conversations found for {detail.client.name}.
                    </div>
                  )}
                  {!ogHistoryLoading && ogHistory?.map(p => {
                    const sm = OG_STATUS[p.status];
                    const lastMtg = p.meetings[0];
                    return (
                      <div key={p.id} style={{ background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 8, padding: '12px 16px', marginBottom: 10 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                          <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)' }}>{p.name}</span>
                          {sm && <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 9, background: sm.bg, color: sm.color, border: `1px solid ${sm.color}40` }}>{sm.label}</span>}
                          <span style={{ fontSize: 11, color: 'var(--text-faint)', marginLeft: 'auto' }}>{p.meetings.length} meeting{p.meetings.length !== 1 ? 's' : ''}</span>
                        </div>
                        {lastMtg && (
                          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: p.openTasks.length > 0 ? 6 : 0 }}>
                            <span style={{ fontWeight: 600 }}>Last meeting:</span> {new Date(lastMtg.meeting_date + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                            {lastMtg.summary ? ` — ${lastMtg.summary}` : ''}
                          </div>
                        )}
                        {p.meetings.length > 1 && (
                          <div style={{ fontSize: 11, color: 'var(--text-faint)', marginBottom: p.openTasks.length > 0 ? 6 : 0 }}>
                            {p.meetings.slice(1).map(m => (
                              <div key={m.id} style={{ paddingLeft: 8, borderLeft: '2px solid #fde68a', marginBottom: 2 }}>
                                {new Date(m.meeting_date + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                                {m.summary ? ` — ${m.summary.slice(0, 120)}${m.summary.length > 120 ? '…' : ''}` : ''}
                              </div>
                            ))}
                          </div>
                        )}
                        {p.openTasks.length > 0 && (
                          <div>
                            <div style={{ fontSize: 10, fontWeight: 700, color: '#92400e', textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 4 }}>Open Next Steps</div>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                              {p.openTasks.map(t => (
                                <div key={t.id} style={{ fontSize: 12, color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 6 }}>
                                  <span style={{ color: '#f59e0b' }}>→</span> {t.title}
                                  {t.due_date && <span style={{ fontSize: 10, color: 'var(--text-faint)', marginLeft: 'auto' }}>Due {new Date(t.due_date + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>}
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
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
                    <button onClick={() => setAddingItem(true)} style={{ alignSelf: 'flex-start', fontSize: 12, fontWeight: 700, padding: '8px 16px', borderRadius: 8, border: '1px solid var(--accent)', background: 'var(--accent)', color: '#fff', cursor: 'pointer' }}>+ Add Note or Link</button>
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
              {/* ── Documents ── */}
              {tab === 'documents' && (
                <div>
                  {docsLoading ? (
                    <p style={{ fontSize: 13, color: 'var(--text-faint)', padding: '20px 0' }}>Loading…</p>
                  ) : (
                    <>
                      {/* Saved documents */}
                      {clientDocs.length > 0 && (
                        <div style={{ marginBottom: 28 }}>
                          <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.06em', color: 'var(--text-faint)', marginBottom: 10 }}>
                            Documents ({clientDocs.length})
                          </div>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                            {clientDocs.map(d => {
                              const dt = docType(d.type);
                              return (
                                <div
                                  key={d.id}
                                  onClick={() => setOpenDoc(d)}
                                  style={{ padding: '12px 14px', background: 'var(--surface)', border: '1px solid var(--border)', borderLeft: `3px solid ${dt.color}`, borderRadius: 10, cursor: 'pointer', display: 'flex', gap: 10, alignItems: 'center' }}
                                  onMouseEnter={e => e.currentTarget.style.boxShadow = '0 2px 8px rgba(0,0,0,.08)'}
                                  onMouseLeave={e => e.currentTarget.style.boxShadow = 'none'}
                                >
                                  <span style={{ fontSize: 18 }}>{dt.icon}</span>
                                  <div style={{ flex: 1, minWidth: 0 }}>
                                    <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                      {d.title || <span style={{ color: 'var(--text-faint)', fontStyle: 'italic' }}>Untitled</span>}
                                    </div>
                                    <div style={{ fontSize: 11, color: 'var(--text-faint)', marginTop: 2 }}>
                                      {dt.label} · {d.status} · {d.updated_at ? new Date(d.updated_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—'}
                                    </div>
                                  </div>
                                  <span style={{ fontSize: 12, color: 'var(--text-faint)' }}>→</span>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      )}

                      {/* Company files (HTML snapshots saved from editor) */}
                      {clientFiles.length > 0 && (
                        <div style={{ marginBottom: 28 }}>
                          <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.06em', color: 'var(--text-faint)', marginBottom: 10 }}>
                            Saved File Snapshots ({clientFiles.length})
                          </div>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                            {clientFiles.map(f => (
                              <div
                                key={f.id}
                                onMouseEnter={e => { setHoveredClientFile(f.id); e.currentTarget.style.boxShadow = '0 2px 8px rgba(0,0,0,.08)'; }}
                                onMouseLeave={e => { setHoveredClientFile(null); e.currentTarget.style.boxShadow = 'none'; }}
                                style={{ padding: '12px 14px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, display: 'flex', gap: 10, alignItems: 'center' }}
                              >
                                <a
                                  href={f.url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  style={{ flex: 1, minWidth: 0, display: 'flex', gap: 10, alignItems: 'center', textDecoration: 'none', color: 'inherit' }}
                                >
                                  <span style={{ fontSize: 18 }}>🌐</span>
                                  <div style={{ flex: 1, minWidth: 0 }}>
                                    <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.name}</div>
                                    <div style={{ fontSize: 11, color: 'var(--text-faint)', marginTop: 2 }}>
                                      HTML Snapshot · {f.created_at ? new Date(f.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—'}
                                      {f.size ? ` · ${Math.round(f.size / 1024)}KB` : ''}
                                    </div>
                                  </div>
                                  <span style={{ fontSize: 11, color: '#3b82f6' }}>Open ↗</span>
                                </a>
                                {confirmDeleteClientFile === f.id ? (
                                  <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexShrink: 0 }}>
                                    <span style={{ fontSize: 11, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>Delete?</span>
                                    <button
                                      onClick={() => handleDeleteClientFile(f)}
                                      disabled={deletingClientFile === f.id}
                                      style={{ fontSize: 10, fontWeight: 700, padding: '3px 10px', borderRadius: 20, border: 'none', background: '#ef4444', color: '#fff', cursor: deletingClientFile === f.id ? 'not-allowed' : 'pointer', whiteSpace: 'nowrap' }}
                                    >
                                      {deletingClientFile === f.id ? 'Deleting…' : 'Yes'}
                                    </button>
                                    <button
                                      onClick={() => setConfirmDeleteClientFile(null)}
                                      style={{ fontSize: 10, fontWeight: 600, padding: '3px 10px', borderRadius: 20, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text-muted)', cursor: 'pointer' }}
                                    >
                                      Cancel
                                    </button>
                                  </div>
                                ) : (
                                  <button
                                    onClick={() => setConfirmDeleteClientFile(f.id)}
                                    style={{ opacity: hoveredClientFile === f.id ? 1 : 0, transition: 'opacity .15s', fontSize: 10, fontWeight: 600, padding: '3px 10px', borderRadius: 20, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text-muted)', cursor: 'pointer', flexShrink: 0, whiteSpace: 'nowrap' }}
                                  >
                                    Delete
                                  </button>
                                )}
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* ── Files from the deal process ── */}
                      {(detail.dealFiles || []).length > 0 && (
                        <div style={{ marginBottom: 28 }}>
                          <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.06em', color: 'var(--text-faint)', marginBottom: 10, display: 'flex', alignItems: 'center', gap: 8 }}>
                            Deal Files
                            <span style={{ fontSize: 9, fontWeight: 800, padding: '1px 6px', borderRadius: 4, background: '#f0fdf4', color: '#059669', border: '1px solid #bbf7d0', textTransform: 'uppercase', letterSpacing: '.05em' }}>From Deal</span>
                          </div>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                            {(detail.dealFiles || []).map(f => {
                              const isLink = f.mime_type === 'link' || f.mime_type === 'text/uri-list';
                              return (
                                <div key={f.id} style={{ padding: '10px 12px', background: 'var(--surface)', border: '1px solid var(--border)', borderLeft: '3px solid #059669', borderRadius: 8, display: 'flex', gap: 10, alignItems: 'center' }}>
                                  <span style={{ fontSize: 16, flexShrink: 0 }}>{isLink ? '🔗' : '📎'}</span>
                                  <div style={{ flex: 1, minWidth: 0 }}>
                                    {f.url ? (
                                      <a href={f.url} target="_blank" rel="noopener noreferrer" style={{ fontSize: 13, fontWeight: 600, color: 'var(--accent)', textDecoration: 'none', display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.name}</a>
                                    ) : (
                                      <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.name}</div>
                                    )}
                                    <div style={{ fontSize: 11, color: 'var(--text-faint)', marginTop: 2 }}>
                                      {isLink ? 'Link' : f.mime_type || 'File'}
                                      {f.size ? ` · ${Math.round(f.size / 1024)}KB` : ''}
                                    </div>
                                  </div>
                                  {f.url && <span style={{ fontSize: 11, color: '#059669', whiteSpace: 'nowrap' }}>Open ↗</span>}
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      )}

                      {clientDocs.length === 0 && clientFiles.filter(f => f.source !== 'research').length === 0 && (detail.dealFiles || []).length === 0 && (
                        <div style={{ textAlign: 'center', padding: '40px 0 24px', color: 'var(--text-faint)' }}>
                          <div style={{ fontSize: 28, marginBottom: 8 }}>📄</div>
                          <div style={{ fontSize: 13, marginBottom: 8 }}>No documents yet for {detail.client.name}.</div>
                          <p style={{ fontSize: 12, maxWidth: 280, margin: '0 auto', lineHeight: 1.5 }}>
                            Create a Proposal, SOW, MSA or other document from the Documents page and save it to this company's files.
                          </p>
                        </div>
                      )}

                      {/* ── Research files & links ── */}
                      <div style={{ marginTop: 24, borderTop: '1px solid var(--border-light)', paddingTop: 20 }}>
                        <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.06em', color: 'var(--text-faint)', marginBottom: 12 }}>Research</div>

                        {/* Existing research items */}
                        {clientFiles.filter(f => f.source === 'research').length > 0 && (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 14 }}>
                            {clientFiles.filter(f => f.source === 'research').map(f => (
                              <div key={f.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', background: 'var(--surface)', border: '1px solid var(--border-light)', borderRadius: 8 }}>
                                <span style={{ fontSize: 14, flexShrink: 0 }}>{f.mime_type === 'text/uri-list' ? '🔗' : '📎'}</span>
                                <a href={f.url} target="_blank" rel="noopener noreferrer" style={{ flex: 1, fontSize: 12, fontWeight: 600, color: 'var(--accent)', textDecoration: 'none', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.name}</a>
                                <button onClick={() => { if (window.confirm(`Delete "${f.name}"?`)) handleDeleteClientFile(f); }} style={{ background: 'none', border: 'none', color: 'var(--text-faint)', cursor: 'pointer', fontSize: 12, padding: '2px 4px', flexShrink: 0 }}>✕</button>
                              </div>
                            ))}
                          </div>
                        )}

                        {/* Drop zone */}
                        <div
                          onDragOver={e => { e.preventDefault(); setResearchDragOver(true); }}
                          onDragLeave={() => setResearchDragOver(false)}
                          onDrop={handleResearchFileDrop}
                          style={{ border: `2px dashed ${researchDragOver ? 'var(--accent)' : 'var(--border)'}`, borderRadius: 10, padding: '20px 16px', textAlign: 'center', background: researchDragOver ? 'var(--accent-light, #fff7ed)' : 'var(--surface)', transition: 'all .15s', marginBottom: 10 }}
                        >
                          <div style={{ fontSize: 12, color: researchDragOver ? 'var(--accent)' : 'var(--text-faint)' }}>
                            {researchUploading ? 'Uploading…' : 'Drop a file here to attach to research'}
                          </div>
                        </div>

                        {/* Link input */}
                        <div style={{ display: 'flex', gap: 8 }}>
                          <input
                            type="url"
                            value={researchLinkInput}
                            onChange={e => setResearchLinkInput(e.target.value)}
                            onKeyDown={e => e.key === 'Enter' && handleResearchLinkSave()}
                            placeholder="Paste a link (Dropbox, Google Docs, article…)"
                            style={{ flex: 1, fontSize: 12, padding: '8px 10px', borderRadius: 7, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)' }}
                          />
                          <button
                            onClick={handleResearchLinkSave}
                            disabled={!researchLinkInput.trim() || researchLinkSaving}
                            style={{ padding: '8px 14px', borderRadius: 7, border: 'none', background: 'var(--accent)', color: '#fff', fontSize: 12, fontWeight: 700, cursor: 'pointer', flexShrink: 0 }}
                          >{researchLinkSaving ? 'Saving…' : 'Add Link'}</button>
                        </div>
                      </div>
                    </>
                  )}
                </div>
              )}

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

        {/* ── Document Editor (from Documents tab) ── */}
        {openDoc && (
          <DocumentEditor
            doc={openDoc}
            onClose={() => setOpenDoc(null)}
            onSaved={(saved, deletedId) => {
              if (deletedId) { setClientDocs(prev => prev.filter(d => d.id !== deletedId)); setOpenDoc(null); return; }
              if (saved) {
                setClientDocs(prev => {
                  const idx = prev.findIndex(d => d.id === saved.id);
                  if (idx >= 0) { const n = [...prev]; n[idx] = saved; return n; }
                  return [saved, ...prev];
                });
                setOpenDoc(saved);
              }
            }}
          />
        )}

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

      {/* New client modal */}
      {showNewClient && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 800, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.35)' }} onClick={() => setShowNewClient(false)} />
          <div style={{ position: 'relative', zIndex: 1, background: 'var(--bg)', borderRadius: 12, padding: 28, width: 440, maxWidth: '95vw', boxShadow: '0 16px 48px rgba(0,0,0,0.15)' }}>
            <h3 style={{ fontSize: 16, fontWeight: 800, marginBottom: 6 }}>New Client</h3>
            <p style={{ fontSize: 12, color: 'var(--text-faint)', marginBottom: 20 }}>
              Creates a client record with full Quick Scan, Build Thesis, and contact-discovery support — exactly like a client created from a won deal.
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div>
                <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '.04em', display: 'block', marginBottom: 4 }}>Company Name *</label>
                <input
                  autoFocus
                  value={newClientDraft.name}
                  onChange={e => setNewClientDraft(d => ({ ...d, name: e.target.value }))}
                  onKeyDown={e => { if (e.key === 'Enter') handleCreateClient(); }}
                  placeholder="Acme Inc."
                  style={{ width: '100%', fontSize: 13, padding: '7px 10px' }}
                />
              </div>
              <div>
                <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '.04em', display: 'block', marginBottom: 4 }}>Website</label>
                <input
                  value={newClientDraft.website}
                  onChange={e => setNewClientDraft(d => ({ ...d, website: e.target.value }))}
                  placeholder="https://acme.com"
                  style={{ width: '100%', fontSize: 13, padding: '7px 10px' }}
                />
              </div>
              <div>
                <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '.04em', display: 'block', marginBottom: 4 }}>LinkedIn URL</label>
                <input
                  value={newClientDraft.linkedin_url}
                  onChange={e => setNewClientDraft(d => ({ ...d, linkedin_url: e.target.value }))}
                  placeholder="linkedin.com/company/acme"
                  style={{ width: '100%', fontSize: 13, padding: '7px 10px' }}
                />
              </div>
              <div>
                <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '.04em', display: 'block', marginBottom: 4 }}>Notes</label>
                <textarea
                  rows={3}
                  value={newClientDraft.notes}
                  onChange={e => setNewClientDraft(d => ({ ...d, notes: e.target.value }))}
                  placeholder="Optional internal notes…"
                  style={{ width: '100%', fontSize: 13, padding: '7px 10px', resize: 'vertical' }}
                />
              </div>
              {newClientError && <div style={{ fontSize: 12, color: '#ef4444' }}>{newClientError}</div>}
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 4 }}>
                <button onClick={() => setShowNewClient(false)} style={{ fontSize: 12, padding: '7px 14px', borderRadius: 7, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)', cursor: 'pointer' }}>Cancel</button>
                <button
                  onClick={handleCreateClient}
                  disabled={creatingClient || !newClientDraft.name.trim()}
                  style={{ fontSize: 12, fontWeight: 700, padding: '7px 18px', borderRadius: 7, border: 'none', background: 'var(--accent)', color: '#fff', cursor: 'pointer', opacity: creatingClient || !newClientDraft.name.trim() ? 0.6 : 1 }}
                >{creatingClient ? 'Creating…' : 'Create Client'}</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
