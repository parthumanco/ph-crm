import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '../lib/supabase';
import { saveProjectMeeting } from '../lib/projects';
import { findOrCreateCompany, enrichCompanyContact, upsertCompanyContacts, runBuildThesis, findOrCreateClient, upsertClientContacts } from '../lib/clients';
import { STAGES, upsertDeal } from '../lib/deals';
import ContactDossier from '../components/ContactDossier';
import ContactsPanel from '../components/ContactsPanel';
import { parseCsvRows } from '../lib/csv';

// ── Tiny AI helper: extract summary + action items + contact info ─────────────
async function processTranscriptWithAI(transcript) {
  const apiKey = import.meta.env.VITE_ANTHROPIC_API_KEY;
  if (!apiKey) return { summary: '', action_items: [], contact_name: '', company_name: '', contact_email: '' };

  const today = new Date().toISOString().slice(0, 10);
  const prompt = `You are analyzing a meeting transcript involving Peter Andrews (a consultant at Part Human, a creative/marketing agency). Today's date is ${today}.

IMPORTANT: Extract information about THIS specific meeting only — the one actively being recorded/transcribed. Do NOT use dates, names, or content from past meetings that are merely referenced or discussed within this transcript.

Your job is to identify the PRIMARY PROSPECT — the external client or potential client that Peter is having a business development conversation with RIGHT NOW in this transcript. This is NOT Peter/Pete himself, and NOT other Part Human team members. If multiple external people are present, pick the one who is the decision-maker or the person this meeting is primarily about.

Extract the following and respond ONLY with valid JSON:
1. The PRIMARY PROSPECT'S full name
2. Their company name (the prospect's company, not Part Human)
3. Their email address IF explicitly mentioned (null if not stated)
4. The date THIS meeting took place (YYYY-MM-DD). null if not determinable.
5. A concise 2–3 sentence summary of THIS conversation
6. Action items / next steps — who owns each (use "Pete" for Part Human items, prospect's first name for theirs) and a due date (YYYY-MM-DD, within 14 days if not specified)
7. Personal rapport moments about the PROSPECT or other guests (NOT Pete/Part Human) — casual human details: pets, family events, health, hobbies, sports teams, moves, milestones, exciting personal news. Short pill label (≤5 words), the person it is about, and a natural follow-up prompt. Only capture things about the other person(s) — do NOT include anything Pete shared about himself.
8. Other people mentioned by name as attendees or key contacts who are NOT Pete/Part Human and NOT the primary prospect — suggest them as contacts worth adding.

{
  "contact_name": "First Last",
  "company_name": "Company Name",
  "contact_email": null,
  "meeting_date": "YYYY-MM-DD or null",
  "summary": "...",
  "action_items": [
    { "title": "...", "owner": "Pete", "due_date": "YYYY-MM-DD" }
  ],
  "rapport_moments": [
    { "title": "Dog got hurt", "category": "pets", "description": "Chandler's dog injured its paw at the dog park last weekend", "person": "Chandler", "followup_prompt": "Ask how the dog is recovering" }
  ],
  "suggested_contacts": [
    { "name": "Full Name", "role": "their title/role if mentioned", "reason": "Why they might be worth adding" }
  ]
}

Return empty arrays for rapport_moments and suggested_contacts if none found.

TRANSCRIPT:
${transcript.slice(0, 8000)}`;

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 1800,
        messages: [{ role: 'user', content: prompt }],
      }),
    });
    const data = await res.json();
    const text = data.content?.[0]?.text || '';
    const match = text.match(/\{[\s\S]*\}/);
    if (match) return JSON.parse(match[0]);
  } catch {}
  return { summary: '', action_items: [], rapport_moments: [], suggested_contacts: [], contact_name: '', company_name: '', contact_email: '' };
}

// ── Cross-reference contact against CRM data ──────────────────────────────────
async function crossReferenceContact(contactName, companyName) {
  const refs = { pipeline: [], intel: [] };
  const term = (companyName || '').trim();
  if (!term) return refs;

  const [{ data: deals }, { data: companies }] = await Promise.all([
    supabase.from('deals').select('id, company_name, contact_name, contact_email, stage').ilike('company_name', `%${term}%`).limit(5),
    supabase.from('companies').select('id, name, contact_angles').ilike('name', `%${term}%`).limit(3),
  ]);

  refs.pipeline = deals || [];
  refs.intel    = companies || [];
  return refs;
}

const STATUS_OPTIONS = [
  { id: 'warm',         label: 'Warm',          color: '#f59e0b', bg: '#fffbeb' },
  { id: 'meeting_set',  label: 'Meeting Set',   color: '#3b82f6', bg: '#eff6ff' },
  { id: 'following_up', label: 'Following Up',  color: '#8b5cf6', bg: '#f5f3ff' },
  { id: 'cold',         label: 'Cold',          color: '#6b7280', bg: '#f9fafb' },
  { id: 'passed',       label: 'Passed',        color: '#10b981', bg: '#f0fdf4' },
];
const statusMeta = id => STATUS_OPTIONS.find(s => s.id === id) || STATUS_OPTIONS[0];

const fmtDate = d => {
  if (!d) return '—';
  const dt = new Date(d + 'T12:00:00');
  return dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
};

const BLANK_PROSPECT = { name: '', company: '', title: '', email: '', linkedin: '', notes: '', status: 'warm' };

const MOMENT_CATEGORY_ICON = {
  pets: '🐾', family: '👨‍👩‍👧', health: '🏥', hobbies: '🎯',
  sports: '🏆', milestone: '🎉', professional: '💼', other: '💬',
};

// ── File helpers (outside component — no state deps) ──────────────────────────
function stripRtf(rtf) {
  let s = rtf;
  s = s.replace(/\{\\(?:fonttbl|colortbl|stylesheet|pict|info)(?:[^{}]|\{[^{}]*\})*\}/g, '');
  s = s.replace(/\{\\?\*(?:[^{}]|\{[^{}]*\})*\}/g, '');
  s = s.replace(/\\'[0-9a-fA-F]{2}/g, ' ');
  s = s.replace(/\\[a-zA-Z]+[-]?\d* ?/g, '');
  s = s.replace(/\\[^a-zA-Z\r\n]/g, '');
  s = s.replace(/[{}]/g, '');
  return s.replace(/\r\n|\r/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

function readFileText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = e => {
      const text = e.target.result;
      const isRtf = file.name.toLowerCase().endsWith('.rtf') || file.type.includes('rtf');
      resolve(isRtf ? stripRtf(text) : text);
    };
    reader.onerror = () => reject(new Error('Could not read file'));
    reader.readAsText(file);
  });
}

function ProspectForm({ draft, setDraft, allCompanies, onSave, saving, onCancel, onDone, autoSaveStatus }) {
  const isEditMode = !!onDone;
  return (
    <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, padding: 20, marginBottom: 20 }}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
        {[['name','Name *','text'],['title','Title','text'],['email','Email','email'],['linkedin','LinkedIn URL','url']].map(([field, label, type]) => (
          <div key={field} style={field === 'name' ? { gridColumn: '1/-1' } : {}}>
            <label style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '.04em', display: 'block', marginBottom: 3 }}>{label}</label>
            <input type={type} value={draft[field] || ''} onChange={e => setDraft(d => ({ ...d, [field]: e.target.value }))} style={{ width: '100%', fontSize: 13 }} />
          </div>
        ))}
        <div style={{ gridColumn: '1/-1' }}>
          <label style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '.04em', display: 'block', marginBottom: 3 }}>Company</label>
          <input
            list="og-company-datalist"
            value={draft.company || ''}
            onChange={e => setDraft(d => ({ ...d, company: e.target.value }))}
            placeholder="Type to search existing companies…"
            style={{ width: '100%', fontSize: 13 }}
          />
          <datalist id="og-company-datalist">
            {(allCompanies || []).map(c => <option key={c.name} value={c.name} label={c.source === 'pipeline' ? '⚡ Pipeline' : '🧠 Company Intel'} />)}
          </datalist>
        </div>
        <div>
          <label style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '.04em', display: 'block', marginBottom: 3 }}>Status</label>
          <select value={draft.status || 'warm'} onChange={e => setDraft(d => ({ ...d, status: e.target.value }))} style={{ width: '100%', fontSize: 13 }}>
            {STATUS_OPTIONS.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
          </select>
        </div>
        <div style={{ gridColumn: '1/-1' }}>
          <label style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '.04em', display: 'block', marginBottom: 3 }}>Notes</label>
          <textarea rows={2} value={draft.notes || ''} onChange={e => setDraft(d => ({ ...d, notes: e.target.value }))} style={{ width: '100%', fontSize: 12, lineHeight: 1.5 }} />
        </div>
      </div>
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', alignItems: 'center' }}>
        {isEditMode ? (
          <>
            <span style={{ fontSize: 11, color: autoSaveStatus === 'saved' ? '#10b981' : autoSaveStatus === 'saving' ? 'var(--text-faint)' : autoSaveStatus === 'error' ? '#ef4444' : 'transparent', transition: 'color .2s' }}>
              {autoSaveStatus === 'saving' ? 'Saving…' : autoSaveStatus === 'saved' ? 'Saved ✓' : autoSaveStatus === 'error' ? 'Save failed' : '·'}
            </span>
            <button onClick={onDone} style={{ fontSize: 12, fontWeight: 700, padding: '5px 16px', borderRadius: 6, border: 'none', background: 'var(--accent)', color: '#fff', cursor: 'pointer' }}>Done</button>
          </>
        ) : (
          <>
            <button onClick={onCancel} style={{ fontSize: 12, padding: '5px 14px', borderRadius: 6, border: '1px solid var(--border)', background: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}>Cancel</button>
            <button onClick={onSave} disabled={saving || !draft.name?.trim()} style={{ fontSize: 12, fontWeight: 700, padding: '5px 16px', borderRadius: 6, border: 'none', background: 'var(--accent)', color: '#fff', cursor: 'pointer' }}>{saving ? 'Saving…' : 'Save'}</button>
          </>
        )}
      </div>
    </div>
  );
}

export default function OldGoldPage({ isActive = false, onNavigate, icp = {} }) {
  // ── State ─────────────────────────────────────────────────────────────────
  const [prospects,   setProspects]   = useState([]);
  const [meetings,    setMeetings]    = useState([]);   // for active prospect
  const [tasks,       setTasks]       = useState([]);   // for active prospect
  const [active,      setActive]      = useState(null); // prospect object
  const [loading,     setLoading]     = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [allCompanies, setAllCompanies] = useState([]); // { name, source:'pipeline'|'intel', deal_id? }
  const [search, setSearch] = useState('');
  const [dossierContact, setDossierContact] = useState(null); // matching companies.contacts entry for active prospect
  const [buildingDossier, setBuildingDossier] = useState(false);
  const [clientRecord, setClientRecord]     = useState(null); // clients row — shared contact list with project cards

  // Forms
  const [addingProspect, setAddingProspect] = useState(false);
  const [prospectDraft,  setProspectDraft]  = useState(BLANK_PROSPECT);
  const [editingProspect, setEditingProspect] = useState(false);
  const [saving,          setSaving]          = useState(false);

  // Meeting import
  const [showImport,      setShowImport]      = useState(false);
  const [importTitle,     setImportTitle]     = useState('');
  const [importDate,      setImportDate]      = useState(new Date().toISOString().slice(0, 10));
  const [importTranscript, setImportTranscript] = useState('');
  const [importing,       setImporting]       = useState(false);
  const [importError,     setImportError]     = useState('');

  // Tasks
  const [newTaskTitle, setNewTaskTitle] = useState('');
  const [newTaskDue,   setNewTaskDue]   = useState('');
  const [addingTask,   setAddingTask]   = useState(false);
  const [deleteConfirmId, setDeleteConfirmId] = useState(null);
  const [savedStack, setSavedStack] = useState([]);
  const [autoSaveStatus, setAutoSaveStatus] = useState('idle'); // 'idle' | 'saving' | 'saved' | 'error'
  const autoSaveTimer = useRef(null);
  const hasEdited = useRef(false);

  // Quick-drop analysis (no contact required)
  const [dropDragging,   setDropDragging]   = useState(false);
  const [quickText,      setQuickText]      = useState('');
  const [quickAnalyzing, setQuickAnalyzing] = useState(false);
  const [quickError,     setQuickError]     = useState('');
  const [quickSaving,    setQuickSaving]    = useState(false);

  // Restore persisted panel state from localStorage — lazy initialisers run once on mount only
  const [showQuickPanel, setShowQuickPanel] = useState(() => { try { return !!JSON.parse(localStorage.getItem('og_quick_panel') || 'null')?.quickSaved; } catch { return false; } });
  const [quickExtracted, setQuickExtracted] = useState(() => { try { return JSON.parse(localStorage.getItem('og_quick_panel') || 'null')?.quickExtracted || null; } catch { return null; } });
  const [quickCrossRefs, setQuickCrossRefs] = useState(() => { try { return JSON.parse(localStorage.getItem('og_quick_panel') || 'null')?.quickCrossRefs || null; } catch { return null; } });
  const [quickEmailHint, setQuickEmailHint] = useState(() => { try { return JSON.parse(localStorage.getItem('og_quick_panel') || 'null')?.quickEmailHint || ''; } catch { return ''; } });
  const [quickResult,    setQuickResult]    = useState(() => { try { return JSON.parse(localStorage.getItem('og_quick_panel') || 'null')?.quickResult || null; } catch { return null; } });
  const [quickSaved,     setQuickSaved]     = useState(() => { try { const s = JSON.parse(localStorage.getItem('og_quick_panel') || 'null')?.quickSaved; return s ? { ...s, savedAt: new Date(s.savedAt) } : null; } catch { return null; } });
  const [quickMinimized, setQuickMinimized] = useState(() => { try { return !!JSON.parse(localStorage.getItem('og_quick_panel') || 'null')?.quickSaved; } catch { return false; } });
  const [allMeetings,    setAllMeetings]    = useState([]);   // all old_gold_meetings, newest first
  const [expandedMtgIds, setExpandedMtgIds] = useState(new Set());

  // Conversation-level archive (localStorage-backed): moves a contact's convo below the fold without deleting it
  const [convArchivedIds,     setConvArchivedIds]     = useState(() => { try { return new Set(JSON.parse(localStorage.getItem('og_conv_archived') || '[]')); } catch { return new Set(); } });
  const [expandedArchivedIds, setExpandedArchivedIds] = useState(new Set());
  const archiveConversation = (pid) => setConvArchivedIds(prev => { const n = new Set(prev); n.add(pid); localStorage.setItem('og_conv_archived', JSON.stringify([...n])); return n; });
  const unarchiveConversation = (pid) => setConvArchivedIds(prev => { const n = new Set(prev); n.delete(pid); localStorage.setItem('og_conv_archived', JSON.stringify([...n])); return n; });

  const [companyPanel,        setCompanyPanel]        = useState(null);
  const [companyPanelLoading, setCompanyPanelLoading] = useState(false);

  // Thesis
  const [thesisBuilding, setThesisBuilding] = useState(false);
  const [thesisError,    setThesisError]    = useState('');
  const [thesisModal,    setThesisModal]    = useState(null); // { thesis, risks, nextStep } | null

  // Move to Pipeline
  const [pipelineConfirm,   setPipelineConfirm]   = useState(null); // { stage } | null
  const [movingToPipeline,  setMovingToPipeline]  = useState(false);
  const [pipelineError,     setPipelineError]     = useState('');

  // Archived contacts (soft-delete) — "Delete contact" archives rather than
  // permanently deletes, and can be restored from this section.
  const [archivedProspects, setArchivedProspects] = useState([]);
  const [loadingArchived,   setLoadingArchived]   = useState(false);
  const [showArchived,      setShowArchived]      = useState(false);
  const [restoringId,       setRestoringId]       = useState(null);

  // Load error (shown at top of page body if prospects fail to load)
  const [loadError, setLoadError] = useState('');

  // CSV import (e.g. a LinkedIn "My Connections" export)
  const [importingCsv, setImportingCsv] = useState(false);
  const csvInputRef = useRef(null);

  // Persist active panel state
  useEffect(() => {
    if (quickSaved) {
      localStorage.setItem('og_quick_panel', JSON.stringify({ quickSaved, quickResult, quickExtracted, quickCrossRefs, quickEmailHint }));
    } else {
      localStorage.removeItem('og_quick_panel');
    }
  }, [quickSaved, quickResult, quickExtracted, quickCrossRefs, quickEmailHint]);

  // Refs so async drop handler always sees current state (avoids stale closures)
  const showImportRef    = useRef(showImport);
  const showQuickPanelRef = useRef(showQuickPanel);
  const quickSavedRef     = useRef(quickSaved);
  const quickResultRef    = useRef(quickResult);
  useEffect(() => { showImportRef.current    = showImport;    }, [showImport]);
  useEffect(() => { showQuickPanelRef.current = showQuickPanel; }, [showQuickPanel]);
  useEffect(() => { quickSavedRef.current     = quickSaved;    }, [quickSaved]);
  useEffect(() => { quickResultRef.current    = quickResult;   }, [quickResult]);

  // ── Document-level drag/drop (same pattern as SignalWatchPage) ────────────
  useEffect(() => {
    if (!isActive) return;
    const onDragOver  = e => { e.preventDefault(); setDropDragging(true); };
    const onDragLeave = e => { if (!e.relatedTarget) setDropDragging(false); };
    const onDrop = async e => {
      e.preventDefault();
      setDropDragging(false);
      const file = e.dataTransfer?.files?.[0];
      let text = '';
      if (file) {
        try { text = await readFileText(file); }
        catch (err) { setQuickError(err.message); return; }
      } else {
        text = e.dataTransfer?.getData('text/plain') || e.dataTransfer?.getData('text') || '';
      }
      if (!text) return;
      // Route to whichever textarea is currently visible
      if (showImportRef.current) {
        setImportTranscript(text);
      } else {
        // If there's already a saved transcript, clear panel state (DB records stay) before starting new one
        if (quickSavedRef.current) {
          setQuickResult(null); setQuickExtracted(null); setQuickCrossRefs(null);
          setQuickEmailHint(''); setQuickSaved(null); setQuickMinimized(false); setQuickError('');
        }
        setQuickText(text);
        setShowQuickPanel(true);
      }
    };
    document.addEventListener('dragover',  onDragOver);
    document.addEventListener('dragleave', onDragLeave);
    document.addEventListener('drop',      onDrop);
    return () => {
      document.removeEventListener('dragover',  onDragOver);
      document.removeEventListener('dragleave', onDragLeave);
      document.removeEventListener('drop',      onDrop);
    };
  }, [isActive]);

  // ── Quick-drop analysis + auto-save ──────────────────────────────────────
  const handleQuickAnalyze = async (text) => {
    if (!text.trim()) return;
    setQuickAnalyzing(true);
    setQuickError('');
    setQuickResult(null);
    setQuickExtracted(null);
    setQuickCrossRefs(null);
    setQuickEmailHint('');
    setQuickSaved(null);
    try {
      // 1. AI analysis
      const result = await processTranscriptWithAI(text);
      setQuickResult(result);

      const extracted = {
        contact_name:  result.contact_name  || '',
        company_name:  result.company_name  || '',
        contact_email: result.contact_email || '',
      };
      setQuickExtracted(extracted);

      // 2. Cross-reference
      const refs = await crossReferenceContact(extracted.contact_name, extracted.company_name);
      setQuickCrossRefs(refs);

      // 3. Best email from all sources
      let emailHint = extracted.contact_email || '';
      if (!emailHint && refs.pipeline?.length) {
        const d = refs.pipeline.find(d => d.contact_email);
        if (d) emailHint = d.contact_email;
      }
      if (!emailHint && refs.intel?.length) {
        for (const co of refs.intel) {
          const angle = (co.contact_angles || []).find(c => c.email);
          if (angle) { emailHint = angle.email; break; }
        }
      }
      if (emailHint) setQuickEmailHint(emailHint);

      // 4. Auto-save to Old Gold immediately
      const nameLower    = extracted.contact_name.toLowerCase().trim();
      const companyLower = extracted.company_name.toLowerCase().trim();

      // Fuzzy name helper: compare first 4 chars of first word (handles Vicki/Vickie, etc.)
      const firstName4 = s => (s.trim().split(/\s+/)[0] || '').slice(0, 4);
      const lastName   = s => (s.trim().split(/\s+/).pop() || '');

      const existingMatch = prospects.find(p => {
        const pName = (p.name || '').toLowerCase().trim();
        const pCo   = (p.company || '').toLowerCase().trim();
        // Fuzzy first-name (4-char prefix) + exact last-name
        const fuzzyName = nameLower && lastName(nameLower) && lastName(pName) &&
          firstName4(nameLower) === firstName4(pName) && lastName(nameLower) === lastName(pName);
        // Substring name match (legacy)
        const subName = nameLower && (pName.includes(nameLower) || nameLower.includes(pName));
        // Bidirectional company match
        const subCo = companyLower && companyLower.length > 2 &&
          (pCo.includes(companyLower) || companyLower.includes(pCo));
        return fuzzyName || subName || subCo;
      });

      let prospectId, savedProspect;
      if (existingMatch) {
        prospectId    = existingMatch.id;
        savedProspect = existingMatch;
      } else {
        const { data, error } = await supabase.from('old_gold_prospects').insert({
          name:    extracted.contact_name || 'New Contact',
          company: extracted.company_name || '',
          email:   emailHint || extracted.contact_email || '',
          status:  'warm',
        }).select().single();
        if (error) throw new Error(error.message);
        prospectId    = data.id;
        savedProspect = data;
        setProspects(prev => [data, ...prev]);
      }

      const mtgDate = result.meeting_date || new Date().toISOString().slice(0, 10);
      const { data: mtg, error: mtgErr } = await supabase.from('old_gold_meetings').insert({
        prospect_id:  prospectId,
        title:        `Meeting — ${fmtDate(mtgDate)}`,
        meeting_date: mtgDate,
        transcript:   text,
        summary:      result.summary,
        action_items: result.action_items || [],
      }).select().single();
      if (mtgErr) throw new Error(mtgErr.message);

      if (result.action_items?.length && mtg) {
        const { error: taskErr } = await supabase.from('old_gold_tasks').insert(
          result.action_items.map(ai => ({
            prospect_id: prospectId,
            meeting_id:  mtg.id,
            title:       ai.title,
            due_date:    ai.due_date || null,
            notes:       ai.owner ? `Owner: ${ai.owner}` : '',
          }))
        );
        if (taskErr) console.error('Task insert failed:', taskErr.message);
      }

      // Pick "our" name from action item owners (AI usually puts Pete/Peter there)
      // ourName should always be Pete/Peter — look for Peter/Pete specifically, don't accidentally use the contact's name
      const ourName = result.action_items?.find(ai => /^pete/i.test(ai.owner || ''))?.owner || 'Pete';
      // Use the meeting date from the transcript if the AI extracted one, otherwise now
      const meetingDate = result.meeting_date ? new Date(result.meeting_date + 'T12:00:00') : new Date();
      setQuickSaved({ prospect: savedProspect, meetingId: mtg?.id || null, savedAt: meetingDate, ourName });
      // Prepend to home list immediately
      if (mtg) setAllMeetings(prev => [{ ...mtg, old_gold_prospects: savedProspect }, ...prev]);

    } catch (e) {
      setQuickError(e.message || 'Analysis failed');
    } finally {
      setQuickAnalyzing(false);
    }
  };

  // Save meeting directly into a Pipeline deal card
  const resetQuickPanel = (opts = {}) => {
    // If deleting (not just resetting for a new analysis), remove the meeting + tasks from DB
    if (opts.deleteRecords && quickSaved?.meetingId) {
      supabase.from('old_gold_tasks').delete().eq('meeting_id', quickSaved.meetingId).then(() =>
        supabase.from('old_gold_meetings').delete().eq('id', quickSaved.meetingId)
      );
    }
    setQuickText(''); setQuickResult(null); setShowQuickPanel(false);
    setQuickExtracted(null); setQuickCrossRefs(null); setQuickEmailHint('');
    setQuickSaved(null); setQuickMinimized(false);
  };

  const handleSaveToDeal = async (deal) => {
    if (!quickResult) return;
    setQuickSaving(true);
    setQuickError('');
    try {
      await saveProjectMeeting({
        dealId:      deal.id,
        title:       `Meeting — ${quickExtracted?.contact_name || 'Contact'} · ${fmtDate(new Date().toISOString().slice(0, 10))}`,
        meetingDate: new Date().toISOString().slice(0, 10),
        transcript:  quickText,
        summary:     quickResult.summary,
        actionItems: quickResult.action_items || [],
        attendees:   quickExtracted?.contact_name ? [quickExtracted.contact_name] : [],
      });
      resetQuickPanel();
      onNavigate && onNavigate('deals', deal.id);
    } catch (e) {
      setQuickError(e.message || 'Failed to save to Pipeline deal');
    } finally {
      setQuickSaving(false);
    }
  };

  // ── Data fetching ─────────────────────────────────────────────────────────
  const loadProspects = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('old_gold_prospects')
      .select('*')
      .is('archived_at', null)
      .order('created_at', { ascending: false });
    if (error) { setLoadError('Failed to load contacts: ' + error.message); setLoading(false); return; }
    setProspects(data || []);
    setLoading(false);
  }, []);

  const loadArchivedProspects = useCallback(async () => {
    setLoadingArchived(true);
    const { data, error } = await supabase
      .from('old_gold_prospects')
      .select('*')
      .not('archived_at', 'is', null)
      .order('archived_at', { ascending: false });
    if (error) { setLoadError('Failed to load contacts: ' + error.message); setLoadingArchived(false); return; }
    setArchivedProspects(data || []);
    setLoadingArchived(false);
  }, []);

  const loadDetail = useCallback(async (prospect) => {
    setDetailLoading(true);
    // Load meetings first so we can also query tasks by meeting_id
    const { data: mtgs } = await supabase
      .from('old_gold_meetings')
      .select('*')
      .eq('prospect_id', prospect.id)
      .order('meeting_date', { ascending: false });
    setMeetings(mtgs || []);

    const meetingIds = (mtgs || []).map(m => m.id);
    // Query tasks both ways and merge (handles tables created before prospect_id was standard)
    const queries = [
      supabase.from('old_gold_tasks').select('*').eq('prospect_id', prospect.id),
    ];
    if (meetingIds.length) {
      queries.push(supabase.from('old_gold_tasks').select('*').in('meeting_id', meetingIds));
    }
    const results = await Promise.all(queries);
    const seen = new Set();
    const dbTasks = results
      .flatMap(r => r.data || [])
      .filter(t => { if (seen.has(t.id)) return false; seen.add(t.id); return true; })
      .sort((a, b) => new Date(a.created_at) - new Date(b.created_at));

    // Also surface tasks from meeting action_items JSON that never made it to old_gold_tasks
    // (silent save failures, older imports, etc.) — dedup by lowercased title
    const dbTitles = new Set(dbTasks.map(t => t.title?.trim().toLowerCase()));
    const fallbackTasks = [];
    (mtgs || []).forEach(mtg => {
      (mtg.action_items || []).forEach(ai => {
        if (ai.type && ai.type !== 'task') return;
        const key = ai.title?.trim().toLowerCase();
        if (!key || dbTitles.has(key)) return;
        dbTitles.add(key);
        fallbackTasks.push({
          id: `mtg-${mtg.id}-${key}`,
          prospect_id: prospect.id,
          meeting_id: mtg.id,
          title: ai.title,
          due_date: ai.due_date || null,
          notes: ai.owner ? `Owner: ${ai.owner}` : '',
          completed: false,
          _fromMeeting: true, // flag so we don't try to toggle/delete in DB by this id
        });
      });
    });

    setTasks([...dbTasks, ...fallbackTasks]);
    setDetailLoading(false);
  }, []);

  useEffect(() => { loadProspects(); }, [loadProspects]);

  // Load all meetings newest → oldest for the home page list
  const loadAllMeetings = useCallback(async () => {
    const { data } = await supabase
      .from('old_gold_meetings')
      .select('*, old_gold_prospects(id, name, company, status)')
      .order('meeting_date', { ascending: false })
      .order('created_at', { ascending: false });
    setAllMeetings(data || []);
  }, []);
  useEffect(() => { loadAllMeetings(); }, [loadAllMeetings]);

  // Load all known companies (Pipeline deals + Company Intel) for the link dropdown
  useEffect(() => {
    async function loadAllCompanies() {
      const [{ data: companies }, { data: deals }] = await Promise.all([
        supabase.from('companies').select('id, name').order('name'),
        supabase.from('deals').select('id, company_name').not('company_name', 'is', null),
      ]);
      const map = new Map();
      (companies || []).forEach(c => {
        if (c.name) map.set(c.name.toLowerCase(), { name: c.name, source: 'intel', id: c.id });
      });
      (deals || []).forEach(d => {
        if (d.company_name && !map.has(d.company_name.toLowerCase()))
          map.set(d.company_name.toLowerCase(), { name: d.company_name, source: 'pipeline', id: d.id });
      });
      setAllCompanies(Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name)));
    }
    loadAllCompanies();
  }, []);

  const openProspect = (p) => {
    setActive(p);
    setEditingProspect(false);
    setShowImport(false);
    setDossierContact(null);
    setCompanyPanel(null);
    setClientRecord(null);
    loadDetail(p);
    loadDossierContact(p);
    loadCompanyPanel(p.company);
    if (p.company?.trim()) {
      findOrCreateClient(p.company.trim()).then(setClientRecord).catch(() => {});
    }
  };

  const loadCompanyPanel = async (companyName) => {
    if (!companyName?.trim()) { setCompanyPanel(null); return; }
    setCompanyPanelLoading(true);
    try {
      const [{ data: wlRows }, { data: dealRows }, { data: clientRows }] = await Promise.all([
        supabase.from('companies').select('*').ilike('name', companyName.trim()).limit(1),
        supabase.from('deals').select('id, company_name, stage, value').ilike('company_name', companyName.trim()).not('stage', 'eq', 'lost').order('created_at', { ascending: false }).limit(1),
        supabase.from('clients').select('id, name, projects(id, name, status, archived_at)').ilike('name', companyName.trim()).limit(1),
      ]);
      setCompanyPanel({ watchlist: wlRows?.[0] || null, deal: dealRows?.[0] || null, client: clientRows?.[0] || null });
    } catch (e) {
      console.error('loadCompanyPanel:', e);
      setCompanyPanel(null);
    } finally {
      setCompanyPanelLoading(false);
    }
  };

  // Load dossier for the primary prospect. Checks clients.contacts first (most
  // enriched — shared with project cards), then falls back to companies.contacts
  // (shared with Watch List / Pipeline).
  const loadDossierContact = async (p) => {
    if (!p.company?.trim()) return;
    const nameLower = p.name?.trim().toLowerCase();
    if (!nameLower) return;
    try {
      // Primary source: clients.contacts (set when clientRecord loads, but may not be ready yet)
      const { data: clientRow } = await supabase
        .from('clients').select('contacts').ilike('name', p.company.trim()).limit(1).maybeSingle();
      const fromClient = (clientRow?.contacts || []).find(c => c.name?.trim().toLowerCase() === nameLower);
      if (fromClient) { setDossierContact(fromClient); return; }
      // Fallback: companies.contacts
      const { data: company } = await supabase.from('companies').select('contacts').ilike('name', p.company.trim()).limit(1).maybeSingle();
      const fromCompany = (company?.contacts || []).find(c => c.name?.trim().toLowerCase() === nameLower);
      if (fromCompany) setDossierContact(fromCompany);
    } catch { /* non-fatal */ }
  };

  const handleBuildDossier = async () => {
    if (!active) return;
    if (!active.company?.trim()) { alert('Add a company for this contact first — the dossier is stored on the shared company record so it shows up everywhere this contact appears.'); return; }
    setBuildingDossier(true);
    try {
      const company = await findOrCreateCompany(active.company.trim());
      const baseContact = dossierContact || { name: active.name, title: active.title || '', email: active.email || '', linkedin: active.linkedin || '' };
      const merged = await enrichCompanyContact(company.id, baseContact, company.name);
      const updated = merged.find(c => c.name?.trim().toLowerCase() === active.name?.trim().toLowerCase());
      setDossierContact(updated || null);
      // Also save to clients.contacts so it's visible in project cards and ClientsPage
      if (updated && clientRecord?.id) {
        const newContacts = await upsertClientContacts(clientRecord.id, [updated]);
        setClientRecord(cr => cr ? { ...cr, contacts: newContacts } : cr);
      }
    } catch (e) {
      alert('Error building dossier: ' + e.message);
    } finally {
      setBuildingDossier(false);
    }
  };

  const closeOverlay = useCallback(async () => {
    clearTimeout(autoSaveTimer.current);
    if (editingProspect && hasEdited.current && prospectDraft.name?.trim() && active) {
      await supabase.from('old_gold_prospects').update({ ...prospectDraft, updated_at: new Date().toISOString() }).eq('id', active.id);
    }
    setActive(null); setMeetings([]); setTasks([]); setDossierContact(null); setCompanyPanel(null); setClientRecord(null);
    setEditingProspect(false); setAutoSaveStatus('idle'); setProspectDraft(BLANK_PROSPECT);
    hasEdited.current = false;
    setThesisBuilding(false); setThesisError(''); setThesisModal(null);
    setPipelineConfirm(null); setMovingToPipeline(false); setPipelineError('');
    setDeleteConfirmId(null);
  }, [editingProspect, active, prospectDraft]);

  const handleBuildThesis = async () => {
    if (!active?.company?.trim()) { alert('Add a company for this contact first.'); return; }
    const companyName = active.company.trim();
    setThesisBuilding(true);
    setThesisError('');
    try {
      const company = await findOrCreateCompany(companyName);
      await runBuildThesis(company.id, company, icp, {}, () => {});
      // Only refresh panel if overlay is still open for the same contact
      if (active?.company?.trim() === companyName) await loadCompanyPanel(companyName);
    } catch (e) {
      setThesisError('Build failed: ' + e.message);
    } finally {
      setThesisBuilding(false);
    }
  };

  const handleMoveToPipeline = useCallback(async () => {
    if (!active || !pipelineConfirm) return;
    setMovingToPipeline(true);
    setPipelineError('');
    try {
      const deal = await upsertDeal({
        company_name:  active.company || '',
        contact_name:  active.name    || '',
        contact_email: active.email   || '',
        stage:         pipelineConfirm.stage,
      });
      closeOverlay();
      onNavigate && onNavigate('deals', deal.id);
    } catch (e) {
      setPipelineError('Error: ' + e.message);
      setMovingToPipeline(false);
    }
  }, [active, pipelineConfirm, closeOverlay, onNavigate]);

  // ── Prospect CRUD ─────────────────────────────────────────────────────────
  const handleSaveProspect = async () => {
    if (!prospectDraft.name.trim()) return;
    setSaving(true);
    try {
      const { data, error } = await supabase.from('old_gold_prospects').insert(prospectDraft).select().single();
      if (error) throw new Error(error.message);
      setProspects(prev => [data, ...prev]);
      openProspect(data);
      setAddingProspect(false);
      setProspectDraft(BLANK_PROSPECT);
    } catch (e) {
      alert('Error saving contact: ' + e.message);
    } finally {
      setSaving(false);
    }
  };

  // Autosave contact edits with 800ms debounce
  useEffect(() => {
    if (!editingProspect || !active || !hasEdited.current) return;
    if (!prospectDraft.name?.trim()) return;
    const targetId = active.id; // capture so the async callback always writes the right row
    clearTimeout(autoSaveTimer.current);
    setAutoSaveStatus('saving');
    autoSaveTimer.current = setTimeout(async () => {
      try {
        const { data, error } = await supabase.from('old_gold_prospects').update({ ...prospectDraft, updated_at: new Date().toISOString() }).eq('id', targetId).select().single();
        if (error) throw error;
        setActive(prev => prev?.id === targetId ? data : prev);
        setProspects(prev => prev.map(p => p.id === data.id ? data : p));
        setAutoSaveStatus('saved');
        setTimeout(() => setAutoSaveStatus(s => s === 'saved' ? 'idle' : s), 2500);
      } catch {
        setAutoSaveStatus('error');
      }
    }, 800);
  }, [prospectDraft, editingProspect, active]);

  const handleDoneEditing = async () => {
    clearTimeout(autoSaveTimer.current);
    if (hasEdited.current && prospectDraft.name?.trim() && active) {
      setAutoSaveStatus('saving');
      try {
        const { data, error } = await supabase.from('old_gold_prospects').update({ ...prospectDraft, updated_at: new Date().toISOString() }).eq('id', active.id).select().single();
        if (error) throw error;
        setActive(data);
        setProspects(prev => prev.map(p => p.id === data.id ? data : p));
      } catch (e) {
        alert('Error saving contact: ' + e.message);
        return;
      }
    }
    setEditingProspect(false);
    setAutoSaveStatus('idle');
    setProspectDraft(BLANK_PROSPECT);
    hasEdited.current = false;
  };

  // Archives (never permanently deletes) a contact — hides it from the active
  // list and meeting feed, but it stays fully intact and restorable from the
  // "Archived contacts" section. Meetings/tasks are untouched either way.
  const handleArchiveProspect = async () => {
    if (!active || !window.confirm(`Archive ${active.name}? Their meetings and tasks stay intact, and you can restore them anytime from the Archived contacts section.`)) return;
    const archived_at = new Date().toISOString();
    const { error } = await supabase.from('old_gold_prospects').update({ archived_at }).eq('id', active.id);
    if (error) { alert('Could not archive contact: ' + error.message); return; }
    setProspects(prev => prev.filter(p => p.id !== active.id));
    setArchivedProspects(prev => [{ ...active, archived_at }, ...prev]);
    setActive(null);
  };

  const handleRestoreProspect = async (prospect) => {
    setRestoringId(prospect.id);
    try {
      await supabase.from('old_gold_prospects').update({ archived_at: null }).eq('id', prospect.id);
      setArchivedProspects(prev => prev.filter(p => p.id !== prospect.id));
      setProspects(prev => [{ ...prospect, archived_at: null }, ...prev]);
    } finally {
      setRestoringId(null);
    }
  };

  // ── CSV import (e.g. LinkedIn "My Connections" export) ─────────────────────
  // Expected columns: First Name, Last Name, Linkedin URL, Email Address, Company, Position, Connected On.
  // Each row becomes an Old Gold prospect. Each unique Company is also
  // pushed into the Watch List (companies table), tagged "Old Gold" and with
  // this person merged into its contacts, so it can be scanned and promoted
  // into the pipeline from there.
  const handleImportCsv = useCallback(async (fileList) => {
    const file = Array.from(fileList || []).find(f => f.name.match(/\.csv$/i));
    if (!file) { alert('Please choose a CSV file.'); return; }
    setImportingCsv(true);
    try {
      const text = await file.text();
      const rows = parseCsvRows(text);
      if (!rows.length) { alert('No rows found in that CSV.'); return; }

      const existingKeys = new Set(
        prospects.map(p => `${p.name?.trim().toLowerCase()}|${(p.company || '').trim().toLowerCase()}`)
      );
      const newProspects = [];
      const peopleByCompany = new Map(); // company name → [{name,title,email,linkedin}]
      let parsedCount = 0; // rows that had a usable name, regardless of dedupe outcome
      let skippedAsDupe = 0;

      for (const row of rows) {
        const first = row.first_name || '';
        const last  = row.last_name || '';
        const name  = `${first} ${last}`.trim();
        if (!name) continue;
        parsedCount++;
        const company  = row.company || '';
        const title    = row.position || '';
        const email    = row.email_address || row.email || '';
        const linkedin = row.linkedin_url || row.linkedin || row.url || '';
        const key = `${name.toLowerCase()}|${company.toLowerCase()}`;
        if (existingKeys.has(key)) { skippedAsDupe++; continue; } // already an Old Gold contact — skip
        existingKeys.add(key);

        const notes = row.connected_on ? `Connected on LinkedIn: ${row.connected_on}` : '';
        newProspects.push({ name, company: company || null, title: title || null, email: email || null, linkedin: linkedin || null, notes: notes || null, status: 'warm' });

        if (company) {
          if (!peopleByCompany.has(company)) peopleByCompany.set(company, []);
          peopleByCompany.get(company).push({ name, title, email, linkedin, source: 'old_gold' });
        }
      }

      if (!newProspects.length) {
        if (parsedCount === 0) {
          alert(`Found ${rows.length} row${rows.length !== 1 ? 's' : ''} in that CSV, but couldn't read a First Name/Last Name from any of them. Check that the file has those exact column headers.`);
        } else {
          alert(`Nothing new to import — all ${skippedAsDupe} contact${skippedAsDupe !== 1 ? 's' : ''} already exist in Old Gold.`);
        }
        return;
      }

      const { data: inserted, error } = await supabase.from('old_gold_prospects').insert(newProspects).select();
      if (error) throw new Error(error.message);
      setProspects(prev => [...(inserted || newProspects), ...prev]);

      // Tag each unique company for Watch List and merge this person into its contacts
      let companiesTagged = 0;
      let failedCount = 0;
      for (const [companyName, people] of peopleByCompany) {
        try {
          const company = await findOrCreateCompany(companyName);
          const tags = Array.isArray(company.tags) ? company.tags : [];
          const newTags = tags.includes('Old Gold') ? tags : [...tags, 'Old Gold'];
          await supabase.from('companies').update({ tags: newTags }).eq('id', company.id);
          await upsertCompanyContacts(company.id, people);
          companiesTagged++;
        } catch (e) {
          failedCount++;
          console.warn('[Old Gold import] Failed to tag company for Watch List:', companyName, e.message);
        }
      }

      if (failedCount > 0) {
        alert(`Imported ${newProspects.length} contacts. ${failedCount} companies could not be tagged — check console for details.`);
      } else {
        alert(
          `Imported ${newProspects.length} new contact${newProspects.length !== 1 ? 's' : ''} into Old Gold` +
          (companiesTagged ? `, and tagged ${companiesTagged} compan${companiesTagged !== 1 ? 'ies' : 'y'} "Old Gold" in Watch List.` : '.')
        );
      }
    } catch (e) {
      alert('Import failed: ' + e.message);
    } finally {
      setImportingCsv(false);
    }
  }, [prospects]);

  // ── Transcript import + AI ────────────────────────────────────────────────
  const handleImport = async () => {
    if (!importTranscript.trim() || !active) return;
    setImporting(true);
    setImportError('');
    try {
      const { summary, action_items, rapport_moments, suggested_contacts } = await processTranscriptWithAI(
        importTranscript,
        active.name,
        active.company,
      );

      // Merge all typed items into a single action_items array for storage
      const allItems = [
        ...(action_items || []).map(ai => ({ ...ai, type: 'task' })),
        ...(rapport_moments || []).map(m => ({ ...m, type: 'moment' })),
        ...(suggested_contacts || []).map(c => ({ ...c, type: 'contact' })),
      ];

      const { data: mtg, error } = await supabase.from('old_gold_meetings').insert({
        prospect_id:  active.id,
        title:        importTitle.trim() || `Meeting — ${fmtDate(importDate)}`,
        meeting_date: importDate,
        transcript:   importTranscript,
        summary,
        action_items: allItems,
      }).select().single();

      if (error) throw error;

      // Save only task-typed items to old_gold_tasks
      const taskItems = allItems.filter(ai => ai.type === 'task');
      if (taskItems.length) {
        const taskRows = taskItems.map(ai => ({
          prospect_id: active.id,
          meeting_id:  mtg.id,
          title:       ai.title,
          due_date:    ai.due_date || null,
          notes:       ai.owner ? `Owner: ${ai.owner}` : '',
        }));
        const { data: newTasks } = await supabase.from('old_gold_tasks').insert(taskRows).select();
        setTasks(prev => [...prev, ...(newTasks || [])]);
      }

      setMeetings(prev => [mtg, ...prev]);
      setShowImport(false);
      setImportTitle('');
      setImportDate(new Date().toISOString().slice(0, 10));
      setImportTranscript('');
    } catch (e) {
      setImportError(e.message || 'Failed to import transcript');
    } finally {
      setImporting(false);
    }
  };

  // ── Task CRUD ─────────────────────────────────────────────────────────────
  const handleAddTask = async () => {
    if (!newTaskTitle.trim() || !active) return;
    const { data } = await supabase.from('old_gold_tasks').insert({
      prospect_id: active.id,
      title:       newTaskTitle.trim(),
      due_date:    newTaskDue || null,
    }).select().single();
    if (data) setTasks(prev => [...prev, data]);
    setNewTaskTitle('');
    setNewTaskDue('');
    setAddingTask(false);
  };

  const handleToggleTask = async (task) => {
    const completed = !task.completed;
    if (!task._fromMeeting) {
      await supabase.from('old_gold_tasks').update({ completed, completed_at: completed ? new Date().toISOString() : null }).eq('id', task.id);
    }
    setTasks(prev => prev.map(t => t.id === task.id ? { ...t, completed, completed_at: completed ? new Date().toISOString() : null } : t));
  };

  const handleDeleteTask = async (id) => {
    const task = tasks.find(t => t.id === id);
    if (!task?._fromMeeting) {
      await supabase.from('old_gold_tasks').delete().eq('id', id);
    }
    setTasks(prev => prev.filter(t => t.id !== id));
  };

  // ── List view ─────────────────────────────────────────────────────────────
  return (
    <div className="page-body">
        {/* Header */}
        <div className="page-header" style={{ marginBottom: 24 }}>
          <div className="page-header-left">
            <h2 style={{ fontSize: 22, fontWeight: 800, color: 'var(--text)' }}>Old Gold</h2>
            <p style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 2 }}>Pete's warm outreach — discovery conversations & next steps</p>
          </div>
          <div className="page-header-actions" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search contacts…"
              style={{ width: 200, fontSize: 13, padding: '6px 10px' }}
            />
            <button
              onClick={() => csvInputRef.current?.click()}
              disabled={importingCsv}
              className="btn"
              title="Import a CSV export of your LinkedIn connections"
            >{importingCsv ? 'Importing…' : 'Import CSV'}</button>
            <input
              ref={csvInputRef}
              type="file"
              accept=".csv"
              style={{ display: 'none' }}
              onChange={e => { handleImportCsv(e.target.files); e.target.value = ''; }}
            />
            <button
              onClick={() => { setProspectDraft(BLANK_PROSPECT); setAddingProspect(true); }}
              className="btn btn-primary"
            >+ Add Contact</button>
          </div>
        </div>

        {addingProspect && <ProspectForm draft={prospectDraft} setDraft={setProspectDraft} allCompanies={allCompanies} onSave={handleSaveProspect} saving={saving} onCancel={() => setAddingProspect(false)} />}

        {loadError && (
          <div style={{ marginBottom: 16, padding: '12px 16px', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, display: 'flex', alignItems: 'center', gap: 12 }}>
            <span style={{ fontSize: 13, color: '#b91c1c', flex: 1 }}>{loadError}</span>
            <button onClick={() => { setLoadError(''); loadProspects(); }} style={{ fontSize: 12, fontWeight: 700, padding: '4px 12px', borderRadius: 6, border: '1px solid #fca5a5', background: 'transparent', color: '#b91c1c', cursor: 'pointer', whiteSpace: 'nowrap' }}>Retry</button>
          </div>
        )}

        {/* ── Quick transcript drop zone ── */}
        <div style={{ marginBottom: 24 }}>
          {!showQuickPanel ? (
            /* Collapsed: small drop target */
            <div
              onClick={() => setShowQuickPanel(true)}
              style={{
                border: `2px dashed ${dropDragging ? 'var(--accent)' : 'var(--border)'}`,
                borderRadius: 10,
                padding: '16px 20px',
                background: dropDragging ? '#fffbeb' : 'var(--surface)',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                transition: 'all .15s',
              }}
            >
              <span style={{ fontSize: 22 }}>🪩</span>
              <div>
                <div style={{ fontSize: 13, fontWeight: 700, color: dropDragging ? 'var(--accent)' : 'var(--text)' }}>
                  {dropDragging ? 'Drop to analyze' : 'Drop or paste a transcript'}
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-faint)', marginTop: 1 }}>
                  Granola .rtf / .txt — saved automatically
                </div>
              </div>
            </div>
          ) : (
            /* Expanded / minimized panel */
            <div style={{ border: '1px solid var(--accent)', borderRadius: 10, background: 'var(--surface)', overflow: 'hidden' }}>

              {/* Header — always visible */}
              <div
                onClick={() => quickResult && setQuickMinimized(m => !m)}
                style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 16px', background: '#fffbeb', borderBottom: quickMinimized ? 'none' : '1px solid #fde68a', cursor: quickResult ? 'pointer' : 'default', userSelect: 'none' }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, flex: 1, minWidth: 0 }}>
                  {quickSaved ? (
                    <span style={{ fontSize: 13, fontWeight: 700, color: '#92400e', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {quickSaved.ourName} & {quickSaved.prospect.name}
                      {quickSaved.prospect.company ? ` — ${quickSaved.prospect.company}` : ''}
                      {', '}
                      {quickSaved.savedAt.toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: '2-digit' })}
                      {', '}
                      {quickSaved.savedAt.toLocaleTimeString('en-GB', { hour: 'numeric', minute: '2-digit', hour12: true })}
                    </span>
                  ) : null}
                </div>
                {quickResult && (
                  <span style={{ fontSize: 12, color: '#92400e', flexShrink: 0, marginLeft: 8 }}>
                    {quickMinimized ? '▼' : '▲'}
                  </span>
                )}
              </div>

              {/* Minimized action-items strip */}
              {quickMinimized && quickResult?.action_items?.length > 0 && (
                <div style={{ padding: '8px 16px', borderTop: '1px solid #fde68a', background: '#fffbeb', display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {quickResult.action_items.map((ai, i) => (
                    <span key={i} style={{ fontSize: 11, padding: '3px 10px', borderRadius: 20, background: '#ede9fe', color: '#5b21b6' }}>
                      {ai.owner && <strong style={{ marginRight: 4 }}>{ai.owner}</strong>}{ai.title}
                      {ai.due_date && <span style={{ marginLeft: 6, opacity: 0.7 }}>{ai.due_date}</span>}
                    </span>
                  ))}
                </div>
              )}

              {!quickMinimized && <div style={{ padding: 16 }}>
                {!quickResult ? (
                  <>
                    <textarea
                      autoFocus
                      rows={8}
                      value={quickText}
                      onChange={e => setQuickText(e.target.value)}
                      placeholder="Paste your Granola transcript here, or drag a .rtf / .txt file onto this area…"
                      style={{ width: '100%', fontSize: 12, lineHeight: 1.6, fontFamily: 'monospace', marginBottom: 10, background: 'var(--bg)' }}
                    />
                    {quickError && <div style={{ fontSize: 12, color: '#ef4444', marginBottom: 8 }}>{quickError}</div>}
                    <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                      <button
                        onClick={() => handleQuickAnalyze(quickText)}
                        disabled={quickAnalyzing || !quickText.trim()}
                        style={{ fontSize: 12, fontWeight: 700, padding: '5px 18px', borderRadius: 6, border: 'none', background: 'var(--accent)', color: '#fff', cursor: 'pointer' }}
                      >{quickAnalyzing ? '⏳ Analyzing…' : '✨ Analyze'}</button>
                    </div>
                  </>
                ) : (
                  <>
                    {quickError && (
                      <div style={{ fontSize: 13, color: '#ef4444', marginBottom: 14, padding: '10px 12px', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, fontWeight: 600 }}>
                        ⚠ {quickError}
                      </div>
                    )}
                    {quickSaved && (() => {
                      const p = quickSaved.prospect;
                      const sm = statusMeta(p.status);
                      const linkedCo = p.company ? allCompanies.find(c => c.name.toLowerCase() === p.company.toLowerCase()) : null;
                      return (
                        <div style={{ marginBottom: 14, padding: '10px 14px', background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 10, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: 14, fontWeight: 800, color: 'var(--text)' }}>{p.name}</div>
                            {p.company && (
                              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 2 }}>
                                <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{p.company}</span>
                                {linkedCo && (
                                  <button onClick={() => { onNavigate && onNavigate(linkedCo.source === 'pipeline' ? 'deals' : 'clients', linkedCo.source === 'pipeline' ? linkedCo.id : null); }}
                                    style={{ fontSize: 10, fontWeight: 700, padding: '1px 6px', borderRadius: 10, border: `1px solid ${linkedCo.source === 'pipeline' ? '#fbbf24' : '#c4b5fd'}`, background: linkedCo.source === 'pipeline' ? '#fffbeb' : '#f5f3ff', color: linkedCo.source === 'pipeline' ? '#92400e' : '#5b21b6', cursor: 'pointer' }}>
                                    {linkedCo.source === 'pipeline' ? `⚡ ${linkedCo.name} →` : `🧠 ${linkedCo.name} →`}
                                  </button>
                                )}
                              </div>
                            )}
                          </div>
                          <span style={{ fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 20, background: sm.bg, color: sm.color }}>{sm.label}</span>
                          <button
                            onClick={() => { openProspect(p); setQuickMinimized(true); }}
                            style={{ fontSize: 11, fontWeight: 700, padding: '3px 12px', borderRadius: 20, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text-muted)', cursor: 'pointer', whiteSpace: 'nowrap' }}
                          >See All Conversations</button>
                          {quickCrossRefs?.pipeline?.map(deal => (
                            <div key={deal.id} style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 8, paddingTop: 8, borderTop: '1px solid var(--border)', flexWrap: 'wrap' }}>
                              <span style={{ fontSize: 11, color: '#78350f', flex: 1 }}>
                                ⚡ <strong>{deal.company_name}</strong> is in your Pipeline{deal.stage ? ` (${deal.stage})` : ''} — move the conversation there?
                              </span>
                              <button onClick={() => handleSaveToDeal(deal)} disabled={quickSaving}
                                style={{ fontSize: 12, fontWeight: 700, padding: '4px 12px', borderRadius: 6, border: '1px solid #fbbf24', background: '#fffbeb', color: '#92400e', cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0 }}
                              >{quickSaving ? 'Moving…' : `Move to ${deal.company_name} →`}</button>
                            </div>
                          ))}
                        </div>
                      );
                    })()}
                    {quickResult?.summary && (
                      <div style={{ marginBottom: 14 }}>
                        <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 5 }}>Summary</div>
                        <div style={{ fontSize: 13, color: 'var(--text)', lineHeight: 1.6 }}>{quickResult.summary}</div>
                      </div>
                    )}
                    {quickResult?.action_items?.length > 0 && (
                      <div style={{ marginBottom: 8 }}>
                        <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--accent)', textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 6 }}>Action Items</div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                          {quickResult.action_items.map((ai, i) => (
                            <div key={i} style={{ fontSize: 12, padding: '5px 9px', borderRadius: 6, background: '#ede9fe', display: 'flex', gap: 8, alignItems: 'baseline' }}>
                              {ai.owner && <span style={{ fontWeight: 700, color: '#6d28d9', flexShrink: 0 }}>{ai.owner}</span>}
                              <span style={{ flex: 1 }}>{ai.title}</span>
                              {ai.due_date && <span style={{ fontSize: 10, color: '#7c3aed', flexShrink: 0 }}>{ai.due_date}</span>}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </>
                )}
                {quickResult && (
                  <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 12 }}>
                    <button
                      onClick={() => { if (window.confirm('Delete this transcript? The contact card will stay but the meeting record will be removed.')) resetQuickPanel({ deleteRecords: true }); }}
                      style={{ fontSize: 10, padding: '2px 8px', borderRadius: 20, border: '1px solid #fca5a5', background: 'transparent', color: '#b91c1c', cursor: 'pointer' }}
                    >Delete transcript</button>
                  </div>
                )}
              </div>}
            </div>
          )}
        </div>

        {/* ── New transcript drop zone — shown after a transcript is already saved ── */}
        {quickSaved && (
          <div
            onClick={() => {
              if (quickSaved) setSavedStack(prev => [{ saved: quickSaved, result: quickResult }, ...prev]);
              setQuickResult(null); setQuickExtracted(null); setQuickCrossRefs(null);
              setQuickEmailHint(''); setQuickSaved(null); setQuickMinimized(false); setQuickError('');
              setShowQuickPanel(true);
            }}
            style={{
              marginBottom: 24,
              border: `2px dashed ${dropDragging ? 'var(--accent)' : 'var(--border)'}`,
              borderRadius: 10,
              padding: '10px 16px',
              background: dropDragging ? '#fffbeb' : 'transparent',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              transition: 'all .15s',
            }}
          >
            <span style={{ fontSize: 16 }}>🪩</span>
            <span style={{ fontSize: 12, color: dropDragging ? 'var(--accent)' : 'var(--text-muted)', fontWeight: 600 }}>
              {dropDragging ? 'Drop to analyze' : '+ Analyze another transcript'}
            </span>
          </div>
        )}

        {/* ── Active Conversations ── */}
        {(() => {
          const visible = allMeetings.filter(mtg => !quickSaved || mtg.id !== quickSaved.meetingId);
          const groups = new Map();
          visible.forEach(mtg => {
            const key = mtg.prospect_id || mtg.id;
            if (!groups.has(key)) groups.set(key, []);
            groups.get(key).push(mtg);
          });
          const cards = Array.from(groups.values()).map(conversations => {
            const latest = conversations[0];
            const p = latest.old_gold_prospects;
            const sm = p ? statusMeta(p.status) : null;
            const linkedCo = p?.company ? allCompanies.find(c => c.name.toLowerCase() === p.company.toLowerCase()) : null;
            const groupKey = p?.id || latest.id;
            if (p?.id && convArchivedIds.has(p.id)) return null;
            const expanded = expandedMtgIds.has(groupKey);
            // Combined action items across every conversation with this contact,
            // deduped by title (most recent conversation's version wins).
            const combinedTasks = (() => {
              const seen = new Map();
              conversations.forEach(mtg => (mtg.action_items || []).forEach(ai => {
                if (ai.type && ai.type !== 'task') return;
                const key = ai.title?.trim().toLowerCase();
                if (key && !seen.has(key)) seen.set(key, ai);
              }));
              return Array.from(seen.values());
            })();
            const combinedMoments = (() => {
              const seen = new Map();
              conversations.forEach(mtg => (mtg.action_items || []).forEach(ai => {
                if (ai.type !== 'moment') return;
                if (/^pete/i.test(ai.person || '')) return;
                const key = ai.title?.trim().toLowerCase();
                if (key && !seen.has(key)) seen.set(key, ai);
              }));
              return Array.from(seen.values());
            })();
            return (
            <div
              key={groupKey}
              onClick={() => p && openProspect(p)}
              style={{ border: '1px solid var(--accent)', borderRadius: 10, background: 'var(--surface)', overflow: 'hidden', display: 'flex', flexDirection: 'column', cursor: p ? 'pointer' : 'default' }}
            >
              {/* Header */}
              <div style={{ display: 'flex', alignItems: 'flex-start', padding: '10px 16px', background: '#fffbeb', borderBottom: (combinedTasks.length > 0 || combinedMoments.length > 0) ? '1px solid #fde68a' : 'none', gap: 10, userSelect: 'none' }}>
                <span style={{ fontSize: 13, fontWeight: 700, color: '#92400e', flex: 1, lineHeight: 1.4 }}>
                  {p?.name || 'Unknown'}
                  {p?.company ? ` — ${p.company}` : ''}
                  {latest.meeting_date ? `, ${new Date(latest.meeting_date + 'T12:00:00').toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: '2-digit' })}` : ''}
                  {latest.meeting_time ? `, ${latest.meeting_time}` : ''}
                  {conversations.length > 1 && (
                    <span style={{ fontSize: 11, fontWeight: 600, color: '#b45309', marginLeft: 8 }}>· {conversations.length} conversations</span>
                  )}
                </span>
                {sm && <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 20, background: sm.bg, color: sm.color, flexShrink: 0 }}>{sm.label}</span>}
                <span style={{ fontSize: 11, color: '#92400e', flexShrink: 0 }}>→</span>
              </div>

              {/* Preview: next steps + rapport moment pills */}
              {(combinedTasks.length > 0 || combinedMoments.length > 0) && (
                <div style={{ padding: '8px 16px 12px', display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {combinedTasks.length > 0 && (
                    <div>
                      <div style={{ fontSize: 9, fontWeight: 800, color: '#6d28d9', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 5 }}>Next Steps</div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                        {combinedTasks.map((ai, i) => (
                          <div key={i} style={{ fontSize: 11, padding: '4px 10px', borderRadius: 6, background: '#ede9fe', color: '#5b21b6', display: 'flex', gap: 6, alignItems: 'baseline' }}>
                            {ai.owner && <strong style={{ color: '#6d28d9', flexShrink: 0 }}>{ai.owner}</strong>}
                            <span style={{ flex: 1 }}>{ai.title}</span>
                            {ai.due_date && <span style={{ fontSize: 10, opacity: 0.6, flexShrink: 0 }}>{ai.due_date}</span>}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  {combinedMoments.length > 0 && (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                      {combinedMoments.map((m2, i) => (
                        <span key={i} title={m2.followup_prompt || m2.description || ''} style={{ fontSize: 11, padding: '2px 9px', borderRadius: 20, background: '#fef3c7', color: '#92400e', border: '1px solid #fde68a' }}>
                          {MOMENT_CATEGORY_ICON[m2.category] || '💬'} {m2.title}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
            );
          });
          const validCards = cards.filter(Boolean);
          if (!validCards.length) return null;
          return (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 14, marginBottom: 14 }}>
              {validCards}
            </div>
          );
        })()}

        {prospects.length > 0 && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, margin: '28px 0 20px' }}>
            <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
            <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '.06em' }}>All Contacts</span>
            <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
          </div>
        )}

        {loading ? (
          <div className="empty-state"><div className="spinner" /></div>
        ) : prospects.length === 0 && !addingProspect ? (
          <div className="empty-state" style={{ padding: '60px 0', textAlign: 'center' }}>
            <div style={{ fontSize: 40, marginBottom: 12 }}>🪙</div>
            <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--text)', marginBottom: 6 }}>No contacts yet</div>
            <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 20 }}>Add someone you're warming up to get started.</div>
            <button onClick={() => { setProspectDraft(BLANK_PROSPECT); setAddingProspect(true); }} className="btn btn-primary">+ Add Contact</button>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            {prospects
              .filter(p => {
                const inMeetingList = allMeetings.some(m => m.prospect_id === p.id);
                const isConvArchived = convArchivedIds.has(p.id);
                const inActivePanel = quickSaved?.prospect?.id === p.id;
                if (inActivePanel) return false;
                if (inMeetingList && !isConvArchived) return false;
                if (!search.trim()) return true;
                const q = search.trim().toLowerCase();
                return [p.name, p.company, p.title, p.email].some(f => f?.toLowerCase().includes(q));
              })
              .sort((a, b) => (a.name || '').localeCompare(b.name || ''))
              .map(p => {
                const sm = statusMeta(p.status);
                const isConvArchived = convArchivedIds.has(p.id);
                const isExpanded = expandedArchivedIds.has(p.id);
                const archivedConvs = isConvArchived ? allMeetings.filter(m => m.prospect_id === p.id) : [];
                return (
                  <div key={p.id}>
                    <div
                      onClick={() => {
                        if (isConvArchived) {
                          setExpandedArchivedIds(prev => { const s = new Set(prev); s.has(p.id) ? s.delete(p.id) : s.add(p.id); return s; });
                        } else {
                          openProspect(p);
                        }
                      }}
                      style={{ display: 'flex', alignItems: 'center', padding: '9px 14px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: isExpanded ? '8px 8px 0 0' : 8, cursor: 'pointer', gap: 10, transition: 'border-color .15s' }}
                      onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--accent)'; }}
                      onMouseLeave={e => { e.currentTarget.style.borderColor = isExpanded ? 'var(--accent)' : 'var(--border)'; }}
                    >
                      <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', minWidth: 160 }}>{p.name}</div>
                      {p.company && <div style={{ fontSize: 12, color: 'var(--text-muted)', flex: 1 }}>{p.company}</div>}
                      {p.title && <div style={{ fontSize: 11, color: 'var(--text-faint)', flexShrink: 0 }}>{p.title}</div>}
                      <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 20, background: sm.bg, color: sm.color, flexShrink: 0 }}>{sm.label}</span>
                      <span style={{ fontSize: 11, color: 'var(--text-faint)', flexShrink: 0, minWidth: 10 }}>{isConvArchived ? (isExpanded ? '▲' : '▼') : '→'}</span>
                    </div>
                    {isExpanded && archivedConvs.length > 0 && (
                      <div style={{ border: '1px solid var(--border)', borderTop: 'none', borderRadius: '0 0 8px 8px', background: 'var(--surface)', padding: '12px 14px' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                          <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '.06em' }}>Archived Conversations</span>
                          <button
                            onClick={e => { e.stopPropagation(); unarchiveConversation(p.id); setExpandedArchivedIds(prev => { const s = new Set(prev); s.delete(p.id); return s; }); }}
                            style={{ fontSize: 10, padding: '2px 8px', borderRadius: 20, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-muted)', cursor: 'pointer' }}
                          >↑ Move to Active</button>
                        </div>
                        {archivedConvs.map((mtg, ci) => {
                          const mTasks   = (mtg.action_items || []).filter(ai => !ai.type || ai.type === 'task');
                          const mMoments = (mtg.action_items || []).filter(ai => ai.type === 'moment' && !/^pete/i.test(ai.person || ''));
                          return (
                            <div key={mtg.id} style={{ marginBottom: ci < archivedConvs.length - 1 ? 14 : 0, paddingBottom: ci < archivedConvs.length - 1 ? 14 : 0, borderBottom: ci < archivedConvs.length - 1 ? '1px solid var(--border)' : 'none' }}>
                              <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 6 }}>
                                {mtg.meeting_date ? new Date(mtg.meeting_date + 'T12:00:00').toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) : 'Undated'}
                              </div>
                              {mTasks.length > 0 && (
                                <div style={{ marginBottom: mMoments.length > 0 ? 8 : 0 }}>
                                  <div style={{ fontSize: 9, fontWeight: 800, color: '#6d28d9', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 4 }}>Next Steps</div>
                                  <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                                    {mTasks.map((ai, i) => (
                                      <div key={i} style={{ fontSize: 11, padding: '3px 8px', borderRadius: 6, background: '#ede9fe', display: 'flex', gap: 6, alignItems: 'baseline' }}>
                                        {ai.owner && <strong style={{ color: '#6d28d9', flexShrink: 0 }}>{ai.owner}</strong>}
                                        <span style={{ flex: 1 }}>{ai.title}</span>
                                        {ai.due_date && <span style={{ fontSize: 10, opacity: 0.6, flexShrink: 0 }}>{ai.due_date}</span>}
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              )}
                              {mMoments.length > 0 && (
                                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                                  {mMoments.map((m2, i) => (
                                    <span key={i} title={m2.followup_prompt || m2.description || ''} style={{ fontSize: 10, padding: '2px 8px', borderRadius: 20, background: '#fef3c7', color: '#92400e', border: '1px solid #fde68a' }}>
                                      {MOMENT_CATEGORY_ICON[m2.category] || '💬'} {m2.title}
                                    </span>
                                  ))}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
          </div>
        )}

        {/* ── Archived contacts (soft-deleted, restorable) ── */}
        <div style={{ marginTop: 28, paddingTop: 16, borderTop: '1px solid var(--border)' }}>
          <button
            onClick={() => { const next = !showArchived; setShowArchived(next); if (next && archivedProspects.length === 0) loadArchivedProspects(); }}
            style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: 700, color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 6, padding: 0 }}
          >
            📦 Archived contacts {archivedProspects.length > 0 ? `(${archivedProspects.length})` : ''} {showArchived ? '▲' : '▼'}
          </button>
          {showArchived && (
            loadingArchived ? (
              <div style={{ padding: '16px 0' }}><div className="spinner" /></div>
            ) : archivedProspects.length === 0 ? (
              <div style={{ fontSize: 12, color: 'var(--text-faint)', padding: '12px 0' }}>No archived contacts.</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 12 }}>
                {archivedProspects.map(p => (
                  <div key={p.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, padding: '10px 14px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8 }}>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>{p.name}</div>
                      {p.company && <div style={{ fontSize: 11, color: 'var(--text-faint)' }}>{p.company}</div>}
                    </div>
                    <button
                      onClick={() => handleRestoreProspect(p)}
                      disabled={restoringId === p.id}
                      style={{ fontSize: 11, fontWeight: 700, padding: '4px 12px', borderRadius: 20, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text-muted)', cursor: restoringId === p.id ? 'not-allowed' : 'pointer', whiteSpace: 'nowrap' }}
                    >
                      {restoringId === p.id ? 'Restoring…' : 'Restore'}
                    </button>
                  </div>
                ))}
              </div>
            )
          )}
        </div>
      {/* ── Contact Detail Overlay ── */}
      {active && (() => {
        const sm = statusMeta(active.status);
        const openTaskCount = tasks.filter(t => !t.completed).length;
        const doneTaskCount = tasks.filter(t => t.completed).length;
        return (
          <div
            style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '24px 16px', overflowY: 'auto' }}
            onClick={e => { if (e.target === e.currentTarget) { closeOverlay(); } }}
          >
            <div style={{ width: '100%', maxWidth: 920, background: 'var(--bg)', borderRadius: 14, boxShadow: '0 24px 80px rgba(0,0,0,0.35)', position: 'relative', marginBottom: 24 }}>
              <button
                onClick={() => { closeOverlay(); }}
                style={{ position: 'absolute', top: 14, right: 14, zIndex: 10, background: 'none', border: 'none', cursor: 'pointer', fontSize: 22, lineHeight: 1, color: 'var(--text-faint)', padding: '2px 6px', borderRadius: 6 }}
                title="Close"
              >×</button>
              <div style={{ padding: '20px 24px' }}>

      {/* ── Header card — full width ── */}
      <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, padding: '16px 20px', marginBottom: 14 }}>
        {editingProspect ? (
          <ProspectForm draft={prospectDraft} setDraft={u => { hasEdited.current = true; setProspectDraft(u); }} allCompanies={allCompanies} onDone={handleDoneEditing} autoSaveStatus={autoSaveStatus} />
        ) : (
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 20, flexWrap: 'wrap' }}>
            {/* Name / title / company / links */}
            <div style={{ flex: 1, minWidth: 200 }}>
              {(() => {
                const linkedCo = active.company ? allCompanies.find(c => c.name.toLowerCase() === active.company.toLowerCase()) : null;
                return (
                  <>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
                      <span style={{ fontSize: 18, fontWeight: 800, color: 'var(--text)' }}>{active.name}</span>
                      <button onClick={() => { hasEdited.current = false; setAutoSaveStatus('idle'); setEditingProspect(true); setProspectDraft({ name: active.name, company: active.company || '', title: active.title || '', email: active.email || '', linkedin: active.linkedin || '', notes: active.notes || '', status: active.status || 'warm' }); }} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 13, color: 'var(--text-faint)', padding: '2px 4px' }} title="Edit">✏️</button>
                    </div>
                    {active.title && <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 4 }}>{active.title}</div>}
                    {active.company && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                        <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>{active.company}</span>
                        {linkedCo && (
                          <button onClick={() => onNavigate && onNavigate(linkedCo.source === 'pipeline' ? 'deals' : 'clients', linkedCo.source === 'pipeline' ? linkedCo.id : null)} style={{ fontSize: 10, fontWeight: 700, padding: '1px 7px', borderRadius: 10, border: `1px solid ${linkedCo.source === 'pipeline' ? '#fbbf24' : '#c4b5fd'}`, background: linkedCo.source === 'pipeline' ? '#fffbeb' : '#f5f3ff', color: linkedCo.source === 'pipeline' ? '#92400e' : '#5b21b6', cursor: 'pointer' }}>
                            {linkedCo.source === 'pipeline' ? `⚡ ${linkedCo.name}` : `🧠 ${linkedCo.name}`} →
                          </button>
                        )}
                      </div>
                    )}
                    <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
                      {active.email && <a href={`mailto:${active.email}`} style={{ fontSize: 12, color: 'var(--accent)' }}>{active.email}</a>}
                      {active.linkedin && <a href={active.linkedin} target="_blank" rel="noreferrer" style={{ fontSize: 12, color: 'var(--accent)' }}>LinkedIn ↗</a>}
                    </div>
                    {active.notes && <div style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.5, marginTop: 8 }}>{active.notes}</div>}
                  </>
                );
              })()}
            </div>

            {/* Stats */}
            <div style={{ display: 'flex', gap: 24, alignSelf: 'center' }}>
              {[
                { val: meetings.length, label: 'Meetings', color: 'var(--accent)' },
                { val: openTaskCount, label: 'Open Tasks', color: openTaskCount > 0 ? '#f59e0b' : 'var(--text-muted)' },
                { val: doneTaskCount, label: 'Done', color: '#10b981' },
              ].map(({ val, label, color }) => (
                <div key={label} style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: 20, fontWeight: 800, color }}>{val}</div>
                  <div style={{ fontSize: 10, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '.04em' }}>{label}</div>
                </div>
              ))}
            </div>

            {/* Status */}
            <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
              {STATUS_OPTIONS.map(s => (
                <button key={s.id} onClick={async () => { await supabase.from('old_gold_prospects').update({ status: s.id }).eq('id', active.id); const updated = { ...active, status: s.id }; setActive(updated); setProspects(prev => prev.map(p => p.id === active.id ? updated : p)); }} style={{ fontSize: 11, fontWeight: active.status === s.id ? 800 : 400, padding: '4px 10px', borderRadius: 20, border: `1.5px solid ${active.status === s.id ? s.color : 'var(--border)'}`, background: active.status === s.id ? s.bg : 'none', color: active.status === s.id ? s.color : 'var(--text-muted)', cursor: 'pointer', transition: 'all .1s', whiteSpace: 'nowrap' }}>{s.label}</button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* ── Next Steps — full width ── */}
      <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, padding: 18, marginBottom: 14 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
          <div style={{ fontSize: 13, fontWeight: 800, color: 'var(--text)' }}>
            Next Steps
            {openTaskCount > 0 && <span style={{ fontSize: 11, fontWeight: 600, color: '#f59e0b', marginLeft: 8 }}>{openTaskCount} open</span>}
          </div>
          <button onClick={() => setAddingTask(v => !v)} style={{ fontSize: 11, fontWeight: 700, padding: '4px 12px', borderRadius: 6, border: addingTask ? '1px solid var(--border)' : '1px solid var(--accent)', background: addingTask ? 'none' : 'var(--accent)', color: addingTask ? 'var(--text-muted)' : '#fff', cursor: 'pointer' }}>
            {addingTask ? '✕ Cancel' : '+ Add Task'}
          </button>
        </div>

            {addingTask && (
              <div style={{ display: 'flex', gap: 8, marginBottom: 14, alignItems: 'flex-end' }}>
                <div style={{ flex: 1 }}>
                  <input
                    autoFocus
                    type="text"
                    placeholder="Task / next step…"
                    value={newTaskTitle}
                    onChange={e => setNewTaskTitle(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') handleAddTask(); if (e.key === 'Escape') setAddingTask(false); }}
                    style={{ width: '100%', fontSize: 13 }}
                  />
                </div>
                <div>
                  <input type="date" value={newTaskDue} onChange={e => setNewTaskDue(e.target.value)} style={{ fontSize: 12, padding: '5px 8px', width: 'auto' }} />
                </div>
                <button onClick={handleAddTask} disabled={!newTaskTitle.trim()} style={{ fontSize: 12, fontWeight: 700, padding: '5px 14px', borderRadius: 6, border: 'none', background: 'var(--accent)', color: '#fff', cursor: 'pointer', whiteSpace: 'nowrap' }}>Add</button>
              </div>
            )}

            {detailLoading ? (
              <div style={{ textAlign: 'center', padding: '20px 0' }}><div className="spinner" /></div>
            ) : tasks.length === 0 ? (
              <div style={{ fontSize: 12, color: 'var(--text-faint)', fontStyle: 'italic' }}>No tasks yet — import a transcript to auto-generate next steps, or add one manually.</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {/* Open tasks first */}
                {tasks.filter(t => !t.completed).map(t => (
                  <div key={t.id} style={{ display: 'flex', alignItems: 'flex-start', gap: 8, padding: '6px 8px', borderRadius: 6, background: 'var(--bg)' }}>
                    <input type="checkbox" checked={false} onChange={() => handleToggleTask(t)} style={{ marginTop: 2, accentColor: 'var(--accent)', cursor: 'pointer', flexShrink: 0 }} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, color: 'var(--text)', lineHeight: 1.4 }}>{t.title}</div>
                      {t.notes && <div style={{ fontSize: 11, color: 'var(--text-faint)', marginTop: 1 }}>{t.notes}</div>}
                    </div>
                    {t.due_date && <span style={{ fontSize: 11, color: 'var(--text-faint)', flexShrink: 0, whiteSpace: 'nowrap' }}>{fmtDate(t.due_date)}</span>}
                    {deleteConfirmId === t.id ? (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
                        <span style={{ fontSize: 11, color: '#ef4444', whiteSpace: 'nowrap' }}>Delete?</span>
                        <button onClick={() => { handleDeleteTask(t.id); setDeleteConfirmId(null); }} style={{ fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 4, border: 'none', background: '#ef4444', color: '#fff', cursor: 'pointer' }}>Yes</button>
                        <button onClick={() => setDeleteConfirmId(null)} style={{ fontSize: 11, padding: '2px 8px', borderRadius: 4, border: '1px solid var(--border)', background: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}>No</button>
                      </div>
                    ) : (
                      <button onClick={() => setDeleteConfirmId(t.id)} style={{ background: 'none', border: 'none', color: 'var(--text-faint)', cursor: 'pointer', fontSize: 13, padding: '0 2px', flexShrink: 0 }}>✕</button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

      {/* ── Company Panel ── */}
      {active.company && (() => {
        if (companyPanelLoading) return (
          <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, padding: '12px 18px', marginBottom: 14, display: 'flex', alignItems: 'center', gap: 8 }}>
            <div className="spinner" style={{ width: 14, height: 14 }} />
            <span style={{ fontSize: 12, color: 'var(--text-faint)' }}>Loading company info…</span>
          </div>
        );
        const { watchlist, deal, client } = companyPanel || {};
        const hasAny = watchlist || deal || client;
        if (!hasAny && companyPanel !== null) return (
          <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, padding: '12px 18px', marginBottom: 14, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>🏢 <strong>{active.company}</strong> — not yet in your CRM</span>
            <button onClick={() => { closeOverlay(); onNavigate && onNavigate('signals'); }} style={{ fontSize: 11, padding: '3px 10px', borderRadius: 20, border: '1px solid var(--border)', background: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}>+ Add to Watch List</button>
          </div>
        );
        if (!hasAny) return null;
        const sourceLabel = client ? 'Client' : deal ? 'Pipeline' : 'Watch List';
        const sourceBg    = client ? '#f0fdf4' : deal ? '#fffbeb' : '#f5f3ff';
        const sourceColor = client ? '#166534' : deal ? '#92400e' : '#5b21b6';
        const stageMeta   = deal ? STAGES.find(s => s.id === deal.stage) : null;
        const hasSummary  = !!watchlist?.summary;
        return (
          <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, marginBottom: 14, overflow: 'hidden' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 18px', background: 'var(--bg)', borderBottom: '1px solid var(--border)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>{watchlist?.name || deal?.company_name || client?.name || active.company}</span>
                <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 20, background: sourceBg, color: sourceColor }}>{sourceLabel}</span>
              </div>
              <button
                onClick={() => { const companyName = watchlist?.name || deal?.company_name || client?.name || active.company; closeOverlay(); if (client) onNavigate && onNavigate('clients', client.name); else if (deal) onNavigate && onNavigate('deals', deal.id); else onNavigate && onNavigate('signals', companyName); }}
                style={{ fontSize: 11, padding: '3px 10px', borderRadius: 20, border: '1px solid var(--border)', background: 'none', color: 'var(--text-muted)', cursor: 'pointer', whiteSpace: 'nowrap' }}
              >Open full card →</button>
            </div>

            {watchlist && (watchlist.icp_score || watchlist.overall_score || watchlist.employee_count_num) && (
              <div style={{ display: 'flex', borderBottom: (deal?.stage || client || hasSummary) ? '1px solid var(--border)' : 'none' }}>
                {[
                  { label: 'ICP', val: watchlist.icp_score },
                  { label: 'SIG', val: watchlist.overall_score },
                  { label: 'Employees', val: watchlist.employee_count_num ? (watchlist.employee_count_num >= 1000 ? `${Math.round(watchlist.employee_count_num / 1000)}k+` : watchlist.employee_count_num) : null },
                ].filter(r => r.val).map((r, i, arr) => (
                  <div key={r.label} style={{ flex: 1, padding: '10px 18px', textAlign: 'center', borderRight: i < arr.length - 1 ? '1px solid var(--border)' : 'none' }}>
                    <div style={{ fontSize: 10, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 2 }}>{r.label}</div>
                    <div style={{ fontSize: 18, fontWeight: 800, color: typeof r.val === 'number' ? (r.val >= 70 ? '#10b981' : r.val >= 40 ? '#f59e0b' : '#ef4444') : 'var(--text)' }}>{r.val}</div>
                  </div>
                ))}
              </div>
            )}

            {deal && stageMeta && (
              <div style={{ padding: '10px 18px', display: 'flex', alignItems: 'center', gap: 10, borderBottom: hasSummary ? '1px solid var(--border)' : 'none' }}>
                <span style={{ fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 20, background: `${stageMeta.color}22`, color: stageMeta.color }}>{stageMeta.label}</span>
                {deal.value && <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>${Number(deal.value).toLocaleString()}</span>}
              </div>
            )}

            {client?.projects?.filter(pr => !pr.archived_at).length > 0 && (
              <div style={{ padding: '10px 18px', borderBottom: hasSummary ? '1px solid var(--border)' : 'none' }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 6 }}>Active Projects</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                  {client.projects.filter(pr => !pr.archived_at).map(pr => (
                    <span key={pr.id} style={{ fontSize: 11, padding: '2px 8px', borderRadius: 20, background: 'var(--bg)', border: '1px solid var(--border)', color: 'var(--text-muted)' }}>{pr.name}</span>
                  ))}
                </div>
              </div>
            )}

            {hasSummary && (
              <div style={{ padding: '12px 18px', borderBottom: '1px solid var(--border)' }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 6 }}>Recent Intel</div>
                <div style={{ fontSize: 12, color: 'var(--text)', lineHeight: 1.6 }}>{watchlist.summary}</div>
                {watchlist.recommended_angle && (
                  <div style={{ marginTop: 8, fontSize: 11, color: '#5b21b6', background: '#f5f3ff', padding: '5px 10px', borderRadius: 6, lineHeight: 1.5 }}>
                    💡 {watchlist.recommended_angle}
                  </div>
                )}
              </div>
            )}

            {/* Thesis row */}
            <div style={{ padding: '10px 18px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              {thesisBuilding ? (
                <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>Building thesis…</span>
              ) : (
                <>
                  <button
                    onClick={handleBuildThesis}
                    style={{ fontSize: 11, fontWeight: 700, padding: '5px 14px', borderRadius: 20, border: 'none', background: 'var(--accent)', color: '#fff', cursor: 'pointer' }}
                  >{watchlist?.thesis ? 'Refresh Thesis' : 'Build Thesis'}</button>
                  {watchlist?.thesis && (
                    <button
                      onClick={() => setThesisModal({ thesis: watchlist.thesis, risks: watchlist.thesis_risks, nextStep: watchlist.thesis_next_step })}
                      style={{ fontSize: 11, padding: '4px 12px', borderRadius: 6, border: '1px solid #5b21b6', background: '#f5f3ff', color: '#5b21b6', cursor: 'pointer' }}
                    >See full thesis →</button>
                  )}
                  {thesisError && <span style={{ fontSize: 11, color: '#ef4444' }}>{thesisError}</span>}
                </>
              )}
            </div>

            {/* Move to Pipeline row */}
            <div style={{ padding: '10px 18px', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              {pipelineConfirm ? (
                <>
                  <span style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 600 }}>Stage:</span>
                  <select
                    value={pipelineConfirm.stage}
                    onChange={e => setPipelineConfirm(p => ({ ...p, stage: e.target.value }))}
                    style={{ fontSize: 11, padding: '3px 8px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--surface)', cursor: 'pointer' }}
                  >
                    {STAGES.filter(s => !['won', 'lost'].includes(s.id)).map(s => (
                      <option key={s.id} value={s.id}>{s.label}</option>
                    ))}
                  </select>
                  <button
                    onClick={handleMoveToPipeline}
                    disabled={movingToPipeline}
                    style={{ fontSize: 11, fontWeight: 700, padding: '4px 12px', borderRadius: 6, border: 'none', background: '#10b981', color: '#fff', cursor: 'pointer' }}
                  >{movingToPipeline ? 'Moving…' : 'Confirm →'}</button>
                  <button
                    onClick={() => { setPipelineConfirm(null); setPipelineError(''); }}
                    style={{ fontSize: 11, padding: '4px 10px', borderRadius: 6, border: '1px solid var(--border)', background: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}
                  >Cancel</button>
                  {pipelineError && <span style={{ fontSize: 11, color: '#ef4444' }}>{pipelineError}</span>}
                </>
              ) : (
                <button
                  onClick={() => setPipelineConfirm({ stage: 'discovery_call' })}
                  style={{ fontSize: 11, fontWeight: 700, padding: '5px 14px', borderRadius: 20, border: 'none', background: '#10b981', color: '#fff', cursor: 'pointer' }}
                >Move to Pipeline</button>
              )}
            </div>
          </div>
        );
      })()}

      {/* ── Meeting Log — full width ── */}
      <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, padding: 18, marginBottom: 14 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
          <div style={{ fontSize: 13, fontWeight: 800, color: 'var(--text)' }}>
            Meeting Log
            {meetings.length > 0 && <span style={{ fontSize: 11, fontWeight: 400, color: 'var(--text-faint)', marginLeft: 8 }}>{meetings.length} meeting{meetings.length !== 1 ? 's' : ''}</span>}
          </div>
          <button
            onClick={() => { setShowImport(v => !v); setImportError(''); }}
            style={{ fontSize: 11, fontWeight: 700, padding: '4px 12px', borderRadius: 6, border: showImport ? '1px solid var(--border)' : '1px solid var(--accent)', background: showImport ? 'none' : 'var(--accent)', color: showImport ? 'var(--text-muted)' : '#fff', cursor: 'pointer' }}
          >{showImport ? '✕ Cancel' : '+ Import Transcript'}</button>
        </div>

        {/* Import form */}
        {showImport && (
          <div style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 8, padding: 14, marginBottom: 16 }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 8, marginBottom: 8 }}>
              <div>
                <label style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '.04em', display: 'block', marginBottom: 3 }}>Meeting title</label>
                <input type="text" value={importTitle} onChange={e => setImportTitle(e.target.value)} placeholder={`Meeting with ${active.name}…`} style={{ width: '100%', fontSize: 12 }} />
              </div>
              <div>
                <label style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '.04em', display: 'block', marginBottom: 3 }}>Date</label>
                <input type="date" value={importDate} onChange={e => setImportDate(e.target.value)} style={{ fontSize: 12, padding: '5px 8px', width: 'auto' }} />
              </div>
            </div>
            <label style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '.04em', display: 'block', marginBottom: 3 }}>Granola transcript</label>
            <textarea
              rows={6}
              value={importTranscript}
              onChange={e => setImportTranscript(e.target.value)}
              placeholder="Paste your Granola transcript here…"
              style={{ width: '100%', fontSize: 12, lineHeight: 1.6, fontFamily: 'monospace', marginBottom: 10 }}
            />
            {importError && <div style={{ fontSize: 12, color: '#ef4444', marginBottom: 8 }}>{importError}</div>}
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button onClick={() => { setShowImport(false); setImportTranscript(''); setImportError(''); }} style={{ fontSize: 12, padding: '5px 14px', borderRadius: 6, border: '1px solid var(--border)', background: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}>Cancel</button>
              <button onClick={handleImport} disabled={importing || !importTranscript.trim()} style={{ fontSize: 12, fontWeight: 700, padding: '5px 16px', borderRadius: 6, border: 'none', background: 'var(--accent)', color: '#fff', cursor: 'pointer' }}>
                {importing ? '⏳ Processing…' : '✨ Import & Extract Tasks'}
              </button>
            </div>
          </div>
        )}

        {/* Meeting list */}
        {!detailLoading && meetings.length === 0 && !showImport && (
          <div style={{ fontSize: 12, color: 'var(--text-faint)', fontStyle: 'italic' }}>No meetings yet. Import a Granola transcript to get started.</div>
        )}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {meetings.map(m => (
            <MeetingCard key={m.id} meeting={m} tasks={tasks} />
          ))}
        </div>
      </div>

      {/* ── Contacts — shared with project cards & ClientsPage ── */}
      {clientRecord && (
        <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, padding: 18 }}>
          <div style={{ fontSize: 13, fontWeight: 800, color: 'var(--text)', marginBottom: 12 }}>Contacts</div>
          <ContactsPanel
            clientId={clientRecord.id}
            companyName={active.company || ''}
            contacts={clientRecord.contacts || []}
            discovered={(() => {
              const added = new Set((clientRecord.contacts || []).map(c => c.name?.trim().toLowerCase()));
              const sources = dossierContact ? [dossierContact] : [];
              return sources.filter(c => c?.name && !added.has(c.name.trim().toLowerCase()));
            })()}
            onContactsChange={updated => setClientRecord(cr => cr ? { ...cr, contacts: updated } : cr)}
          />
        </div>
      )}

      {/* ── Dossier — full width ── */}
      <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, padding: 18 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
          <div style={{ fontSize: 13, fontWeight: 800, color: 'var(--text)' }}>Dossier</div>
          <button
            onClick={handleBuildDossier}
            disabled={buildingDossier}
            style={{ fontSize: 11, fontWeight: 700, padding: '4px 12px', borderRadius: 6, border: '1px solid var(--accent)', background: buildingDossier ? 'none' : 'var(--accent)', color: buildingDossier ? 'var(--text-muted)' : '#fff', cursor: 'pointer' }}
          >{buildingDossier ? '⏳ Building…' : '✨ Build Dossier'}</button>
        </div>
        {dossierContact ? (
          <ContactDossier contact={dossierContact} />
        ) : (
          <div style={{ fontSize: 12, color: 'var(--text-faint)', fontStyle: 'italic' }}>
            No dossier yet.{active.company ? ' Click Build Dossier to run a deep search on this person.' : ' Add a company for this contact first.'}
          </div>
        )}
      </div>

      {/* ── Archived Tasks ── */}
      {tasks.filter(t => t.completed).length > 0 && (
        <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, padding: 18, marginTop: 14, opacity: 0.85 }}>
          <div style={{ fontSize: 13, fontWeight: 800, color: 'var(--text-muted)', marginBottom: 12 }}>
            Archived Tasks
            <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-faint)', marginLeft: 8 }}>{tasks.filter(t => t.completed).length} completed</span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {tasks.filter(t => t.completed).map(t => (
              <div key={t.id} style={{ display: 'flex', alignItems: 'flex-start', gap: 8, padding: '6px 8px', borderRadius: 6, background: 'var(--bg)' }}>
                <input type="checkbox" checked={true} onChange={() => handleToggleTask(t)} style={{ marginTop: 2, accentColor: '#10b981', cursor: 'pointer', flexShrink: 0 }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, color: 'var(--text-muted)', textDecoration: 'line-through', lineHeight: 1.4 }}>{t.title}</div>
                  {t.completed_at && (
                    <div style={{ fontSize: 10, color: 'var(--text-faint)', marginTop: 2 }}>
                      Completed {new Date(t.completed_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                    </div>
                  )}
                </div>
                <button
                  onClick={() => handleToggleTask(t)}
                  style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 4, border: '1px solid var(--border)', background: 'none', color: 'var(--text-muted)', cursor: 'pointer', flexShrink: 0, whiteSpace: 'nowrap' }}
                >
                  Restore
                </button>
                {deleteConfirmId === t.id ? (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
                    <span style={{ fontSize: 11, color: '#ef4444', whiteSpace: 'nowrap' }}>Delete?</span>
                    <button onClick={() => { handleDeleteTask(t.id); setDeleteConfirmId(null); }} style={{ fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 4, border: 'none', background: '#ef4444', color: '#fff', cursor: 'pointer' }}>Yes</button>
                    <button onClick={() => setDeleteConfirmId(null)} style={{ fontSize: 11, padding: '2px 8px', borderRadius: 4, border: '1px solid var(--border)', background: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}>No</button>
                  </div>
                ) : (
                  <button onClick={() => setDeleteConfirmId(t.id)} style={{ background: 'none', border: 'none', color: 'var(--text-faint)', cursor: 'pointer', fontSize: 13, padding: '0 2px', flexShrink: 0 }}>✕</button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

          {/* ── Bottom footer ── */}
          <div style={{ marginTop: 20, paddingTop: 14, borderTop: '1px solid var(--border)', display: 'flex', justifyContent: 'flex-start' }}>
            <button
              onClick={handleArchiveProspect}
              style={{ fontSize: 11, fontWeight: 600, padding: '4px 14px', borderRadius: 20, border: '1px solid #fca5a5', background: 'transparent', color: '#b91c1c', cursor: 'pointer' }}
            >Archive contact</button>
          </div>
              </div>
            </div>
          </div>
        );
      })()}

      {/* ── Thesis full-view modal ── */}
      {thesisModal && (
        <div
          onClick={() => setThesisModal(null)}
          style={{ position: 'fixed', inset: 0, zIndex: 1100, background: 'rgba(0,0,0,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14, width: '100%', maxWidth: 700, maxHeight: '85vh', display: 'flex', flexDirection: 'column', boxShadow: '0 20px 60px rgba(0,0,0,0.35)' }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 22px', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
              <div>
                <div style={{ fontSize: 14, fontWeight: 800, color: 'var(--text)' }}>{active?.company} — Investment Thesis</div>
                <div style={{ fontSize: 11, color: 'var(--text-faint)', marginTop: 2 }}>Shared across Watch List, Pipeline & Clients</div>
              </div>
              <button onClick={() => setThesisModal(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 20, color: 'var(--text-faint)', padding: '2px 6px', lineHeight: 1 }}>✕</button>
            </div>
            <div style={{ overflowY: 'auto', padding: '20px 22px', flex: 1, display: 'flex', flexDirection: 'column', gap: 20 }}>
              {thesisModal.thesis && (
                <div>
                  <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 8 }}>Thesis</div>
                  <div style={{ fontSize: 13, color: 'var(--text)', lineHeight: 1.7 }}>{thesisModal.thesis}</div>
                </div>
              )}
              {thesisModal.risks?.length > 0 && (
                <div>
                  <div style={{ fontSize: 10, fontWeight: 700, color: '#ef4444', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 8 }}>Risks</div>
                  <ul style={{ margin: 0, paddingLeft: 16, display: 'flex', flexDirection: 'column', gap: 4 }}>
                    {thesisModal.risks.map((r, i) => (
                      <li key={i} style={{ fontSize: 13, color: 'var(--text)', lineHeight: 1.7 }}>{typeof r === 'string' ? r : r.risk || r.label || r.title || JSON.stringify(r)}</li>
                    ))}
                  </ul>
                </div>
              )}
              {thesisModal.nextStep && (
                <div>
                  <div style={{ fontSize: 10, fontWeight: 700, color: '#10b981', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 8 }}>Recommended Next Step</div>
                  <div style={{ fontSize: 13, color: 'var(--text)', lineHeight: 1.7 }}>{thesisModal.nextStep}</div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Transcript modal ──────────────────────────────────────────────────────────
function TranscriptModal({ title, date, transcript, onClose }) {
  return (
    <div
      onClick={onClose}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, width: '100%', maxWidth: 780, maxHeight: '85vh', display: 'flex', flexDirection: 'column', boxShadow: '0 20px 60px rgba(0,0,0,0.3)' }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 20px', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
          <div>
            <div style={{ fontSize: 14, fontWeight: 800, color: 'var(--text)' }}>{title}</div>
            {date && <div style={{ fontSize: 11, color: 'var(--text-faint)', marginTop: 2 }}>{date}</div>}
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 18, color: 'var(--text-faint)', padding: '2px 6px', lineHeight: 1 }}>✕</button>
        </div>
        <div style={{ overflowY: 'auto', padding: '16px 20px', flex: 1 }}>
          <pre style={{ fontSize: 12, fontFamily: 'monospace', color: 'var(--text-muted)', lineHeight: 1.75, whiteSpace: 'pre-wrap', wordBreak: 'break-word', margin: 0 }}>{transcript}</pre>
        </div>
      </div>
    </div>
  );
}

// ── Meeting card (collapsible) ────────────────────────────────────────────────
function MeetingCard({ meeting: m, tasks }) {
  const [open, setOpen] = useState(false);
  const [showTranscript, setShowTranscript] = useState(false);
  const linkedTasks = tasks.filter(t => t.meeting_id === m.id);

  const allItems = m.action_items || [];
  const taskItems    = allItems.filter(ai => !ai.type || ai.type === 'task');
  const moments      = allItems.filter(ai => ai.type === 'moment' && !/^pete/i.test(ai.person || ''));
  const newContacts  = allItems.filter(ai => ai.type === 'contact');

  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
      {/* Header */}
      <div
        onClick={() => setOpen(v => !v)}
        style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', background: 'var(--bg)', cursor: 'pointer', userSelect: 'none' }}
      >
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>{m.title}</div>
          {m.meeting_date && <div style={{ fontSize: 11, color: 'var(--text-faint)', marginTop: 1 }}>{new Date(m.meeting_date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })}</div>}
        </div>
        {moments.length > 0 && (
          <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 20, background: '#fef3c7', color: '#92400e' }}>✨ {moments.length} rapport</span>
        )}
        {linkedTasks.length > 0 && (
          <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 20, background: '#fef08a', color: '#713f12' }}>{linkedTasks.length} task{linkedTasks.length !== 1 ? 's' : ''}</span>
        )}
        <span style={{ fontSize: 12, color: 'var(--text-faint)' }}>{open ? '▲' : '▼'}</span>
      </div>

      {open && (
        <div style={{ padding: '12px 14px', borderTop: '1px solid var(--border)' }}>
          {/* Summary */}
          {m.summary && (
            <div style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 5 }}>Summary</div>
              <div style={{ fontSize: 13, color: 'var(--text)', lineHeight: 1.6 }}>{m.summary}</div>
            </div>
          )}

          {/* ── Next steps / action items — always first ── */}
          {taskItems.length > 0 && (
            <div style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: '#6d28d9', textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 5 }}>Next Steps</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {taskItems.map((ai, i) => (
                  <div key={i} style={{ fontSize: 12, padding: '5px 10px', borderRadius: 6, background: '#ede9fe', display: 'flex', gap: 6, alignItems: 'baseline' }}>
                    {ai.owner && <span style={{ fontWeight: 700, color: '#6d28d9', flexShrink: 0 }}>{ai.owner}</span>}
                    <span style={{ flex: 1, color: 'var(--text)' }}>{ai.title}</span>
                    {ai.due_date && <span style={{ fontSize: 10, color: '#7c3aed', flexShrink: 0 }}>{ai.due_date}</span>}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ── Conversation notes (rapport moments, non-Pete) ── */}
          {moments.length > 0 && (
            <div style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: '#92400e', textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 7 }}>Conversation Notes</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {moments.map((m2, i) => (
                  <span
                    key={i}
                    title={`${m2.description || ''}${m2.followup_prompt ? `\n💬 ${m2.followup_prompt}` : ''}`}
                    style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11, fontWeight: 600, padding: '4px 10px', borderRadius: 20, background: '#fef3c7', border: '1px solid #fde68a', color: '#92400e', cursor: 'default' }}
                  >
                    {MOMENT_CATEGORY_ICON[m2.category] || '💬'} {m2.title}
                  </span>
                ))}
              </div>
              <div style={{ fontSize: 10, color: 'var(--text-faint)', marginTop: 5 }}>Hover for context & follow-up prompt</div>
            </div>
          )}

          {/* ── Suggested new contacts ── */}
          {newContacts.length > 0 && (
            <div style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: '#065f46', textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 7 }}>Suggested New Contacts</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {newContacts.map((c, i) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', borderRadius: 7, background: '#f0fdf4', border: '1px solid #bbf7d0' }}>
                    <div style={{ flex: 1 }}>
                      <span style={{ fontSize: 12, fontWeight: 700, color: '#065f46' }}>{c.name}</span>
                      {c.role && <span style={{ fontSize: 11, color: '#047857', marginLeft: 6 }}>{c.role}</span>}
                      {c.reason && <div style={{ fontSize: 11, color: '#6b7280', marginTop: 2 }}>{c.reason}</div>}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Transcript link */}
          {m.transcript && (
            <div>
              <button
                onClick={() => setShowTranscript(true)}
                style={{ fontSize: 11, fontWeight: 700, color: 'var(--accent)', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
              >↓ View full transcript</button>
              {showTranscript && (
                <TranscriptModal
                  title={m.title}
                  date={m.meeting_date ? new Date(m.meeting_date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }) : null}
                  transcript={m.transcript}
                  onClose={() => setShowTranscript(false)}
                />
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
