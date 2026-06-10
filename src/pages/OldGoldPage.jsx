import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '../lib/supabase';

// ── Tiny AI helper: extract summary + action items + contact info ─────────────
async function processTranscriptWithAI(transcript) {
  const apiKey = import.meta.env.VITE_ANTHROPIC_API_KEY;
  if (!apiKey) return { summary: '', action_items: [], contact_name: '', company_name: '', contact_email: '' };

  const prompt = `You are analyzing a meeting transcript involving Peter (a consultant at Part Human).

Extract the following and respond ONLY with valid JSON:
1. The name of the OTHER person Peter met with (not Pete/Peter)
2. Their company name
3. Their email address IF explicitly mentioned in the transcript (null if not stated)
4. A concise 2–3 sentence summary of the conversation
5. All follow-up action items / next steps — include who owns each one and a suggested due date (YYYY-MM-DD, within 14 days if not specified)

{
  "contact_name": "First Last",
  "company_name": "Company Name",
  "contact_email": null,
  "summary": "...",
  "action_items": [
    { "title": "...", "owner": "Pete", "due_date": "YYYY-MM-DD" }
  ]
}

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
        max_tokens: 1200,
        messages: [{ role: 'user', content: prompt }],
      }),
    });
    const data = await res.json();
    const text = data.content?.[0]?.text || '';
    const match = text.match(/\{[\s\S]*\}/);
    if (match) return JSON.parse(match[0]);
  } catch {}
  return { summary: '', action_items: [], contact_name: '', company_name: '', contact_email: '' };
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

export default function OldGoldPage({ isActive = false, onNavigate }) {
  // ── State ─────────────────────────────────────────────────────────────────
  const [prospects,   setProspects]   = useState([]);
  const [meetings,    setMeetings]    = useState([]);   // for active prospect
  const [tasks,       setTasks]       = useState([]);   // for active prospect
  const [active,      setActive]      = useState(null); // prospect object
  const [loading,     setLoading]     = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [allCompanies, setAllCompanies] = useState([]); // { name, source:'pipeline'|'intel', deal_id? }

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

  // Quick-drop analysis (no contact required)
  const [dropDragging,   setDropDragging]   = useState(false);
  const [quickText,      setQuickText]      = useState('');
  const [quickAnalyzing, setQuickAnalyzing] = useState(false);
  const [quickResult,    setQuickResult]    = useState(null);  // { summary, action_items }
  const [quickError,     setQuickError]     = useState('');
  const [quickSaveContact, setQuickSaveContact] = useState('');  // prospect id or '__new__'
  const [quickSaving,    setQuickSaving]    = useState(false);
  const [showQuickPanel, setShowQuickPanel] = useState(false);
  const [quickExtracted, setQuickExtracted] = useState(null);   // { contact_name, company_name, contact_email }
  const [quickCrossRefs, setQuickCrossRefs] = useState(null);   // { pipeline: [], intel: [] }
  const [quickEmailHint, setQuickEmailHint] = useState('');     // pre-filled email from cross-ref

  // Refs so async drop handler always sees current state (avoids stale closures)
  const showImportRef    = useRef(showImport);
  const showQuickPanelRef = useRef(showQuickPanel);
  useEffect(() => { showImportRef.current    = showImport;    }, [showImport]);
  useEffect(() => { showQuickPanelRef.current = showQuickPanel; }, [showQuickPanel]);

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

  // ── Quick-drop analysis ────────────────────────────────────────────────────
  const handleQuickAnalyze = async (text) => {
    if (!text.trim()) return;
    setQuickAnalyzing(true);
    setQuickError('');
    setQuickResult(null);
    setQuickExtracted(null);
    setQuickCrossRefs(null);
    setQuickEmailHint('');
    try {
      const result = await processTranscriptWithAI(text);
      setQuickResult(result);

      // Extract contact identity
      const extracted = {
        contact_name:  result.contact_name  || '',
        company_name:  result.company_name  || '',
        contact_email: result.contact_email || '',
      };
      setQuickExtracted(extracted);

      // Auto-match against existing Old Gold prospects (in-memory)
      if (extracted.contact_name || extracted.company_name) {
        const nameLower    = extracted.contact_name.toLowerCase();
        const companyLower = extracted.company_name.toLowerCase();
        const match = prospects.find(p =>
          (nameLower    && p.name?.toLowerCase().includes(nameLower)) ||
          (companyLower && p.company?.toLowerCase().includes(companyLower))
        );
        if (match) setQuickSaveContact(match.id);
      }

      // Cross-reference against Pipeline + Intel
      const refs = await crossReferenceContact(extracted.contact_name, extracted.company_name);
      setQuickCrossRefs(refs);

      // Pick best email hint: transcript > pipeline deal > intel contact_angles
      let emailHint = extracted.contact_email || '';
      if (!emailHint && refs.pipeline?.length) {
        const deal = refs.pipeline.find(d => d.contact_email);
        if (deal) emailHint = deal.contact_email;
      }
      if (!emailHint && refs.intel?.length) {
        for (const co of refs.intel) {
          const angle = (co.contact_angles || []).find(c => c.email);
          if (angle) { emailHint = angle.email; break; }
        }
      }
      if (emailHint) setQuickEmailHint(emailHint);

    } catch (e) {
      setQuickError(e.message || 'Analysis failed');
    } finally {
      setQuickAnalyzing(false);
    }
  };

  const handleQuickSave = async () => {
    if (!quickResult || !quickSaveContact) return;
    setQuickSaving(true);
    try {
      let prospectId = quickSaveContact;
      let prospect = prospects.find(p => p.id === prospectId);

      if (quickSaveContact === '__new__') {
        const newProspect = {
          name:    quickExtracted?.contact_name || 'New Contact',
          company: quickExtracted?.company_name || '',
          email:   quickEmailHint || quickExtracted?.contact_email || '',
          status:  'warm',
        };
        const { data, error } = await supabase.from('old_gold_prospects').insert(newProspect).select().single();
        if (error) throw new Error(error.message);
        prospectId = data.id;
        prospect = data;
        setProspects(prev => [data, ...prev]);
      } else if (quickEmailHint && prospect && !prospect.email) {
        // Back-fill email onto existing prospect if they didn't have one
        await supabase.from('old_gold_prospects').update({ email: quickEmailHint }).eq('id', prospectId);
        prospect = { ...prospect, email: quickEmailHint };
        setProspects(prev => prev.map(p => p.id === prospectId ? prospect : p));
      }

      const { data: mtg, error: mtgError } = await supabase.from('old_gold_meetings').insert({
        prospect_id:  prospectId,
        title:        `Meeting — ${fmtDate(new Date().toISOString().slice(0, 10))}`,
        meeting_date: new Date().toISOString().slice(0, 10),
        transcript:   quickText,
        summary:      quickResult.summary,
        action_items: quickResult.action_items || [],
      }).select().single();
      if (mtgError) throw new Error(mtgError.message);

      if (quickResult.action_items?.length && mtg) {
        await supabase.from('old_gold_tasks').insert(
          quickResult.action_items.map(ai => ({
            prospect_id: prospectId,
            meeting_id:  mtg.id,
            title:       ai.title,
            due_date:    ai.due_date || null,
            notes:       ai.owner ? `Owner: ${ai.owner}` : '',
          }))
        );
      }

      // Jump to that contact and clear all quick-panel state
      openProspect(prospect || { id: prospectId, name: 'New Contact', status: 'warm' });
      setQuickText('');
      setQuickResult(null);
      setShowQuickPanel(false);
      setQuickExtracted(null);
      setQuickCrossRefs(null);
      setQuickEmailHint('');
      setQuickSaveContact('');
    } catch (e) {
      setQuickError(e.message || 'Save failed');
    } finally {
      setQuickSaving(false);
    }
  };

  // ── Data fetching ─────────────────────────────────────────────────────────
  const loadProspects = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase
      .from('old_gold_prospects')
      .select('*')
      .order('created_at', { ascending: false });
    setProspects(data || []);
    setLoading(false);
  }, []);

  const loadDetail = useCallback(async (prospect) => {
    setDetailLoading(true);
    const [{ data: mtgs }, { data: tsks }] = await Promise.all([
      supabase.from('old_gold_meetings').select('*').eq('prospect_id', prospect.id).order('meeting_date', { ascending: false }),
      supabase.from('old_gold_tasks').select('*').eq('prospect_id', prospect.id).order('created_at', { ascending: true }),
    ]);
    setMeetings(mtgs || []);
    setTasks(tsks || []);
    setDetailLoading(false);
  }, []);

  useEffect(() => { loadProspects(); }, [loadProspects]);

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
    loadDetail(p);
  };

  // ── Prospect CRUD ─────────────────────────────────────────────────────────
  const handleSaveProspect = async () => {
    if (!prospectDraft.name.trim()) return;
    setSaving(true);
    if (editingProspect && active) {
      const { data } = await supabase.from('old_gold_prospects').update({ ...prospectDraft, updated_at: new Date().toISOString() }).eq('id', active.id).select().single();
      if (data) {
        setActive(data);
        setProspects(prev => prev.map(p => p.id === data.id ? data : p));
      }
      setEditingProspect(false);
    } else {
      const { data } = await supabase.from('old_gold_prospects').insert(prospectDraft).select().single();
      if (data) {
        setProspects(prev => [data, ...prev]);
        openProspect(data);
      }
      setAddingProspect(false);
    }
    setSaving(false);
    setProspectDraft(BLANK_PROSPECT);
  };

  const handleDeleteProspect = async () => {
    if (!active || !window.confirm(`Delete ${active.name}? This removes all meetings and tasks for this contact.`)) return;
    await supabase.from('old_gold_prospects').delete().eq('id', active.id);
    setProspects(prev => prev.filter(p => p.id !== active.id));
    setActive(null);
  };

  // ── Transcript import + AI ────────────────────────────────────────────────
  const handleImport = async () => {
    if (!importTranscript.trim() || !active) return;
    setImporting(true);
    setImportError('');
    try {
      const { summary, action_items } = await processTranscriptWithAI(
        importTranscript,
        active.name,
        active.company,
      );

      const { data: mtg, error } = await supabase.from('old_gold_meetings').insert({
        prospect_id:  active.id,
        title:        importTitle.trim() || `Meeting — ${fmtDate(importDate)}`,
        meeting_date: importDate,
        transcript:   importTranscript,
        summary,
        action_items: action_items || [],
      }).select().single();

      if (error) throw error;

      // Save AI action items as tasks
      if (action_items?.length) {
        const taskRows = action_items.map(ai => ({
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
    await supabase.from('old_gold_tasks').update({ completed, completed_at: completed ? new Date().toISOString() : null }).eq('id', task.id);
    setTasks(prev => prev.map(t => t.id === task.id ? { ...t, completed, completed_at: completed ? new Date().toISOString() : null } : t));
  };

  const handleDeleteTask = async (id) => {
    await supabase.from('old_gold_tasks').delete().eq('id', id);
    setTasks(prev => prev.filter(t => t.id !== id));
  };

  // ── Prospect form ─────────────────────────────────────────────────────────
  const ProspectForm = ({ onCancel }) => (
    <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, padding: 20, marginBottom: 20 }}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
        {[['name','Name *','text'],['title','Title','text'],['email','Email','email'],['linkedin','LinkedIn URL','url']].map(([field, label, type]) => (
          <div key={field} style={field === 'name' ? { gridColumn: '1/-1' } : {}}>
            <label style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '.04em', display: 'block', marginBottom: 3 }}>{label}</label>
            <input type={type} value={prospectDraft[field] || ''} onChange={e => setProspectDraft(d => ({ ...d, [field]: e.target.value }))} style={{ width: '100%', fontSize: 13 }} />
          </div>
        ))}
        <div style={{ gridColumn: '1/-1' }}>
          <label style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '.04em', display: 'block', marginBottom: 3 }}>Company</label>
          <input
            list="og-company-datalist"
            value={prospectDraft.company || ''}
            onChange={e => setProspectDraft(d => ({ ...d, company: e.target.value }))}
            placeholder="Type to search existing companies…"
            style={{ width: '100%', fontSize: 13 }}
          />
          <datalist id="og-company-datalist">
            {allCompanies.map(c => <option key={c.name} value={c.name} label={c.source === 'pipeline' ? '⚡ Pipeline' : '🧠 Company Intel'} />)}
          </datalist>
        </div>
        <div>
          <label style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '.04em', display: 'block', marginBottom: 3 }}>Status</label>
          <select value={prospectDraft.status} onChange={e => setProspectDraft(d => ({ ...d, status: e.target.value }))} style={{ width: '100%', fontSize: 13 }}>
            {STATUS_OPTIONS.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
          </select>
        </div>
        <div style={{ gridColumn: '1/-1' }}>
          <label style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '.04em', display: 'block', marginBottom: 3 }}>Notes</label>
          <textarea rows={2} value={prospectDraft.notes || ''} onChange={e => setProspectDraft(d => ({ ...d, notes: e.target.value }))} style={{ width: '100%', fontSize: 12, lineHeight: 1.5 }} />
        </div>
      </div>
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <button onClick={onCancel} style={{ fontSize: 12, padding: '5px 14px', borderRadius: 6, border: '1px solid var(--border)', background: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}>Cancel</button>
        <button onClick={handleSaveProspect} disabled={saving || !prospectDraft.name.trim()} style={{ fontSize: 12, fontWeight: 700, padding: '5px 16px', borderRadius: 6, border: 'none', background: 'var(--accent)', color: '#fff', cursor: 'pointer' }}>{saving ? 'Saving…' : 'Save'}</button>
      </div>
    </div>
  );

  // ── List view ─────────────────────────────────────────────────────────────
  if (!active) {
    const openTasks = {}; // prospect_id → open task count (loaded separately if needed)
    return (
      <div className="page-body">
        {/* Header */}
        <div className="page-header" style={{ marginBottom: 24 }}>
          <div className="page-header-left">
            <h2 style={{ fontSize: 22, fontWeight: 800, color: 'var(--text)' }}>Old Gold</h2>
            <p style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 2 }}>Pete's warm outreach — discovery conversations & next steps</p>
          </div>
          <div className="page-header-actions">
            <button
              onClick={() => { setProspectDraft(BLANK_PROSPECT); setAddingProspect(true); }}
              className="btn btn-primary"
            >+ Add Contact</button>
          </div>
        </div>

        {addingProspect && <ProspectForm onCancel={() => setAddingProspect(false)} />}

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
                  {dropDragging ? 'Drop to analyze' : 'Quick transcript analysis'}
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-faint)', marginTop: 1 }}>
                  Drop a Granola file here or click to paste — no contact needed
                </div>
              </div>
            </div>
          ) : (
            /* Expanded panel */
            <div style={{ border: '1px solid var(--accent)', borderRadius: 10, background: 'var(--surface)', overflow: 'hidden' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', background: '#fffbeb', borderBottom: '1px solid #fde68a' }}>
                <div style={{ fontSize: 13, fontWeight: 800, color: '#92400e' }}>🪩 Quick transcript analysis</div>
                <button onClick={() => { setShowQuickPanel(false); setQuickText(''); setQuickResult(null); setQuickError(''); setQuickExtracted(null); setQuickCrossRefs(null); setQuickEmailHint(''); setQuickSaveContact(''); }} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 16, color: '#92400e', padding: '0 2px' }}>✕</button>
              </div>

              <div style={{ padding: 16 }}>
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
                      <button onClick={() => { setShowQuickPanel(false); setQuickText(''); setQuickError(''); setQuickExtracted(null); setQuickCrossRefs(null); setQuickEmailHint(''); setQuickSaveContact(''); }} style={{ fontSize: 12, padding: '5px 14px', borderRadius: 6, border: '1px solid var(--border)', background: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}>Cancel</button>
                      <button
                        onClick={() => handleQuickAnalyze(quickText)}
                        disabled={quickAnalyzing || !quickText.trim()}
                        style={{ fontSize: 12, fontWeight: 700, padding: '5px 18px', borderRadius: 6, border: 'none', background: 'var(--accent)', color: '#fff', cursor: 'pointer' }}
                      >{quickAnalyzing ? '⏳ Analyzing…' : '✨ Analyze'}</button>
                    </div>
                  </>
                ) : (
                  /* Results */
                  <>
                    {/* Detected contact header */}
                    {quickExtracted && (quickExtracted.contact_name || quickExtracted.company_name) && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14, padding: '8px 12px', background: '#f0fdf4', border: '1px solid #86efac', borderRadius: 8 }}>
                        <span style={{ fontSize: 15 }}>👤</span>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <span style={{ fontSize: 13, fontWeight: 700, color: '#15803d' }}>
                            {quickExtracted.contact_name || 'Unknown contact'}
                          </span>
                          {quickExtracted.company_name && (
                            <span style={{ fontSize: 12, color: '#166534', marginLeft: 6 }}>· {quickExtracted.company_name}</span>
                          )}
                          {quickEmailHint && (
                            <span style={{ fontSize: 11, color: '#15803d', marginLeft: 8, opacity: 0.8 }}>{quickEmailHint}</span>
                          )}
                        </div>
                      </div>
                    )}

                    {/* Cross-reference matches */}
                    {quickCrossRefs && (quickCrossRefs.pipeline?.length > 0 || quickCrossRefs.intel?.length > 0) && (
                      <div style={{ marginBottom: 14, display: 'flex', flexDirection: 'column', gap: 6 }}>
                        {quickCrossRefs.pipeline?.map(deal => {
                          // Find a specific matching contact angle from intel for this deal
                          const intelCo = quickCrossRefs.intel?.find(c => c.name?.toLowerCase().includes((quickExtracted?.company_name || '').toLowerCase()));
                          const intelContact = (intelCo?.contact_angles || []).find(c =>
                            c.name?.toLowerCase().includes((quickExtracted?.contact_name || '').toLowerCase())
                          );
                          const email = deal.contact_email || intelContact?.email || '';
                          const linkedin = intelContact?.linkedin || '';
                          return (
                            <div key={deal.id} style={{ padding: '9px 12px', background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 8, display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                              <span style={{ fontSize: 14, flexShrink: 0, marginTop: 1 }}>⚡</span>
                              <div style={{ flex: 1, minWidth: 0 }}>
                                <div style={{ fontSize: 12, fontWeight: 700, color: '#92400e' }}>
                                  Found in Pipeline: {deal.company_name}
                                  {deal.stage && <span style={{ fontWeight: 400, color: '#b45309', marginLeft: 6 }}>({deal.stage})</span>}
                                </div>
                                <div style={{ fontSize: 11, color: '#78350f', marginTop: 2, display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                                  {deal.contact_name && <span>Contact: <strong>{deal.contact_name}</strong></span>}
                                  {email && <span>✉ {email}</span>}
                                  {linkedin && <span>🔗 <a href={linkedin} target="_blank" rel="noreferrer" style={{ color: '#78350f' }}>LinkedIn</a></span>}
                                </div>
                              </div>
                              {email && !quickEmailHint && (
                                <button
                                  onClick={() => setQuickEmailHint(email)}
                                  style={{ fontSize: 10, padding: '3px 8px', borderRadius: 5, border: '1px solid #fbbf24', background: '#fef3c7', color: '#92400e', cursor: 'pointer', flexShrink: 0 }}
                                >Use email</button>
                              )}
                            </div>
                          );
                        })}
                        {/* Intel-only matches (company not in pipeline) */}
                        {quickCrossRefs.intel?.filter(co =>
                          !quickCrossRefs.pipeline?.some(d => d.company_name?.toLowerCase().includes(co.name?.toLowerCase()))
                        ).map(co => {
                          const angle = (co.contact_angles || []).find(c =>
                            c.name?.toLowerCase().includes((quickExtracted?.contact_name || '').toLowerCase())
                          ) || co.contact_angles?.[0];
                          if (!angle?.email && !angle?.linkedin) return null;
                          return (
                            <div key={co.id} style={{ padding: '9px 12px', background: '#f5f3ff', border: '1px solid #c4b5fd', borderRadius: 8, display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                              <span style={{ fontSize: 14, flexShrink: 0, marginTop: 1 }}>🧠</span>
                              <div style={{ flex: 1, minWidth: 0 }}>
                                <div style={{ fontSize: 12, fontWeight: 700, color: '#5b21b6' }}>Found in Company Intel: {co.name}</div>
                                <div style={{ fontSize: 11, color: '#6d28d9', marginTop: 2, display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                                  {angle.email && <span>✉ {angle.email}</span>}
                                  {angle.linkedin && <span>🔗 <a href={angle.linkedin} target="_blank" rel="noreferrer" style={{ color: '#6d28d9' }}>LinkedIn</a></span>}
                                </div>
                              </div>
                              {angle.email && !quickEmailHint && (
                                <button
                                  onClick={() => setQuickEmailHint(angle.email)}
                                  style={{ fontSize: 10, padding: '3px 8px', borderRadius: 5, border: '1px solid #c4b5fd', background: '#ede9fe', color: '#5b21b6', cursor: 'pointer', flexShrink: 0 }}
                                >Use email</button>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}

                    {quickResult.summary && (
                      <div style={{ marginBottom: 14 }}>
                        <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 5 }}>Summary</div>
                        <div style={{ fontSize: 13, color: 'var(--text)', lineHeight: 1.6 }}>{quickResult.summary}</div>
                      </div>
                    )}
                    {quickResult.action_items?.length > 0 && (
                      <div style={{ marginBottom: 16 }}>
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

                    {/* Save to contact row */}
                    <div style={{ paddingTop: 14, borderTop: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                      <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', flexShrink: 0 }}>Save to:</div>
                      <select
                        value={quickSaveContact}
                        onChange={e => setQuickSaveContact(e.target.value)}
                        style={{ fontSize: 12, padding: '4px 8px', borderRadius: 6, border: '1px solid var(--border)', flex: 1, minWidth: 160 }}
                      >
                        <option value="">— pick a contact —</option>
                        {prospects.map(p => <option key={p.id} value={p.id}>{p.name}{p.company ? ` · ${p.company}` : ''}</option>)}
                        <option value="__new__">+ Create new contact</option>
                      </select>
                      <button
                        onClick={handleQuickSave}
                        disabled={quickSaving || !quickSaveContact}
                        style={{ fontSize: 12, fontWeight: 700, padding: '5px 16px', borderRadius: 6, border: 'none', background: 'var(--accent)', color: '#fff', cursor: 'pointer', whiteSpace: 'nowrap' }}
                      >{quickSaving ? 'Saving…' : 'Save & open contact'}</button>
                      <button
                        onClick={() => { setQuickResult(null); setQuickText(''); setShowQuickPanel(false); setQuickExtracted(null); setQuickCrossRefs(null); setQuickEmailHint(''); }}
                        style={{ fontSize: 12, padding: '5px 12px', borderRadius: 6, border: '1px solid var(--border)', background: 'none', cursor: 'pointer', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}
                      >Discard</button>
                    </div>
                    {quickError && <div style={{ fontSize: 12, color: '#ef4444', marginTop: 8 }}>{quickError}</div>}
                  </>
                )}
              </div>
            </div>
          )}
        </div>

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
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 14 }}>
            {prospects.map(p => {
              const sm = statusMeta(p.status);
              const linkedCo = p.company ? allCompanies.find(c => c.name.toLowerCase() === p.company.toLowerCase()) : null;
              return (
                <div
                  key={p.id}
                  onClick={() => openProspect(p)}
                  style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, padding: '16px 18px', cursor: 'pointer', transition: 'box-shadow .15s, border-color .15s', position: 'relative' }}
                  onMouseEnter={e => { e.currentTarget.style.boxShadow = '0 4px 16px rgba(0,0,0,0.1)'; e.currentTarget.style.borderColor = 'var(--accent)'; }}
                  onMouseLeave={e => { e.currentTarget.style.boxShadow = ''; e.currentTarget.style.borderColor = 'var(--border)'; }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 6 }}>
                    <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--text)', lineHeight: 1.3 }}>{p.name}</div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0, marginLeft: 8 }}>
                      <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 20, background: sm.bg, color: sm.color }}>{sm.label}</span>
                      <button
                        onClick={async e => {
                          e.stopPropagation();
                          if (!window.confirm(`Delete ${p.name}?`)) return;
                          await supabase.from('old_gold_prospects').delete().eq('id', p.id);
                          setProspects(prev => prev.filter(x => x.id !== p.id));
                        }}
                        style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 13, color: 'var(--text-faint)', padding: '0 2px', lineHeight: 1 }}
                        title="Delete contact"
                      >✕</button>
                    </div>
                  </div>
                  {p.company && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
                      <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{p.company}</span>
                      {linkedCo && (
                        <button
                          onClick={e => { e.stopPropagation(); onNavigate && onNavigate(linkedCo.source === 'pipeline' ? 'pipeline' : 'clients'); }}
                          style={{ fontSize: 10, fontWeight: 700, padding: '1px 6px', borderRadius: 10, border: `1px solid ${linkedCo.source === 'pipeline' ? '#fbbf24' : '#c4b5fd'}`, background: linkedCo.source === 'pipeline' ? '#fffbeb' : '#f5f3ff', color: linkedCo.source === 'pipeline' ? '#92400e' : '#5b21b6', cursor: 'pointer' }}
                          title={`View in ${linkedCo.source === 'pipeline' ? 'Pipeline' : 'Company Intel'}`}
                        >{linkedCo.source === 'pipeline' ? '⚡ Pipeline' : '🧠 Intel'} →</button>
                      )}
                    </div>
                  )}
                  {p.title && <div style={{ fontSize: 11, color: 'var(--text-faint)' }}>{p.title}</div>}
                  {p.notes && <div style={{ fontSize: 11, color: 'var(--text-faint)', marginTop: 8, lineHeight: 1.5, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>{p.notes}</div>}
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  }

  // ── Detail view ───────────────────────────────────────────────────────────
  const sm = statusMeta(active.status);
  const openTaskCount  = tasks.filter(t => !t.completed).length;
  const doneTaskCount  = tasks.filter(t => t.completed).length;

  return (
    <div className="page-body">
      {/* Back + header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
        <button onClick={() => { setActive(null); setMeetings([]); setTasks([]); }} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 13, color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 4, padding: '4px 0' }}>
          ← Old Gold
        </button>
        <span style={{ color: 'var(--border)' }}>|</span>
        <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>{active.name}</span>
        {active.company && <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>· {active.company}</span>}
        <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 20, background: sm.bg, color: sm.color }}>{sm.label}</span>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '300px 1fr', gap: 20, alignItems: 'start' }}>

        {/* ── Left: Contact info ── */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, padding: 16 }}>
            {editingProspect ? (
              <ProspectForm onCancel={() => { setEditingProspect(false); setProspectDraft(BLANK_PROSPECT); }} />
            ) : (
              <>
                {(() => {
                  const linkedCo = active.company ? allCompanies.find(c => c.name.toLowerCase() === active.company.toLowerCase()) : null;
                  return (
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
                      <div>
                        <div style={{ fontSize: 16, fontWeight: 800, color: 'var(--text)' }}>{active.name}</div>
                        {active.title && <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>{active.title}</div>}
                        {active.company && (
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 2 }}>
                            <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{active.company}</span>
                            {linkedCo && (
                              <button
                                onClick={() => onNavigate && onNavigate(linkedCo.source === 'pipeline' ? 'pipeline' : 'clients')}
                                style={{ fontSize: 10, fontWeight: 700, padding: '1px 7px', borderRadius: 10, border: `1px solid ${linkedCo.source === 'pipeline' ? '#fbbf24' : '#c4b5fd'}`, background: linkedCo.source === 'pipeline' ? '#fffbeb' : '#f5f3ff', color: linkedCo.source === 'pipeline' ? '#92400e' : '#5b21b6', cursor: 'pointer' }}
                                title={`View in ${linkedCo.source === 'pipeline' ? 'Pipeline' : 'Company Intel'}`}
                              >{linkedCo.source === 'pipeline' ? '⚡ Pipeline' : '🧠 Intel'} →</button>
                            )}
                          </div>
                        )}
                      </div>
                      <button onClick={() => { setEditingProspect(true); setProspectDraft({ name: active.name, company: active.company || '', title: active.title || '', email: active.email || '', linkedin: active.linkedin || '', notes: active.notes || '', status: active.status || 'warm' }); }} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 13, color: 'var(--text-faint)', padding: '2px 4px' }} title="Edit">✏️</button>
                    </div>
                  );
                })()}
                {active.email && <a href={`mailto:${active.email}`} style={{ fontSize: 12, color: 'var(--accent)', display: 'block', marginBottom: 4 }}>{active.email}</a>}
                {active.linkedin && <a href={active.linkedin} target="_blank" rel="noreferrer" style={{ fontSize: 12, color: 'var(--accent)', display: 'block', marginBottom: 4 }}>LinkedIn ↗</a>}
                {active.notes && <div style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.55, marginTop: 8, paddingTop: 8, borderTop: '1px solid var(--border)' }}>{active.notes}</div>}
                <div style={{ marginTop: 12, paddingTop: 10, borderTop: '1px solid var(--border)', display: 'flex', gap: 8 }}>
                  <div style={{ flex: 1, textAlign: 'center' }}>
                    <div style={{ fontSize: 18, fontWeight: 800, color: 'var(--accent)' }}>{meetings.length}</div>
                    <div style={{ fontSize: 10, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '.04em' }}>Meetings</div>
                  </div>
                  <div style={{ flex: 1, textAlign: 'center' }}>
                    <div style={{ fontSize: 18, fontWeight: 800, color: openTaskCount > 0 ? '#f59e0b' : 'var(--text-muted)' }}>{openTaskCount}</div>
                    <div style={{ fontSize: 10, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '.04em' }}>Open Tasks</div>
                  </div>
                  <div style={{ flex: 1, textAlign: 'center' }}>
                    <div style={{ fontSize: 18, fontWeight: 800, color: '#10b981' }}>{doneTaskCount}</div>
                    <div style={{ fontSize: 10, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '.04em' }}>Done</div>
                  </div>
                </div>
              </>
            )}
          </div>

          {/* Status changer */}
          {!editingProspect && (
            <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, padding: 14 }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 8 }}>Status</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {STATUS_OPTIONS.map(s => (
                  <button
                    key={s.id}
                    onClick={async () => {
                      await supabase.from('old_gold_prospects').update({ status: s.id }).eq('id', active.id);
                      const updated = { ...active, status: s.id };
                      setActive(updated);
                      setProspects(prev => prev.map(p => p.id === active.id ? updated : p));
                    }}
                    style={{ fontSize: 12, fontWeight: active.status === s.id ? 800 : 400, padding: '6px 10px', borderRadius: 6, border: `1.5px solid ${active.status === s.id ? s.color : 'var(--border)'}`, background: active.status === s.id ? s.bg : 'none', color: active.status === s.id ? s.color : 'var(--text-muted)', cursor: 'pointer', textAlign: 'left', transition: 'all .1s' }}
                  >{s.label}</button>
                ))}
              </div>
            </div>
          )}

          {/* Danger zone */}
          {!editingProspect && (
            <button onClick={handleDeleteProspect} style={{ fontSize: 11, color: '#ef4444', background: 'none', border: '1px solid #fecaca', borderRadius: 6, padding: '5px 10px', cursor: 'pointer', alignSelf: 'flex-start' }}>
              Delete contact
            </button>
          )}
        </div>

        {/* ── Right: Meetings + Tasks ── */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

          {/* Tasks / Next Steps */}
          <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, padding: 18 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
              <div style={{ fontSize: 13, fontWeight: 800, color: 'var(--text)' }}>
                Next Steps
                {openTaskCount > 0 && <span style={{ fontSize: 11, fontWeight: 600, color: '#f59e0b', marginLeft: 8 }}>{openTaskCount} open</span>}
              </div>
              <button onClick={() => setAddingTask(v => !v)} style={{ fontSize: 11, fontWeight: 700, padding: '4px 12px', borderRadius: 6, border: '1px solid var(--border)', background: addingTask ? 'var(--accent)' : 'none', color: addingTask ? '#fff' : 'var(--text-muted)', cursor: 'pointer' }}>
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
                    <button onClick={() => handleDeleteTask(t.id)} style={{ background: 'none', border: 'none', color: 'var(--text-faint)', cursor: 'pointer', fontSize: 13, padding: '0 2px', flexShrink: 0 }}>✕</button>
                  </div>
                ))}
                {/* Completed tasks */}
                {tasks.filter(t => t.completed).map(t => (
                  <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 8px', borderRadius: 6, opacity: 0.5 }}>
                    <input type="checkbox" checked={true} onChange={() => handleToggleTask(t)} style={{ accentColor: '#10b981', cursor: 'pointer', flexShrink: 0 }} />
                    <div style={{ flex: 1, fontSize: 12, color: 'var(--text-muted)', textDecoration: 'line-through' }}>{t.title}</div>
                    <button onClick={() => handleDeleteTask(t.id)} style={{ background: 'none', border: 'none', color: 'var(--text-faint)', cursor: 'pointer', fontSize: 12, padding: '0 2px', flexShrink: 0 }}>✕</button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Meetings */}
          <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, padding: 18 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
              <div style={{ fontSize: 13, fontWeight: 800, color: 'var(--text)' }}>
                Meeting Log
                {meetings.length > 0 && <span style={{ fontSize: 11, fontWeight: 400, color: 'var(--text-faint)', marginLeft: 8 }}>{meetings.length} meeting{meetings.length !== 1 ? 's' : ''}</span>}
              </div>
              <button
                onClick={() => { setShowImport(v => !v); setImportError(''); }}
                style={{ fontSize: 11, fontWeight: 700, padding: '4px 12px', borderRadius: 6, border: '1px solid var(--border)', background: showImport ? 'var(--accent)' : 'none', color: showImport ? '#fff' : 'var(--text-muted)', cursor: 'pointer' }}
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
                  rows={8}
                  value={importTranscript}
                  onChange={e => setImportTranscript(e.target.value)}
                  placeholder="Paste your Granola transcript here… AI will extract a summary and create follow-up tasks automatically."
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
        {linkedTasks.length > 0 && (
          <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 20, background: '#fef08a', color: '#713f12' }}>{linkedTasks.length} task{linkedTasks.length !== 1 ? 's' : ''}</span>
        )}
        <span style={{ fontSize: 12, color: 'var(--text-faint)' }}>{open ? '▲' : '▼'}</span>
      </div>

      {open && (
        <div style={{ padding: '12px 14px', borderTop: '1px solid var(--border)' }}>
          {m.summary && (
            <div style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 5 }}>Summary</div>
              <div style={{ fontSize: 13, color: 'var(--text)', lineHeight: 1.6 }}>{m.summary}</div>
            </div>
          )}

          {(m.action_items?.length > 0) && (
            <div style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--accent)', textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 5 }}>Action Items from this meeting</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {m.action_items.map((ai, i) => (
                  <div key={i} style={{ fontSize: 12, color: 'var(--text)', padding: '4px 8px', borderRadius: 5, background: '#ede9fe', display: 'flex', gap: 6 }}>
                    {ai.owner && <span style={{ fontWeight: 700, color: '#6d28d9', flexShrink: 0 }}>{ai.owner}</span>}
                    <span style={{ flex: 1 }}>{ai.title}</span>
                    {ai.due_date && <span style={{ fontSize: 10, color: '#7c3aed', flexShrink: 0 }}>{ai.due_date}</span>}
                  </div>
                ))}
              </div>
            </div>
          )}

          {m.transcript && (
            <div>
              <button
                onClick={() => setShowTranscript(v => !v)}
                style={{ fontSize: 11, fontWeight: 700, color: 'var(--accent)', background: 'none', border: 'none', cursor: 'pointer', padding: 0, marginBottom: showTranscript ? 8 : 0 }}
              >{showTranscript ? '↑ Hide transcript' : '↓ View full transcript'}</button>
              {showTranscript && (
                <div style={{ fontSize: 11, fontFamily: 'monospace', color: 'var(--text-muted)', lineHeight: 1.7, background: 'var(--bg)', padding: '10px 12px', borderRadius: 6, whiteSpace: 'pre-wrap', maxHeight: 360, overflowY: 'auto' }}>
                  {m.transcript}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
