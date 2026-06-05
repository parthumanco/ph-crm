import { useState, useEffect, useRef } from 'react';
import {
  upsertDeal, deleteDeal,
  fetchActivities, addActivity, deleteActivity,
  fetchTasks, addTask, completeTask, deleteTask,
  STAGES, ACTIVITY_TYPES, OWNERS, stageColor, stageLabel, fmt$, daysSince,
} from '../lib/deals';
import { fetchDealMeetings, deleteProjectMeeting } from '../lib/projects';
import { fetchCompanyIntel, runBuildThesis, findOrCreateCompany, addCompanyResearchItem, removeCompanyResearchItem, addCompanyContact, updateCompanyContact, deleteCompanyContact } from '../lib/clients';
import { loadIcp } from '../lib/settings';
import { requestAndSave, clearReminder, hasReminder } from '../lib/reminders';
import TranscriptImporter from './TranscriptImporter';
import DealProposalDraft from './DealProposalDraft';

const ACTIVITY_ICONS = { email:'✉️', call:'📞', meeting:'🤝', note:'📝', proposal:'📄', contract:'✍️' };

const THESIS_PHASES = [
  { id: 'discovery',  label: 'Discovery'  },
  { id: 'contacts',   label: 'Contacts'   },
  { id: 'triggers',   label: 'Triggers'   },
  { id: 'synthesis',  label: 'Synthesis'  },
];

export default function DealDetailModal({ deal: initialDeal, onClose, onSaved, onDraftProposal }) {
  const [deal, setDeal]           = useState({ ...initialDeal });
  const [activities, setActivities] = useState([]);
  const [tasks, setTasks]         = useState([]);
  const [saving, setSaving]       = useState(false);
  const [deleting, setDeleting]   = useState(false);
  const [actForm, setActForm]     = useState({ type: 'call', summary: '', activity_date: new Date().toISOString().slice(0,10), assigned_to: 'Mike' });
  const [taskForm, setTaskForm]   = useState({ title: '', due_date: '', assigned_to: 'Mike' });
  const [addingAct, setAddingAct] = useState(false);
  const [addingTask, setAddingTask] = useState(false);
  const [savingAct, setSavingAct] = useState(false);
  const [savingTask, setSavingTask] = useState(false);
  const [confirmDeleteActId, setConfirmDeleteActId] = useState(null); // activity id pending delete confirm
  const [tab, setTab]             = useState('nextsteps');
  const [meetings, setMeetings]   = useState([]);
  const [showTranscript, setShowTranscript] = useState(null);
  const [showTranscriptImporter, setShowTranscriptImporter] = useState(false);
  const [showProposalDraft, setShowProposalDraft] = useState(false);
  const [dragOverMtgId, setDragOverMtgId] = useState(null); // id of card being hovered during drag
  const dragMtgIdRef = useRef(null); // id of card being dragged
  const [fileDropActive, setFileDropActive] = useState(false); // file being dragged over meeting log
  const [initialTranscript, setInitialTranscript] = useState(''); // pre-filled transcript from dropped file

  // Research tab state
  const [companyIntel, setCompanyIntel]   = useState(null);
  const [intelLoading, setIntelLoading]   = useState(false);
  const [buildingThesis, setBuildingThesis] = useState(false);
  const [thesisPhases, setThesisPhases]   = useState([]);
  const [thesisLog, setThesisLog]         = useState([]);
  const [thesisError, setThesisError]     = useState(null);
  const [thesisMigrationError, setThesisMigrationError] = useState(null);
  const thesisLogEndRef                   = useRef(null);
  const intelFetchedRef                   = useRef(false); // prevents double-fetch on tab switch

  // Notes state (for quick save from Meetings tab)
  const [savingNotes, setSavingNotes]     = useState(false);

  // Research materials state
  const [addingItem, setAddingItem]       = useState(false);
  const [itemDraft, setItemDraft]         = useState({ type: 'link', title: '', url: '', body: '' });
  const [savingItem, setSavingItem]       = useState(false);

  // Contacts tab state
  const [expandedContact, setExpandedContact] = useState(null);
  const [addingContact, setAddingContact]     = useState(false);
  const [contactDraft, setContactDraft]       = useState({ name: '', title: '', email: '', linkedin: '', notes: '' });
  const [savingContact, setSavingContact]     = useState(false);
  const [editingContact, setEditingContact]   = useState(null); // contact name being edited
  const [editDraft, setEditDraft]             = useState({});
  const [savingEdit, setSavingEdit]           = useState(false);

  // Compose email state
  const [composeEmail, setComposeEmail] = useState(null); // { to, toName } | null
  const [composeDraft, setComposeDraft] = useState({ subject: '', body: '' });
  const [loggingEmail, setLoggingEmail] = useState(false);

  // AI email draft state
  const [draftingEmail, setDraftingEmail] = useState(false);
  const [emailDraftError, setEmailDraftError] = useState(null);
  const [contextualAdvice, setContextualAdvice] = useState(null); // { situation, recommendation, timing, emailType, subject, body }
  const [draftContactName, setDraftContactName] = useState('');

  const isNew = !initialDeal.id;
  const [showEditForm, setShowEditForm]   = useState(isNew); // open for new deals, collapsed for existing

  useEffect(() => {
    if (!isNew) {
      fetchActivities(initialDeal.id).then(setActivities).catch(console.error);
      fetchTasks(initialDeal.id).then(setTasks).catch(console.error);
      fetchDealMeetings(initialDeal.id).then(setMeetings).catch(console.error);
    }
  }, [initialDeal.id, isNew]);

  // Load company intel silently on mount so AI suggestions are ready on first tab
  useEffect(() => {
    if (!isNew && deal.company_name) {
      intelFetchedRef.current = true;
      fetchCompanyIntel(deal.company_name)
        .then(intel => setCompanyIntel(intel))
        .catch(() => {});
    }
  }, []);

  // Auto-scroll thesis log
  useEffect(() => {
    if (buildingThesis) thesisLogEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [thesisLog, buildingThesis]);

  const field = (key, val) => setDeal(d => ({ ...d, [key]: val }));

  const save = async () => {
    if (!deal.company_name?.trim()) return alert('Company name is required.');
    setSaving(true);
    try {
      const saved = await upsertDeal(deal);
      onSaved(saved);
      onClose();
    } catch (e) {
      alert('Error saving deal: ' + e.message);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!window.confirm(`Delete deal for ${deal.company_name}? This cannot be undone.`)) return;
    setDeleting(true);
    try {
      await deleteDeal(deal.id);
      onSaved(null);
      onClose();
    } catch (e) {
      alert('Error deleting deal: ' + e.message);
    } finally {
      setDeleting(false);
    }
  };

  const submitActivity = async () => {
    if (!actForm.summary.trim()) return;
    setSavingAct(true);
    try {
      await addActivity({ ...actForm, deal_id: deal.id, company_id: deal.company_id });
      const updated = await fetchActivities(deal.id);
      setActivities(updated);
      setActForm(f => ({ ...f, summary: '' }));
      setAddingAct(false);
    } catch (e) {
      alert('Error logging activity: ' + e.message);
    } finally {
      setSavingAct(false);
    }
  };

  const submitTask = async () => {
    if (!taskForm.title.trim()) return;
    setSavingTask(true);
    try {
      await addTask({ ...taskForm, deal_id: deal.id, company_id: deal.company_id });
      const updated = await fetchTasks(deal.id);
      setTasks(updated);
      setTaskForm(f => ({ ...f, title: '', due_date: '' }));
      setAddingTask(false);
    } catch (e) {
      alert('Error adding task: ' + e.message);
    } finally {
      setSavingTask(false);
    }
  };

  const toggleTask = async (task) => {
    await completeTask(task.id, !task.completed);
    setTasks(ts => ts.map(t => t.id === task.id ? { ...t, completed: !t.completed, completed_at: !t.completed ? new Date().toISOString() : null } : t));
  };

  const removeActivity = async (id) => {
    await deleteActivity(id);
    setActivities(as => as.filter(a => a.id !== id));
  };

  const removeTask = async (id) => {
    await deleteTask(id);
    setTasks(ts => ts.filter(t => t.id !== id));
  };

  const saveNotes = async () => {
    if (!deal.id) return;
    setSavingNotes(true);
    try {
      const saved = await upsertDeal(deal);
      onSaved(saved); // update parent state without closing modal
    } catch (e) {
      alert('Error saving notes: ' + e.message);
    } finally {
      setSavingNotes(false);
    }
  };

  const handleDeleteContact = async (c) => {
    if (!window.confirm(`Remove ${c.name}? This cannot be undone.`)) return;

    // "Deal" source = the contact is stored on deal.contact_name, not in contact_angles
    if (c.source === 'deal') {
      try {
        const updated = await upsertDeal({ ...deal, contact_name: null, contact_email: null });
        setDeal(updated);
        onSaved(updated);
        if (expandedContact === c.name) setExpandedContact(null);
      } catch (e) {
        alert('Error removing contact: ' + e.message);
      }
      return;
    }

    // All other sources: remove from company contact_angles
    if (!companyIntel?.id) return;
    try {
      const updated = await deleteCompanyContact(companyIntel.id, c.name);
      setCompanyIntel(prev => ({ ...prev, contact_angles: updated }));
      if (editingContact === c.name) { setEditingContact(null); setEditDraft({}); }
      if (expandedContact === c.name) setExpandedContact(null);
    } catch (e) {
      alert('Error deleting contact: ' + e.message);
    }
  };

  const saveContactEdit = async () => {
    if (!companyIntel?.id) return;
    setSavingEdit(true);
    try {
      const updated = await updateCompanyContact(companyIntel.id, editingContact, editDraft);
      setCompanyIntel(prev => ({ ...prev, contact_angles: updated }));
      setEditingContact(null);
    } catch (e) {
      alert('Error updating contact: ' + e.message);
    } finally {
      setSavingEdit(false);
    }
  };

  const openCompose = (email, name) => {
    setComposeEmail({ to: email, toName: name });
    setComposeDraft({ subject: '', body: '' });
  };

  // Build merged contact list (deal contact + thesis contacts), same logic as Contacts tab
  const mergedContacts = (() => {
    const map = new Map();
    if (deal.contact_name?.trim()) {
      const name = deal.contact_name.trim();
      map.set(name.toLowerCase(), { name, email: deal.contact_email?.trim() || null, title: null, source: 'deal' });
    }
    (companyIntel?.contact_angles || []).forEach(c => {
      if (!c.name?.trim()) return;
      const name = c.name.trim();
      const key = name.toLowerCase();
      const existing = map.get(key) || {};
      map.set(key, { ...existing, ...c, name, email: c.email || existing.email || null });
    });
    return Array.from(map.values());
  })();

  const handleDraftEmail = async () => {
    if (draftingEmail) return;
    setDraftingEmail(true);
    setEmailDraftError(null);
    setContextualAdvice(null);
    try {
      const { generateContextualOutreach } = await import('../lib/anthropic.js');
      const icp = await loadIcp();

      // Pick contact: selected by name, or primary, or first
      const contact = mergedContacts.find(c => c.name === draftContactName)
        || mergedContacts.find(c => c.is_primary)
        || mergedContacts[0];

      if (!contact) throw new Error('No contacts found — build a thesis first to discover contacts, or add one manually on the Contacts tab.');

      const advice = await generateContextualOutreach(
        deal,
        companyIntel,
        activities,
        tasks,
        contact,
        icp,
      );

      // Store advice for display; pre-fill compose but don't open the overlay yet
      setContextualAdvice({ ...advice, contactName: contact.name, contactEmail: contact.email || '' });
      setComposeDraft({ subject: advice.subject || '', body: advice.body || '' });
      // composeEmail intentionally NOT set here — user opens compose via the advice card button
    } catch (e) {
      setEmailDraftError(e.message);
    } finally {
      setDraftingEmail(false);
    }
  };

  const sendEmail = async () => {
    if (!composeEmail) return;
    // Open native mail client with pre-filled fields
    const params = new URLSearchParams();
    if (composeDraft.subject) params.set('subject', composeDraft.subject);
    if (composeDraft.body)    params.set('body',    composeDraft.body);
    const qs = params.toString();
    window.open(`mailto:${composeEmail.to}${qs ? '?' + qs : ''}`, '_blank');

    // Log as email activity
    if (deal.id && composeDraft.subject) {
      setLoggingEmail(true);
      try {
        const summary = `📧 ${composeDraft.subject}${composeDraft.body ? '\n\n' + composeDraft.body.slice(0, 300) : ''}`;
        await addActivity({
          deal_id:       deal.id,
          company_id:    deal.company_id,
          type:          'email',
          summary,
          activity_date: new Date().toISOString().slice(0, 10),
          assigned_to:   deal.assigned_to || 'Mike',
        });
        const updated = await fetchActivities(deal.id);
        setActivities(updated);
      } catch (e) {
        console.error('Failed to log email activity:', e.message);
      } finally {
        setLoggingEmail(false);
      }
    }
    setComposeEmail(null);
  };

  const handleMtgDrop = (targetId) => {
    const fromId = dragMtgIdRef.current;
    if (!fromId || fromId === targetId) return;
    setMeetings(prev => {
      const fromIdx  = prev.findIndex(m => m.id === fromId);
      const toIdx    = prev.findIndex(m => m.id === targetId);
      if (fromIdx === -1 || toIdx === -1) return prev;
      const next = [...prev];
      const [moved] = next.splice(fromIdx, 1);
      next.splice(toIdx, 0, moved);
      return next;
    });
    dragMtgIdRef.current = null;
    setDragOverMtgId(null);
  };

  const handleAddContact = async () => {
    if (!contactDraft.name.trim()) return;
    setSavingContact(true);
    try {
      let intel = companyIntel;
      if (!intel?.id) {
        const company = await findOrCreateCompany(deal.company_name);
        intel = company;
        setCompanyIntel(company);
        intelFetchedRef.current = true;
      }
      const updated = await addCompanyContact(intel.id, {
        name:    contactDraft.name.trim(),
        title:   contactDraft.title.trim()    || null,
        email:   contactDraft.email.trim()    || null,
        linkedin: contactDraft.linkedin.trim() || null,
        notes:   contactDraft.notes.trim()    || null,
        source:  'manual',
      });
      setCompanyIntel(prev => ({ ...prev, contact_angles: updated }));
      setContactDraft({ name: '', title: '', email: '', linkedin: '', notes: '' });
      setAddingContact(false);
    } catch (e) {
      alert('Error saving contact: ' + e.message);
    } finally {
      setSavingContact(false);
    }
  };

  const handleAddItem = async () => {
    if (!itemDraft.title.trim() && !itemDraft.url.trim() && !itemDraft.body.trim()) return;
    setSavingItem(true);
    try {
      // Ensure a company record exists first
      let intel = companyIntel;
      if (!intel?.id) {
        const company = await findOrCreateCompany(deal.company_name);
        intel = company;
        setCompanyIntel(company);
        intelFetchedRef.current = true;
      }
      const item = {
        type:  itemDraft.type,
        title: itemDraft.title.trim() || itemDraft.url.trim() || 'Untitled',
        ...(itemDraft.url.trim()  ? { url:  itemDraft.url.trim()  } : {}),
        ...(itemDraft.body.trim() ? { body: itemDraft.body.trim() } : {}),
      };
      const updated = await addCompanyResearchItem(intel.id, item);
      setCompanyIntel(prev => ({ ...prev, research_items: updated }));
      setItemDraft({ type: 'link', title: '', url: '', body: '' });
      setAddingItem(false);
    } catch (e) {
      alert('Error saving item: ' + e.message);
    } finally {
      setSavingItem(false);
    }
  };

  const handleRemoveItem = async (itemId) => {
    if (!companyIntel?.id) return;
    try {
      const updated = await removeCompanyResearchItem(companyIntel.id, itemId);
      setCompanyIntel(prev => ({ ...prev, research_items: updated }));
    } catch (e) {
      alert('Error removing item: ' + e.message);
    }
  };

  const handleBuildThesis = async () => {
    if (buildingThesis) return;
    setBuildingThesis(true);
    setThesisLog([]);
    setThesisPhases([]);
    setThesisError(null);
    setThesisMigrationError(null);

    const addLog = (msg) => setThesisLog(prev => [...prev, {
      time: new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
      msg,
    }]);

    try {
      addLog(`Starting thesis build for ${deal.company_name}…`);
      const [icp, company] = await Promise.all([
        loadIcp(),
        findOrCreateCompany(deal.company_name),
      ]);
      addLog(`Company record ready · running 4-phase deep research`);

      // Build deal context to pass as clientDetail
      const dealDetail = {
        activities,
        meetings,
        notes: deal.notes ? [{ body: deal.notes, type: 'note' }] : [],
      };

      const result = await runBuildThesis(
        company.id,
        company,
        icp,
        dealDetail,
        (phase, status, _data, message) => {
          if (message) addLog(message);
          if (phase && status === 'start') {
            setThesisPhases(prev => {
              const filtered = prev.filter(p => p.id !== phase);
              return [...filtered, { id: phase, status: 'running' }];
            });
          }
          if (phase && status === 'done') {
            setThesisPhases(prev => prev.map(p => p.id === phase ? { ...p, status: 'done' } : p));
          }
        },
        null, // no clientId — deal companies don't have a client record yet
      );

      // Set state from result immediately so thesis is visible even if DB save had issues
      const { _thesisSaveError, ...cleanResult } = result;
      setCompanyIntel(cleanResult);

      if (_thesisSaveError) {
        setThesisMigrationError(_thesisSaveError);
        addLog('⚠ Thesis built but NOT saved — see banner above for required DB migration');
      } else {
        setThesisMigrationError(null);
        addLog('✓ Thesis complete and saved');
        // Re-fetch from DB to sync in-memory state with what was persisted
        // Note: new columns (thesis_built etc) may return null from PostgREST if schema
        // cache is still warming — merge rather than replace so in-memory thesis stays visible
        try {
          const persisted = await fetchCompanyIntel(deal.company_name);
          if (persisted) setCompanyIntel(prev => ({ ...prev, ...persisted }));
        } catch { /* non-fatal — in-memory state is correct */ }
      }
    } catch (e) {
      setThesisError(e.message);
      addLog('✗ Error: ' + e.message);
    } finally {
      setBuildingThesis(false);
    }
  };

  const openTasks = tasks.filter(t => !t.completed);
  const overdueTasks = openTasks.filter(t => t.due_date && new Date(t.due_date) < new Date());

  return (
    <>
    <div
      style={{ position: 'fixed', inset: 0, zIndex: 300, display: 'flex', justifyContent: 'flex-end' }}
      onClick={e => e.target === e.currentTarget && onClose()}
    >
      {/* Backdrop */}
      <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.35)' }} onClick={onClose} />

      {/* Panel */}
      <div style={{ position: 'relative', zIndex: 1, width: 520, maxWidth: '96vw', background: 'var(--bg)', boxShadow: '-8px 0 32px rgba(0,0,0,0.15)', display: 'flex', flexDirection: 'column', height: '100%', overflowY: 'auto' }}>

        {/* Header */}
        <div style={{ padding: '20px 24px 16px', borderBottom: showEditForm ? 'none' : '1px solid var(--border)' }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
            <div style={{ flex: 1 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                <span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: '50%', background: stageColor(deal.stage), flexShrink: 0 }} />
                <span style={{ fontSize: 11, fontWeight: 700, color: stageColor(deal.stage), textTransform: 'uppercase', letterSpacing: '.04em' }}>{stageLabel(deal.stage)}</span>
                {!isNew && <span style={{ fontSize: 11, color: 'var(--text-faint)', marginLeft: 4 }}>{daysSince(deal.stage_entered_at)}d in stage</span>}
              </div>
              <h3 style={{ fontSize: 18, fontWeight: 800, margin: '0 0 3px' }}>{deal.company_name || 'New Deal'}</h3>
              {deal.contact_name && (
                <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: 0 }}>
                  {deal.contact_name}{deal.contact_email ? ` · ${deal.contact_email}` : ''}
                </p>
              )}
            </div>
            <button style={{ background: 'none', border: 'none', fontSize: 20, cursor: 'pointer', color: 'var(--text-muted)', padding: '0 4px', lineHeight: 1, flexShrink: 0 }} onClick={onClose}>✕</button>
          </div>

          {/* Deal meta badges + edit toggle */}
          {!isNew && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 10, flexWrap: 'wrap' }}>
              {deal.assigned_to && (
                <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 10, background: deal.assigned_to === 'Mike' ? '#f3e8ff' : '#eff6ff', color: deal.assigned_to === 'Mike' ? '#7c3aed' : '#1d4ed8' }}>
                  {deal.assigned_to}
                </span>
              )}
              {(parseFloat(deal.retainer_value) > 0) && (
                <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 10, background: '#ccfbf1', color: '#0f766e' }}>
                  {fmt$(parseFloat(deal.retainer_value))}/mo
                </span>
              )}
              {(parseFloat(deal.project_value) > 0) && (
                <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 10, background: '#fff7ed', color: '#c2410c' }}>
                  {fmt$(parseFloat(deal.project_value))}
                </span>
              )}
              {deal.close_date_estimate && (
                <span style={{ fontSize: 11, color: 'var(--text-faint)', padding: '2px 6px' }}>
                  Close {deal.close_date_estimate}
                </span>
              )}
              <button
                onClick={() => setShowEditForm(v => !v)}
                style={{ marginLeft: 'auto', fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 6, border: '1px solid var(--border)', background: showEditForm ? 'var(--accent)' : 'var(--surface)', color: showEditForm ? '#fff' : 'var(--text-muted)', cursor: 'pointer' }}
              >
                {showEditForm ? '▲ Close' : '✏ Edit'}
              </button>
            </div>
          )}
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '20px 24px' }}>

          {/* Collapsible edit form */}
          {showEditForm && (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 16 }}>
                <div style={{ gridColumn: '1/-1' }}>
                  <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '.04em', display: 'block', marginBottom: 4 }}>Company Name *</label>
                  <input type="text" value={deal.company_name || ''} onChange={e => field('company_name', e.target.value)} style={{ width: '100%', fontSize: 13 }} />
                </div>
                <div>
                  <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '.04em', display: 'block', marginBottom: 4 }}>Contact Name</label>
                  <input type="text" value={deal.contact_name || ''} onChange={e => field('contact_name', e.target.value)} style={{ width: '100%', fontSize: 13 }} />
                </div>
                <div>
                  <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '.04em', display: 'block', marginBottom: 4 }}>Contact Email</label>
                  <input type="email" value={deal.contact_email || ''} onChange={e => field('contact_email', e.target.value)} style={{ width: '100%', fontSize: 13 }} />
                </div>
                <div>
                  <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '.04em', display: 'block', marginBottom: 4 }}>Stage</label>
                  <select value={deal.stage || 'outreach'} onChange={e => field('stage', e.target.value)} style={{ width: '100%', fontSize: 13 }}>
                    {STAGES.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
                  </select>
                </div>
                <div>
                  <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '.04em', display: 'block', marginBottom: 4 }}>Assigned To</label>
                  <select value={deal.assigned_to || ''} onChange={e => field('assigned_to', e.target.value)} style={{ width: '100%', fontSize: 13 }}>
                    <option value="">Unassigned</option>
                    {OWNERS.map(o => <option key={o} value={o}>{o}</option>)}
                  </select>
                </div>
                <div>
                  <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '.04em', display: 'block', marginBottom: 4 }}>Project Value <span style={{ fontWeight: 400, textTransform: 'none' }}>(one-time)</span></label>
                  <input type="number" min="0" value={deal.project_value || ''} onChange={e => field('project_value', e.target.value)} placeholder="0" style={{ width: '100%', fontSize: 13 }} />
                </div>
                <div>
                  <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '.04em', display: 'block', marginBottom: 4 }}>Est. Close Date</label>
                  <input type="date" value={deal.close_date_estimate || ''} onChange={e => field('close_date_estimate', e.target.value)} style={{ width: '100%', fontSize: 13 }} />
                </div>
                {deal.stage === 'lost' && (
                  <div style={{ gridColumn: '1/-1' }}>
                    <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '.04em', display: 'block', marginBottom: 4 }}>Lost Reason</label>
                    <input type="text" value={deal.lost_reason || ''} onChange={e => field('lost_reason', e.target.value)} placeholder="e.g. Budget, timing, competitor" style={{ width: '100%', fontSize: 13 }} />
                  </div>
                )}
              </div>

              <div style={{ display: 'flex', gap: 8, marginBottom: 24, paddingBottom: 24, borderBottom: '1px solid var(--border)' }}>
                <button className="btn btn-primary" onClick={save} disabled={saving} style={{ flex: 1 }}>
                  {saving ? 'Saving…' : isNew ? 'Create Deal' : 'Save Changes'}
                </button>
                {!isNew && (
                  <button className="btn btn-danger" onClick={handleDelete} disabled={deleting} style={{ flexShrink: 0 }}>
                    {deleting ? '…' : '🗑'}
                  </button>
                )}
              </div>
            </>
          )}

          {/* Tabs */}
          {!isNew && (
            <>
              {overdueTasks.length > 0 && (
                <div
                  style={{ background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: 6, padding: '8px 12px', marginBottom: 12, fontSize: 12, color: '#b91c1c', fontWeight: 600, cursor: 'pointer' }}
                  onClick={() => setTab('nextsteps')}
                >
                  ⚠️ {overdueTasks.length} overdue next step{overdueTasks.length > 1 ? 's' : ''} — click to view
                </div>
              )}

              <div style={{ display: 'flex', gap: 0, borderBottom: '2px solid var(--border)', marginBottom: 16, overflowX: 'auto' }}>
                {[
                  { id: 'nextsteps',  label: openTasks.length > 0 ? `Next Steps (${openTasks.length})` : 'Next Steps' },
                  { id: 'activities', label: 'Activity' },
                  { id: 'meetings',   label: meetings.length > 0 ? `Meetings (${meetings.length})` : 'Meetings' },
                  { id: 'research',   label: companyIntel?.thesis_built ? '🔬 Research ✓' : '🔬 Research' },
                  { id: 'contacts',   label: 'Contacts' },
                ].map(t => (
                  <button
                    key={t.id}
                    onClick={() => setTab(t.id)}
                    style={{
                      padding: '8px 14px', fontSize: 12, fontWeight: 700,
                      background: 'none', border: 'none',
                      borderBottom: tab === t.id ? '2px solid var(--accent)' : '2px solid transparent',
                      marginBottom: -2, cursor: 'pointer',
                      color: tab === t.id ? 'var(--accent)' : 'var(--text-muted)',
                    }}
                  >
                    {t.label}
                  </button>
                ))}
              </div>

              {/* ── Activities ── */}
              {tab === 'activities' && (
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                    <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '.04em' }}>Activity Log</span>
                    <button className="btn btn-secondary btn-xs" onClick={() => setAddingAct(a => !a)}>+ Log Activity</button>
                  </div>

                  {addingAct && (
                    <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, padding: 12, marginBottom: 12 }}>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginBottom: 8 }}>
                        <select value={actForm.type} onChange={e => setActForm(f => ({ ...f, type: e.target.value }))} style={{ fontSize: 12 }}>
                          {ACTIVITY_TYPES.map(t => <option key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</option>)}
                        </select>
                        <input type="date" value={actForm.activity_date} onChange={e => setActForm(f => ({ ...f, activity_date: e.target.value }))} style={{ fontSize: 12 }} />
                        <select value={actForm.assigned_to} onChange={e => setActForm(f => ({ ...f, assigned_to: e.target.value }))} style={{ fontSize: 12 }}>
                          {OWNERS.map(o => <option key={o} value={o}>{o}</option>)}
                        </select>
                      </div>
                      <textarea rows={2} placeholder="What happened? Key points, outcomes…" value={actForm.summary} onChange={e => setActForm(f => ({ ...f, summary: e.target.value }))} style={{ width: '100%', fontSize: 12, lineHeight: 1.5, marginBottom: 8 }} />
                      <div style={{ display: 'flex', gap: 6 }}>
                        <button className="btn btn-primary btn-sm" onClick={submitActivity} disabled={savingAct}>{savingAct ? 'Saving…' : 'Log'}</button>
                        <button className="btn btn-ghost btn-sm" onClick={() => setAddingAct(false)}>Cancel</button>
                      </div>
                    </div>
                  )}

                  {activities.length === 0 && !addingAct && (
                    <p style={{ fontSize: 12, color: 'var(--text-faint)', textAlign: 'center', padding: '16px 0' }}>No activity logged yet.</p>
                  )}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {activities.map(a => (
                      <div key={a.id} style={{ display: 'flex', gap: 10, padding: '10px 12px', background: 'var(--surface)', borderRadius: 6, border: `1px solid ${confirmDeleteActId === a.id ? '#fca5a5' : 'var(--border)'}`, transition: 'border-color .15s' }}>
                        <span style={{ fontSize: 16, flexShrink: 0, marginTop: 1 }}>{ACTIVITY_ICONS[a.type] || '📝'}</span>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 2 }}>
                            <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'capitalize' }}>{a.type}</span>
                            <span style={{ fontSize: 11, color: 'var(--text-faint)' }}>{a.activity_date}</span>
                            {a.assigned_to && <span style={{ fontSize: 10, fontWeight: 700, padding: '1px 6px', borderRadius: 3, background: a.assigned_to === 'Mike' ? '#f3e8ff' : '#eff6ff', color: a.assigned_to === 'Mike' ? '#7c3aed' : '#1d4ed8' }}>{a.assigned_to}</span>}
                          </div>
                          <p style={{ fontSize: 12, color: 'var(--text)', margin: 0, lineHeight: 1.5 }}>{a.summary}</p>
                        </div>
                        {/* Delete control */}
                        <div style={{ flexShrink: 0, display: 'flex', alignItems: 'flex-start', gap: 4, paddingTop: 1 }}>
                          {confirmDeleteActId === a.id ? (
                            <>
                              <button
                                onClick={() => { removeActivity(a.id); setConfirmDeleteActId(null); }}
                                style={{ fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 4, border: '1px solid #fca5a5', background: '#fee2e2', color: '#dc2626', cursor: 'pointer' }}
                              >Delete</button>
                              <button
                                onClick={() => setConfirmDeleteActId(null)}
                                style={{ fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 4, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text-muted)', cursor: 'pointer' }}
                              >Cancel</button>
                            </>
                          ) : (
                            <button
                              onClick={() => setConfirmDeleteActId(a.id)}
                              title="Delete activity"
                              style={{ background: 'none', border: 'none', color: 'var(--text-faint)', cursor: 'pointer', fontSize: 14, lineHeight: 1, padding: '1px 3px', borderRadius: 3, opacity: 0.5 }}
                              onMouseEnter={e => e.currentTarget.style.opacity = '1'}
                              onMouseLeave={e => e.currentTarget.style.opacity = '0.5'}
                            >🗑</button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* ── Next Steps ── */}
              {tab === 'nextsteps' && (
                <div>

                  {/* AI-recommended next steps from thesis */}
                  {(companyIntel?.thesis_next_step || companyIntel?.entry_contact || companyIntel?.recommended_angle) && (
                    <div style={{ marginBottom: 20 }}>
                      <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 8 }}>
                        AI Recommended
                      </div>

                      {/* Recommended next action */}
                      {companyIntel.thesis_next_step && (
                        <div style={{ padding: '10px 12px', background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 8, marginBottom: 8, display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                          <span style={{ fontSize: 15, flexShrink: 0 }}>🎯</span>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: 11, fontWeight: 700, color: '#15803d', marginBottom: 3 }}>NEXT ACTION</div>
                            <p style={{ fontSize: 12, color: '#14532d', lineHeight: 1.6, margin: '0 0 6px' }}>{companyIntel.thesis_next_step}</p>
                            <button
                              onClick={() => { setTaskForm(f => ({ ...f, title: companyIntel.thesis_next_step })); setAddingTask(true); }}
                              style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 4, border: '1px solid #86efac', background: '#dcfce7', color: '#15803d', cursor: 'pointer' }}
                            >
                              + Add as Next Step
                            </button>
                          </div>
                        </div>
                      )}

                      {/* Entry contact outreach hook */}
                      {companyIntel.entry_contact?.name && (
                        <div style={{ padding: '10px 12px', background: '#ede9fe', border: '1px solid #c4b5fd', borderRadius: 8, marginBottom: 8, display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                          <span style={{ fontSize: 15, flexShrink: 0 }}>✉️</span>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: 11, fontWeight: 700, color: '#6d28d9', marginBottom: 3 }}>
                              OUTREACH — {companyIntel.entry_contact.name}{companyIntel.entry_contact.title ? `, ${companyIntel.entry_contact.title}` : ''}
                            </div>
                            {companyIntel.entry_contact.hook && (
                              <p style={{ fontSize: 12, color: '#4c1d95', lineHeight: 1.6, margin: '0 0 6px' }}>{companyIntel.entry_contact.hook}</p>
                            )}
                            <button
                              onClick={() => {
                                const text = `Reach out to ${companyIntel.entry_contact.name}${companyIntel.entry_contact.hook ? ` — ${companyIntel.entry_contact.hook}` : ''}`;
                                setTaskForm(f => ({ ...f, title: text }));
                                setAddingTask(true);
                              }}
                              style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 4, border: '1px solid #c4b5fd', background: '#ede9fe', color: '#6d28d9', cursor: 'pointer' }}
                            >
                              + Add as Next Step
                            </button>
                          </div>
                        </div>
                      )}

                      {/* Positioning angle */}
                      {companyIntel.recommended_angle && (
                        <div style={{ padding: '10px 12px', background: '#fff7ed', border: '1px solid #fed7aa', borderRadius: 8, marginBottom: 8, display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                          <span style={{ fontSize: 15, flexShrink: 0 }}>💡</span>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: 11, fontWeight: 700, color: '#c2410c', marginBottom: 3 }}>POSITIONING ANGLE</div>
                            <p style={{ fontSize: 12, color: '#7c2d12', lineHeight: 1.6, margin: 0 }}>{companyIntel.recommended_angle}</p>
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {/* ── AI Outreach Advisor ── */}
                  <div style={{ marginBottom: 20 }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 8 }}>
                      ✦ Outreach Advisor
                    </div>
                    <div style={{ padding: '12px 14px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8 }}>
                      {mergedContacts.length === 0 ? (
                        <p style={{ fontSize: 12, color: 'var(--text-faint)', margin: 0, lineHeight: 1.6 }}>
                          No contacts found. Build a thesis first to discover contacts, or add one on the Contacts tab.
                        </p>
                      ) : (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>

                          {/* Contact picker — only shown when there's more than one */}
                          {mergedContacts.length > 1 && (
                            <div>
                              <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>Contact</label>
                              <select
                                value={draftContactName}
                                onChange={e => { setDraftContactName(e.target.value); setContextualAdvice(null); }}
                                style={{ width: '100%', fontSize: 12 }}
                              >
                                <option value="">— primary / first —</option>
                                {mergedContacts.map(c => (
                                  <option key={c.name} value={c.name}>
                                    {c.name}{c.title ? ` — ${c.title}` : ''}
                                  </option>
                                ))}
                              </select>
                            </div>
                          )}

                          {/* Advise & Draft button */}
                          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                            <button
                              className="btn btn-primary btn-sm"
                              onClick={handleDraftEmail}
                              disabled={draftingEmail}
                              style={{ display: 'flex', alignItems: 'center', gap: 6 }}
                            >
                              {draftingEmail ? (
                                <>
                                  <span style={{ display: 'inline-block', width: 12, height: 12, border: '2px solid #fff', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin .7s linear infinite' }} />
                                  Analyzing deal…
                                </>
                              ) : '✦ Advise & Draft'}
                            </button>
                            {!draftingEmail && !contextualAdvice && (
                              <span style={{ fontSize: 11, color: 'var(--text-faint)' }}>
                                {(() => {
                                  const c = mergedContacts.find(x => x.name === draftContactName) || mergedContacts.find(x => x.is_primary) || mergedContacts[0];
                                  return c ? `→ ${c.name}${c.title ? `, ${c.title}` : ''}` : '';
                                })()}
                              </span>
                            )}
                          </div>

                          {emailDraftError && (
                            <p style={{ fontSize: 12, color: '#ef4444', margin: 0, lineHeight: 1.5 }}>
                              ⚠ {emailDraftError}
                            </p>
                          )}

                          {/* Advice card — shown after generation */}
                          {contextualAdvice && (
                            <div style={{ border: '1px solid #c4b5fd', borderRadius: 8, background: '#faf5ff', overflow: 'hidden' }}>
                              {/* Email type badge */}
                              <div style={{ padding: '6px 12px', background: '#ede9fe', borderBottom: '1px solid #c4b5fd', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                                <span style={{ fontSize: 10, fontWeight: 700, color: '#6d28d9', textTransform: 'uppercase', letterSpacing: '.06em' }}>
                                  {{
                                    cold_intro: '❄ Cold Intro',
                                    follow_up: '↩ Follow-up',
                                    post_meeting: '🤝 Post-Meeting',
                                    post_proposal: '📋 Post-Proposal',
                                    re_engagement: '🔄 Re-engagement',
                                    nurture: '🌱 Nurture',
                                    check_in: '👋 Check-in',
                                  }[contextualAdvice.emailType] || '✉ Outreach'}
                                </span>
                                <button
                                  onClick={() => setContextualAdvice(null)}
                                  style={{ background: 'none', border: 'none', color: '#a78bfa', cursor: 'pointer', fontSize: 14, lineHeight: 1, padding: 0 }}
                                >×</button>
                              </div>

                              <div style={{ padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 10 }}>
                                {/* Situation */}
                                <div>
                                  <div style={{ fontSize: 10, fontWeight: 700, color: '#7c3aed', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 3 }}>Situation</div>
                                  <p style={{ fontSize: 12, color: '#4c1d95', fontStyle: 'italic', margin: 0, lineHeight: 1.6 }}>
                                    {contextualAdvice.situation}
                                  </p>
                                </div>

                                {/* Recommendation */}
                                <div>
                                  <div style={{ fontSize: 10, fontWeight: 700, color: '#7c3aed', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 3 }}>Recommendation</div>
                                  <p style={{ fontSize: 12, color: '#3b0764', fontWeight: 600, margin: 0, lineHeight: 1.6 }}>
                                    {contextualAdvice.recommendation}
                                  </p>
                                </div>

                                {/* Timing */}
                                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 6, padding: '7px 10px', background: '#f3e8ff', borderRadius: 6 }}>
                                  <span style={{ fontSize: 13, flexShrink: 0, marginTop: 1 }}>🕐</span>
                                  <div>
                                    <div style={{ fontSize: 10, fontWeight: 700, color: '#7c3aed', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 2 }}>Timing</div>
                                    <p style={{ fontSize: 12, color: '#6d28d9', margin: 0, lineHeight: 1.5 }}>{contextualAdvice.timing}</p>
                                  </div>
                                </div>

                                {/* Subject preview */}
                                <div style={{ background: 'white', border: '1px solid #ddd6fe', borderRadius: 6, padding: '8px 10px' }}>
                                  <div style={{ fontSize: 10, fontWeight: 700, color: '#7c3aed', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 3 }}>Draft Subject</div>
                                  <div style={{ fontSize: 12, color: '#1e1b4b', fontWeight: 500 }}>{contextualAdvice.subject}</div>
                                </div>

                                {/* Open in compose */}
                                <button
                                  className="btn btn-primary btn-sm"
                                  onClick={() => setComposeEmail({ to: contextualAdvice.contactEmail, toName: contextualAdvice.contactName })}
                                  style={{ alignSelf: 'flex-start', display: 'flex', alignItems: 'center', gap: 6 }}
                                >
                                  ✉ Open Draft in Compose
                                </button>
                              </div>
                            </div>
                          )}

                        </div>
                      )}
                    </div>
                  </div>

                  {/* Manual next steps */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                    <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '.04em' }}>My Next Steps</span>
                    <button className="btn btn-secondary btn-xs" onClick={() => setAddingTask(a => !a)}>+ Add Step</button>
                  </div>

                  {addingTask && (
                    <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, padding: 12, marginBottom: 12 }}>
                      <input type="text" placeholder="What needs to happen next?" value={taskForm.title} onChange={e => setTaskForm(f => ({ ...f, title: e.target.value }))} style={{ width: '100%', fontSize: 12, marginBottom: 8 }} />
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 8 }}>
                        <input type="date" value={taskForm.due_date} onChange={e => setTaskForm(f => ({ ...f, due_date: e.target.value }))} style={{ fontSize: 12 }} />
                        <select value={taskForm.assigned_to} onChange={e => setTaskForm(f => ({ ...f, assigned_to: e.target.value }))} style={{ fontSize: 12 }}>
                          {OWNERS.map(o => <option key={o} value={o}>{o}</option>)}
                        </select>
                      </div>
                      <div style={{ display: 'flex', gap: 6 }}>
                        <button className="btn btn-primary btn-sm" onClick={submitTask} disabled={savingTask}>{savingTask ? 'Saving…' : 'Add'}</button>
                        <button className="btn btn-ghost btn-sm" onClick={() => setAddingTask(false)}>Cancel</button>
                      </div>
                    </div>
                  )}

                  {tasks.length === 0 && !addingTask && !companyIntel?.thesis_next_step && (
                    <p style={{ fontSize: 12, color: 'var(--text-faint)', textAlign: 'center', padding: '16px 0' }}>
                      No next steps yet. Build a thesis to get AI recommendations, or add one manually.
                    </p>
                  )}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {tasks.map(t => {
                      const overdue = !t.completed && t.due_date && new Date(t.due_date) < new Date();
                      const reminded = t.id && hasReminder(t.id);
                      return (
                        <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', background: t.completed ? 'var(--surface)' : overdue ? '#fef2f2' : 'var(--surface)', borderRadius: 6, border: `1px solid ${overdue && !t.completed ? '#fca5a5' : 'var(--border)'}`, opacity: t.completed ? 0.6 : 1 }}>
                          <input type="checkbox" checked={t.completed} onChange={() => toggleTask(t)} style={{ cursor: 'pointer', flexShrink: 0 }} />
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <span style={{ fontSize: 13, textDecoration: t.completed ? 'line-through' : 'none', color: t.completed ? 'var(--text-muted)' : 'var(--text)' }}>{t.title}</span>
                            <div style={{ display: 'flex', gap: 6, marginTop: 2, alignItems: 'center', flexWrap: 'wrap' }}>
                              {t.due_date && <span style={{ fontSize: 11, color: overdue && !t.completed ? '#b91c1c' : 'var(--text-faint)', fontWeight: overdue && !t.completed ? 700 : 400 }}>{overdue && !t.completed ? '⚠ ' : ''}{t.due_date}</span>}
                              {t.assigned_to && <span style={{ fontSize: 10, fontWeight: 700, padding: '1px 6px', borderRadius: 3, background: t.assigned_to === 'Mike' ? '#f3e8ff' : '#eff6ff', color: t.assigned_to === 'Mike' ? '#7c3aed' : '#1d4ed8' }}>{t.assigned_to}</span>}
                              {reminded && <span style={{ fontSize: 10, color: '#f59e0b' }}>🔔</span>}
                            </div>
                          </div>
                          {/* Reminder toggle */}
                          {!t.completed && t.due_date && t.id && (
                            <button
                              title={reminded ? 'Cancel reminder' : 'Set reminder'}
                              onClick={async () => {
                                if (reminded) {
                                  clearReminder(t.id);
                                } else {
                                  const ok = await requestAndSave({
                                    id: t.id,
                                    title: t.title,
                                    company: deal.company_name,
                                    assigned_to: t.assigned_to,
                                    due_date: t.due_date,
                                  });
                                  if (!ok) alert('Enable browser notifications to set reminders.');
                                }
                                // force re-render
                                setTasks(ts => [...ts]);
                              }}
                              style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 14, flexShrink: 0, padding: '0 2px', opacity: reminded ? 1 : 0.35 }}
                            >
                              🔔
                            </button>
                          )}
                          <button onClick={() => removeTask(t.id)} style={{ background: 'none', border: 'none', color: 'var(--text-faint)', cursor: 'pointer', fontSize: 14, flexShrink: 0, padding: '0 2px' }}>×</button>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* ── Meetings ── */}
              {tab === 'meetings' && (
                <div
                  onDragOver={e => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); setFileDropActive(true); } }}
                  onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget)) setFileDropActive(false); }}
                  onDrop={e => {
                    e.preventDefault();
                    setFileDropActive(false);
                    const file = e.dataTransfer.files?.[0];
                    if (!file) return;
                    const reader = new FileReader();
                    reader.onload = ev => {
                      setInitialTranscript(ev.target.result || '');
                      setShowTranscriptImporter(true);
                    };
                    reader.onerror = () => alert('Could not read file. Try a plain text (.txt) file.');
                    reader.readAsText(file);
                  }}
                  style={{ position: 'relative' }}
                >
                  {/* File drop overlay */}
                  {fileDropActive && (
                    <div style={{ position: 'absolute', inset: 0, zIndex: 10, borderRadius: 10, border: '2px dashed var(--accent)', background: 'color-mix(in srgb, var(--accent) 8%, transparent)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 6, pointerEvents: 'none' }}>
                      <span style={{ fontSize: 28 }}>📄</span>
                      <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--accent)' }}>Drop to import transcript</span>
                    </div>
                  )}

                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                    <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '.04em' }}>Meeting Log</span>
                    <div style={{ display: 'flex', gap: 8 }}>
                      {meetings.length > 0 && (
                        <button className="btn btn-primary btn-xs" onClick={() => setShowProposalDraft(true)}>✦ Draft Proposal</button>
                      )}
                      <button className="btn btn-secondary btn-xs" onClick={() => { setInitialTranscript(''); setShowTranscriptImporter(true); }}>+ Add Meeting</button>
                    </div>
                  </div>

                  {meetings.length === 0 && (
                    <div style={{ textAlign: 'center', padding: '24px 0' }}>
                      <p style={{ fontSize: 12, color: 'var(--text-faint)', marginBottom: 6 }}>No meetings logged yet.</p>
                      <p style={{ fontSize: 11, color: 'var(--text-faint)', marginBottom: 10 }}>Drag a transcript file here or click below</p>
                      <button className="btn btn-secondary btn-sm" onClick={() => { setInitialTranscript(''); setShowTranscriptImporter(true); }}>📝 Add first meeting</button>
                    </div>
                  )}

                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    {meetings.map(mtg => (
                      <div
                        key={mtg.id}
                        draggable
                        onDragStart={() => { dragMtgIdRef.current = mtg.id; }}
                        onDragEnter={() => setDragOverMtgId(mtg.id)}
                        onDragOver={e => e.preventDefault()}
                        onDrop={() => handleMtgDrop(mtg.id)}
                        onDragEnd={() => { dragMtgIdRef.current = null; setDragOverMtgId(null); }}
                        style={{
                          padding: '12px 14px',
                          background: 'var(--surface)',
                          border: dragOverMtgId === mtg.id ? '1px solid var(--accent)' : '1px solid var(--border)',
                          borderRadius: 8,
                          opacity: dragMtgIdRef.current === mtg.id ? 0.45 : 1,
                          transition: 'border-color 0.12s, opacity 0.12s',
                          cursor: 'grab',
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginBottom: mtg.summary ? 6 : 0 }}>
                          {/* drag handle */}
                          <span title="Drag to reorder" style={{ color: 'var(--text-faint)', fontSize: 14, lineHeight: 1, paddingTop: 2, cursor: 'grab', userSelect: 'none', flexShrink: 0 }}>⠿</span>
                          <div style={{ flex: 1 }}>
                            <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>{mtg.title}</div>
                            {mtg.meeting_date && <div style={{ fontSize: 11, color: 'var(--text-faint)', marginTop: 1 }}>{new Date(mtg.meeting_date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'long', day: 'numeric', year: 'numeric' })}</div>}
                          </div>
                          <div style={{ display: 'flex', gap: 5, flexShrink: 0 }}>
                            {mtg.transcript && (
                              <button onClick={() => setShowTranscript(showTranscript === mtg.id ? null : mtg.id)} style={{ fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 5, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text-faint)', cursor: 'pointer' }}>
                                {showTranscript === mtg.id ? 'Hide' : 'Transcript'}
                              </button>
                            )}
                            <button onClick={async () => { await deleteProjectMeeting(mtg.id); setMeetings(prev => prev.filter(m => m.id !== mtg.id)); }} style={{ fontSize: 10, padding: '2px 5px', borderRadius: 5, border: '1px solid var(--border)', background: 'none', color: 'var(--text-faint)', cursor: 'pointer' }}>🗑</button>
                          </div>
                        </div>
                        {mtg.summary && <div style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.6, marginBottom: mtg.action_items?.length ? 6 : 0 }}>{mtg.summary}</div>}
                        {mtg.action_items?.length > 0 && (
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                            {mtg.action_items.map((ai, i) => (
                              <span key={i} style={{ fontSize: 11, padding: '2px 8px', borderRadius: 12, background: 'var(--bg)', border: '1px solid var(--border)', color: 'var(--text-muted)' }}>
                                {ai.owner && <span style={{ fontWeight: 700, color: 'var(--accent)', marginRight: 3 }}>{ai.owner}</span>}
                                {ai.title}
                              </span>
                            ))}
                          </div>
                        )}
                        {showTranscript === mtg.id && mtg.transcript && (
                          <div style={{ marginTop: 8, padding: '8px 10px', background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 6, fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.7, whiteSpace: 'pre-wrap', maxHeight: 220, overflowY: 'auto' }}>
                            {mtg.transcript}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>

                {/* ── Meeting Notes ── */}
                <hr style={{ border: 'none', borderTop: '2px solid var(--border)', margin: '28px 0 20px' }} />
                <div>
                  <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 8 }}>Deal Notes</div>
                  <textarea
                    rows={5}
                    value={deal.notes || ''}
                    onChange={e => field('notes', e.target.value)}
                    placeholder="Internal context, key decisions, next steps…"
                    style={{ width: '100%', fontSize: 13, lineHeight: 1.6, marginBottom: 8 }}
                  />
                  <button className="btn btn-secondary btn-sm" onClick={saveNotes} disabled={savingNotes}>
                    {savingNotes ? 'Saving…' : 'Save Notes'}
                  </button>
                </div>
                </div>
              )}

              {/* ── Research ── */}
              {tab === 'research' && (
                <div>
                  {/* ── Research Materials ── */}
                  {(() => {
                    const items = companyIntel?.research_items || [];
                    const ITEM_ICONS = { link: '🔗', document: '📄', note: '📝' };
                    return (
                      <div style={{ marginBottom: 20 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                          <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '.04em' }}>
                            Research Materials{items.length > 0 ? ` (${items.length})` : ''}
                          </span>
                          {!addingItem && (
                            <button
                              onClick={() => setAddingItem(true)}
                              style={{ fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text-muted)', cursor: 'pointer' }}
                            >
                              + Add
                            </button>
                          )}
                        </div>

                        {/* Add form */}
                        {addingItem && (
                          <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, padding: 12, marginBottom: 10 }}>
                            <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
                              {['link','document','note'].map(t => (
                                <button
                                  key={t}
                                  onClick={() => setItemDraft(d => ({ ...d, type: t }))}
                                  style={{
                                    padding: '4px 10px', fontSize: 11, fontWeight: 700, borderRadius: 6, cursor: 'pointer',
                                    background: itemDraft.type === t ? 'var(--accent)' : 'var(--bg)',
                                    color: itemDraft.type === t ? '#fff' : 'var(--text-muted)',
                                    border: `1px solid ${itemDraft.type === t ? 'var(--accent)' : 'var(--border)'}`,
                                  }}
                                >
                                  {ITEM_ICONS[t]} {t.charAt(0).toUpperCase() + t.slice(1)}
                                </button>
                              ))}
                            </div>
                            <input
                              type="text"
                              placeholder="Title (optional)"
                              value={itemDraft.title}
                              onChange={e => setItemDraft(d => ({ ...d, title: e.target.value }))}
                              style={{ width: '100%', fontSize: 12, marginBottom: 6 }}
                            />
                            {itemDraft.type === 'link' && (
                              <input
                                type="url"
                                placeholder="https://…"
                                value={itemDraft.url}
                                onChange={e => setItemDraft(d => ({ ...d, url: e.target.value }))}
                                style={{ width: '100%', fontSize: 12, marginBottom: 6 }}
                              />
                            )}
                            {(itemDraft.type === 'document' || itemDraft.type === 'note') && (
                              <textarea
                                rows={5}
                                placeholder={itemDraft.type === 'document' ? 'Paste document content, transcript, article text…' : 'Write your note…'}
                                value={itemDraft.body}
                                onChange={e => setItemDraft(d => ({ ...d, body: e.target.value }))}
                                style={{ width: '100%', fontSize: 12, lineHeight: 1.5, marginBottom: 6 }}
                              />
                            )}
                            <div style={{ display: 'flex', gap: 6 }}>
                              <button className="btn btn-primary btn-sm" onClick={handleAddItem} disabled={savingItem}>
                                {savingItem ? 'Saving…' : 'Add'}
                              </button>
                              <button className="btn btn-ghost btn-sm" onClick={() => { setAddingItem(false); setItemDraft({ type: 'link', title: '', url: '', body: '' }); }}>
                                Cancel
                              </button>
                            </div>
                          </div>
                        )}

                        {/* Items list */}
                        {items.length > 0 && (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                            {items.map(item => (
                              <div key={item.id} style={{ display: 'flex', alignItems: 'flex-start', gap: 8, padding: '7px 10px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 6 }}>
                                <span style={{ fontSize: 13, flexShrink: 0, marginTop: 1 }}>{ITEM_ICONS[item.type] || '📎'}</span>
                                <div style={{ flex: 1, minWidth: 0 }}>
                                  <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)', marginBottom: item.url ? 2 : 0 }}>{item.title}</div>
                                  {item.url && (
                                    <a href={item.url} target="_blank" rel="noopener noreferrer" style={{ fontSize: 11, color: 'var(--accent)', wordBreak: 'break-all' }}>{item.url}</a>
                                  )}
                                  {item.body && (
                                    <div style={{ fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.5, marginTop: 2, maxHeight: 40, overflow: 'hidden', maskImage: 'linear-gradient(to bottom, black 60%, transparent)' }}>
                                      {item.body.slice(0, 120)}{item.body.length > 120 ? '…' : ''}
                                    </div>
                                  )}
                                </div>
                                <button onClick={() => handleRemoveItem(item.id)} style={{ background: 'none', border: 'none', color: 'var(--text-faint)', cursor: 'pointer', fontSize: 14, flexShrink: 0, padding: '0 2px', lineHeight: 1 }}>×</button>
                              </div>
                            ))}
                          </div>
                        )}

                        {items.length === 0 && !addingItem && (
                          <p style={{ fontSize: 11, color: 'var(--text-faint)', margin: 0 }}>
                            Add links, documents or notes — they'll be fed into the thesis builder as primary source intel.
                          </p>
                        )}
                      </div>
                    );
                  })()}

                  <hr style={{ border: 'none', borderTop: '1px solid var(--border)', margin: '0 0 16px' }} />

                  {/* Header row */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                    <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '.04em' }}>
                      Company Research
                    </span>
                    <button
                      onClick={handleBuildThesis}
                      disabled={buildingThesis}
                      style={{
                        background: buildingThesis ? 'var(--surface)' : 'linear-gradient(135deg, #7c3aed, #4f46e5)',
                        color: buildingThesis ? 'var(--text-muted)' : '#fff',
                        border: buildingThesis ? '1px solid var(--border)' : 'none',
                        borderRadius: 7, padding: '6px 14px', fontSize: 12, fontWeight: 700,
                        cursor: buildingThesis ? 'not-allowed' : 'pointer',
                        display: 'flex', alignItems: 'center', gap: 6,
                      }}
                    >
                      {buildingThesis
                        ? <><span style={{ display: 'inline-block', width: 10, height: 10, border: '2px solid var(--text-muted)', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 0.7s linear infinite' }} /> Running…</>
                        : companyIntel?.thesis_built
                          ? '↺ Expand Thesis'
                          : '🔬 Build Thesis'
                      }
                    </button>
                  </div>

                  {intelLoading && (
                    <div style={{ textAlign: 'center', padding: '32px 0' }}>
                      <div className="spinner" />
                      <p style={{ fontSize: 12, color: 'var(--text-faint)', marginTop: 10 }}>Loading research…</p>
                    </div>
                  )}

                  {/* Live progress log */}
                  {buildingThesis && (
                    <div style={{ marginBottom: 20 }}>
                      {/* Phase strip */}
                      <div style={{ display: 'flex', gap: 6, marginBottom: 12, flexWrap: 'wrap' }}>
                        {THESIS_PHASES.map(ph => {
                          const ps = thesisPhases.find(p => p.id === ph.id);
                          const isDone    = ps?.status === 'done';
                          const isRunning = ps?.status === 'running';
                          return (
                            <div key={ph.id} style={{
                              display: 'flex', alignItems: 'center', gap: 5,
                              padding: '4px 10px', borderRadius: 20, fontSize: 11, fontWeight: 700,
                              background: isDone ? '#d1fae5' : isRunning ? '#ede9fe' : 'var(--surface)',
                              color: isDone ? '#059669' : isRunning ? '#7c3aed' : 'var(--text-faint)',
                              border: `1px solid ${isDone ? '#6ee7b7' : isRunning ? '#c4b5fd' : 'var(--border)'}`,
                              transition: 'all .2s',
                            }}>
                              {isDone ? '✓' : isRunning ? <span style={{ display: 'inline-block', width: 8, height: 8, border: '1.5px solid #7c3aed', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 0.7s linear infinite' }} /> : '○'}
                              {ph.label}
                            </div>
                          );
                        })}
                      </div>
                      {/* Log */}
                      <div style={{ background: '#0f172a', borderRadius: 8, padding: '10px 12px', maxHeight: 220, overflowY: 'auto', fontFamily: 'monospace', fontSize: 11, lineHeight: 1.7 }}>
                        {thesisLog.map((entry, i) => (
                          <div key={i} style={{ color: entry.msg.startsWith('✓') ? '#4ade80' : entry.msg.startsWith('✗') ? '#f87171' : '#94a3b8' }}>
                            <span style={{ color: '#475569', marginRight: 8 }}>{entry.time}</span>
                            {entry.msg}
                          </div>
                        ))}
                        <div ref={thesisLogEndRef} />
                      </div>
                    </div>
                  )}

                  {/* Error */}
                  {thesisError && !buildingThesis && (
                    <div style={{ background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: 8, padding: '10px 14px', marginBottom: 16, fontSize: 12, color: '#b91c1c' }}>
                      ⚠️ {thesisError}
                    </div>
                  )}

                  {/* Migration banner — shown when thesis columns are missing from DB */}
                  {thesisMigrationError && !buildingThesis && (
                    <div style={{ background: '#fffbeb', border: '2px solid #f59e0b', borderRadius: 10, padding: '14px 16px', marginBottom: 16 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                        <span style={{ fontSize: 16 }}>⚠️</span>
                        <span style={{ fontSize: 13, fontWeight: 800, color: '#92400e' }}>Thesis built but NOT saved — DB migration required</span>
                      </div>
                      <p style={{ fontSize: 12, color: '#78350f', margin: '0 0 10px' }}>
                        Your thesis is visible here but will be lost on reload until you run this SQL in your Supabase SQL editor:
                      </p>
                      <pre style={{
                        background: '#1e293b', color: '#e2e8f0', borderRadius: 7, padding: '10px 12px',
                        fontSize: 11, fontFamily: 'monospace', overflowX: 'auto', margin: '0 0 10px', lineHeight: 1.6,
                      }}>{`ALTER TABLE companies
  ADD COLUMN IF NOT EXISTS thesis           text,
  ADD COLUMN IF NOT EXISTS thesis_built     boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS thesis_date      timestamptz,
  ADD COLUMN IF NOT EXISTS thesis_risks     jsonb,
  ADD COLUMN IF NOT EXISTS thesis_next_step text,
  ADD COLUMN IF NOT EXISTS research_items   jsonb DEFAULT '[]'::jsonb;`}</pre>
                      <button
                        onClick={() => {
                          navigator.clipboard.writeText(
                            `ALTER TABLE companies\n  ADD COLUMN IF NOT EXISTS thesis           text,\n  ADD COLUMN IF NOT EXISTS thesis_built     boolean DEFAULT false,\n  ADD COLUMN IF NOT EXISTS thesis_date      timestamptz,\n  ADD COLUMN IF NOT EXISTS thesis_risks     jsonb,\n  ADD COLUMN IF NOT EXISTS thesis_next_step text,\n  ADD COLUMN IF NOT EXISTS research_items   jsonb DEFAULT '[]'::jsonb;`
                          ).then(() => alert('SQL copied to clipboard — paste into Supabase SQL editor'));
                        }}
                        style={{ fontSize: 11, fontWeight: 700, padding: '5px 12px', borderRadius: 6, border: '1px solid #f59e0b', background: '#fef3c7', color: '#92400e', cursor: 'pointer' }}
                      >
                        📋 Copy SQL
                      </button>
                    </div>
                  )}

                  {/* Intel summary — scores + triggers (if scan data exists) */}
                  {!intelLoading && !buildingThesis && companyIntel && (companyIntel.icp_score || companyIntel.summary) && (
                    <div style={{ marginBottom: 16 }}>
                      {/* Score badges */}
                      {(companyIntel.icp_score || companyIntel.overall_score) && (
                        <div style={{ display: 'flex', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
                          {companyIntel.icp_score && (
                            <span style={{ fontSize: 12, fontWeight: 700, padding: '3px 10px', borderRadius: 20, background: '#ede9fe', color: '#6d28d9' }}>
                              ICP {companyIntel.icp_score}/100
                            </span>
                          )}
                          {companyIntel.overall_score && (
                            <span style={{ fontSize: 12, fontWeight: 700, padding: '3px 10px', borderRadius: 20, background: '#fff7ed', color: '#c2410c' }}>
                              Score {companyIntel.overall_score}/100
                            </span>
                          )}
                          {companyIntel.funding_stage && (
                            <span style={{ fontSize: 12, fontWeight: 700, padding: '3px 10px', borderRadius: 20, background: '#f0fdf4', color: '#15803d' }}>
                              {companyIntel.funding_stage}
                            </span>
                          )}
                          {companyIntel.employee_count && (
                            <span style={{ fontSize: 12, fontWeight: 700, padding: '3px 10px', borderRadius: 20, background: 'var(--surface)', color: 'var(--text-muted)', border: '1px solid var(--border)' }}>
                              {companyIntel.employee_count} employees
                            </span>
                          )}
                        </div>
                      )}
                      {/* Summary */}
                      {companyIntel.summary && (
                        <p style={{ fontSize: 13, color: 'var(--text)', lineHeight: 1.65, margin: '0 0 12px' }}>{companyIntel.summary}</p>
                      )}
                      {/* Triggers */}
                      {companyIntel.triggers?.length > 0 && (
                        <div style={{ marginBottom: 12 }}>
                          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 6 }}>Triggers</div>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                            {companyIntel.triggers.slice(0, 3).map((t, i) => (
                              <div key={i} style={{ padding: '8px 10px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 6 }}>
                                <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 2 }}>{t.headline}</div>
                                {t.detail && <div style={{ fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.5 }}>{t.detail}</div>}
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Thesis narrative */}
                  {!intelLoading && !buildingThesis && companyIntel?.thesis && (
                    <div style={{ marginBottom: 16 }}>
                      <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 8 }}>Thesis</div>
                      <div style={{ fontSize: 13, color: 'var(--text)', lineHeight: 1.7, whiteSpace: 'pre-wrap', padding: '12px 14px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, marginBottom: 10 }}>
                        {companyIntel.thesis}
                      </div>

                      {/* Entry point */}
                      {companyIntel.contact_angles?.find(c => c.is_primary) && (() => {
                        const ec = companyIntel.contact_angles.find(c => c.is_primary);
                        return (
                          <div style={{ padding: '10px 14px', background: '#ede9fe', border: '1px solid #c4b5fd', borderRadius: 8, marginBottom: 10 }}>
                            <div style={{ fontSize: 11, fontWeight: 700, color: '#6d28d9', marginBottom: 4 }}>PRIMARY ENTRY POINT</div>
                            <div style={{ fontSize: 13, fontWeight: 700, color: '#4c1d95' }}>{ec.name} <span style={{ fontWeight: 400, color: '#7c3aed' }}>· {ec.title}</span></div>
                            {ec.hook && <div style={{ fontSize: 12, color: '#5b21b6', marginTop: 4, lineHeight: 1.5 }}>{ec.hook}</div>}
                          </div>
                        );
                      })()}

                      {/* Risks */}
                      {companyIntel.thesis_risks?.length > 0 && (
                        <div style={{ padding: '10px 14px', background: '#fff7ed', border: '1px solid #fed7aa', borderRadius: 8, marginBottom: 10 }}>
                          <div style={{ fontSize: 11, fontWeight: 700, color: '#c2410c', marginBottom: 6 }}>RISKS & WATCH-OUTS</div>
                          <ul style={{ margin: 0, paddingLeft: 16, display: 'flex', flexDirection: 'column', gap: 4 }}>
                            {companyIntel.thesis_risks.map((r, i) => (
                              <li key={i} style={{ fontSize: 12, color: '#7c2d12', lineHeight: 1.5 }}>{typeof r === 'string' ? r : r.risk || r.label || JSON.stringify(r)}</li>
                            ))}
                          </ul>
                        </div>
                      )}

                      {/* Next step */}
                      {companyIntel.thesis_next_step && (
                        <div style={{ padding: '10px 14px', background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 8 }}>
                          <div style={{ fontSize: 11, fontWeight: 700, color: '#15803d', marginBottom: 4 }}>RECOMMENDED NEXT STEP</div>
                          <div style={{ fontSize: 13, color: '#14532d', lineHeight: 1.55 }}>{companyIntel.thesis_next_step}</div>
                        </div>
                      )}

                      {companyIntel.thesis_date && (
                        <div style={{ fontSize: 10, color: 'var(--text-faint)', marginTop: 8, textAlign: 'right' }}>
                          Built {new Date(companyIntel.thesis_date).toLocaleDateString()}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Empty state */}
                  {!intelLoading && !buildingThesis && !companyIntel?.thesis && !companyIntel?.summary && (
                    <div style={{ textAlign: 'center', padding: '40px 0' }}>
                      <div style={{ fontSize: 36, marginBottom: 10 }}>🔬</div>
                      <h4 style={{ fontSize: 14, fontWeight: 700, margin: '0 0 6px' }}>No research yet</h4>
                      <p style={{ fontSize: 12, color: 'var(--text-muted)', maxWidth: 280, margin: '0 auto 16px', lineHeight: 1.6 }}>
                        Build a thesis to deep-research {deal.company_name} — leadership contacts, buying triggers, entry strategy and risks.
                      </p>
                      <button
                        onClick={handleBuildThesis}
                        style={{ background: 'linear-gradient(135deg, #7c3aed, #4f46e5)', color: '#fff', border: 'none', borderRadius: 8, padding: '9px 20px', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}
                      >
                        {companyIntel?.thesis_built ? '↺ Expand Thesis' : '🔬 Build Thesis'}
                      </button>
                    </div>
                  )}
                </div>
              )}

              {/* ── Contacts ── */}
              {tab === 'contacts' && (() => {
                // Merge: primary deal contact + company intel contact_angles
                const map = new Map();
                if (deal.contact_name?.trim()) {
                  const name = deal.contact_name.trim();
                  map.set(name.toLowerCase(), {
                    name,
                    email: deal.contact_email?.trim() || null,
                    source: 'deal',
                  });
                }
                (companyIntel?.contact_angles || []).forEach(c => {
                  if (!c.name?.trim()) return;
                  const name = c.name.trim();
                  const key = name.toLowerCase();
                  const existing = map.get(key) || {};
                  map.set(key, { ...existing, ...c, name, email: c.email || existing.email || null });
                });
                const contacts = Array.from(map.values());

                const sourceColor = s => s === 'thesis' ? { bg: '#ede9fe', color: '#6d28d9' } : s === 'scan' ? { bg: '#dbeafe', color: '#1d4ed8' } : s === 'manual' ? { bg: '#dcfce7', color: '#15803d' } : { bg: 'var(--surface)', color: 'var(--text-muted)' };

                return (
                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
                      <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '.04em' }}>
                        Contacts{contacts.length > 0 ? ` (${contacts.length})` : ''}
                      </span>
                      <button
                        onClick={() => setAddingContact(v => !v)}
                        style={{ fontSize: 11, fontWeight: 700, padding: '4px 12px', borderRadius: 6, border: '1px solid var(--border)', background: addingContact ? 'var(--accent)' : 'var(--surface)', color: addingContact ? '#fff' : 'var(--text-muted)', cursor: 'pointer' }}
                      >
                        {addingContact ? '✕ Cancel' : '+ Add Contact'}
                      </button>
                    </div>

                    {/* Add contact form */}
                    {addingContact && (
                      <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, padding: 14, marginBottom: 14 }}>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 8 }}>
                          <div>
                            <label style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '.04em', display: 'block', marginBottom: 3 }}>Name *</label>
                            <input type="text" value={contactDraft.name} onChange={e => setContactDraft(d => ({ ...d, name: e.target.value }))} placeholder="Full name" style={{ width: '100%', fontSize: 12 }} />
                          </div>
                          <div>
                            <label style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '.04em', display: 'block', marginBottom: 3 }}>Title</label>
                            <input type="text" value={contactDraft.title} onChange={e => setContactDraft(d => ({ ...d, title: e.target.value }))} placeholder="Job title" style={{ width: '100%', fontSize: 12 }} />
                          </div>
                          <div>
                            <label style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '.04em', display: 'block', marginBottom: 3 }}>Email</label>
                            <input type="email" value={contactDraft.email} onChange={e => setContactDraft(d => ({ ...d, email: e.target.value }))} placeholder="email@company.com" style={{ width: '100%', fontSize: 12 }} />
                          </div>
                          <div>
                            <label style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '.04em', display: 'block', marginBottom: 3 }}>LinkedIn URL</label>
                            <input type="url" value={contactDraft.linkedin} onChange={e => setContactDraft(d => ({ ...d, linkedin: e.target.value }))} placeholder="linkedin.com/in/…" style={{ width: '100%', fontSize: 12 }} />
                          </div>
                          <div style={{ gridColumn: '1/-1' }}>
                            <label style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '.04em', display: 'block', marginBottom: 3 }}>Notes</label>
                            <textarea rows={2} value={contactDraft.notes} onChange={e => setContactDraft(d => ({ ...d, notes: e.target.value }))} placeholder="What do you know about this person?" style={{ width: '100%', fontSize: 12, lineHeight: 1.5 }} />
                          </div>
                        </div>
                        <button className="btn btn-primary btn-sm" onClick={handleAddContact} disabled={savingContact || !contactDraft.name.trim()}>
                          {savingContact ? 'Saving…' : 'Add Contact'}
                        </button>
                      </div>
                    )}

                    {/* Loading state */}
                    {intelLoading && (
                      <div style={{ textAlign: 'center', padding: '24px 0' }}><div className="spinner" /></div>
                    )}

                    {/* Contacts list */}
                    {!intelLoading && contacts.length === 0 && (
                      <div style={{ textAlign: 'center', padding: '32px 0' }}>
                        <div style={{ fontSize: 28, marginBottom: 8 }}>👤</div>
                        <p style={{ fontSize: 12, color: 'var(--text-faint)', margin: '0 0 12px' }}>No contacts yet. Add one above or build a Thesis to discover contacts automatically.</p>
                      </div>
                    )}

                    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                      {contacts.map((c, i) => {
                        const initials = c.name.split(' ').map(w => w[0]).join('').slice(0,2).toUpperCase();
                        const isExpanded = expandedContact === (c.name);
                        const sc = sourceColor(c.source);
                        return (
                          <div key={i} style={{ border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden' }}>
                            {/* Contact header row */}
                            <div
                              style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', cursor: 'pointer', background: 'var(--surface)' }}
                              onClick={() => setExpandedContact(isExpanded ? null : c.name)}
                            >
                              {/* Avatar */}
                              <div style={{ width: 36, height: 36, borderRadius: '50%', background: `linear-gradient(135deg, ${sc.bg}, ${sc.color}22)`, border: `1.5px solid ${sc.color}44`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 800, color: sc.color, flexShrink: 0 }}>
                                {initials}
                              </div>
                              <div style={{ flex: 1, minWidth: 0 }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                  <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>{c.name}</span>
                                  {c.is_primary && <span style={{ fontSize: 9, fontWeight: 800, padding: '1px 5px', borderRadius: 4, background: '#ede9fe', color: '#6d28d9', textTransform: 'uppercase', letterSpacing: '.04em' }}>Primary</span>}
                                  {c.source && <span style={{ fontSize: 9, fontWeight: 700, padding: '1px 5px', borderRadius: 4, background: sc.bg, color: sc.color, textTransform: 'capitalize' }}>{c.source}</span>}
                                </div>
                                {c.title && <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 1 }}>{c.title}</div>}
                              </div>
                              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexShrink: 0 }}>
                                {c.linkedin && (
                                  <a href={c.linkedin} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()} style={{ fontSize: 11, color: '#1d4ed8', fontWeight: 600, textDecoration: 'none' }}>in</a>
                                )}
                                <span style={{ fontSize: 11, color: 'var(--text-faint)' }}>{isExpanded ? '▲' : '▼'}</span>
                              </div>
                            </div>

                            {/* Expanded dossier */}
                            {isExpanded && (
                              <div style={{ padding: '12px 14px', background: 'var(--bg)', borderTop: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: 10 }}>

                                {/* Inline edit form */}
                                {editingContact === c.name ? (
                                  <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, padding: 12 }}>
                                    <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 8 }}>Edit Contact</div>
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
                                      {[
                                        { key: 'title',    label: 'Title',    placeholder: 'e.g. COO' },
                                        { key: 'email',    label: 'Email',    placeholder: 'name@company.com', type: 'email' },
                                        { key: 'linkedin', label: 'LinkedIn', placeholder: 'https://linkedin.com/in/…' },
                                      ].map(({ key, label, placeholder, type }) => (
                                        <div key={key} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                          <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', width: 56, flexShrink: 0 }}>{label}</label>
                                          <input
                                            type={type || 'text'}
                                            value={editDraft[key] ?? c[key] ?? ''}
                                            onChange={e => setEditDraft(d => ({ ...d, [key]: e.target.value }))}
                                            placeholder={placeholder}
                                            style={{ flex: 1, fontSize: 12, padding: '4px 8px', borderRadius: 5, border: '1px solid var(--border)', background: 'var(--bg)' }}
                                          />
                                        </div>
                                      ))}
                                      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                                        <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', width: 56, flexShrink: 0, paddingTop: 5 }}>Notes</label>
                                        <textarea
                                          value={editDraft.notes ?? c.notes ?? ''}
                                          onChange={e => setEditDraft(d => ({ ...d, notes: e.target.value }))}
                                          placeholder="Any notes…"
                                          rows={2}
                                          style={{ flex: 1, fontSize: 12, padding: '4px 8px', borderRadius: 5, border: '1px solid var(--border)', background: 'var(--bg)', resize: 'vertical', fontFamily: 'inherit' }}
                                        />
                                      </div>
                                    </div>
                                    <div style={{ display: 'flex', gap: 8, marginTop: 10, alignItems: 'center' }}>
                                      <button onClick={() => { setEditingContact(null); setEditDraft({}); }} style={{ fontSize: 11, fontWeight: 600, padding: '4px 12px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text-muted)', cursor: 'pointer' }}>Cancel</button>
                                      <button onClick={saveContactEdit} disabled={savingEdit} style={{ fontSize: 11, fontWeight: 700, padding: '4px 14px', borderRadius: 6, border: 'none', background: 'var(--accent)', color: '#fff', cursor: savingEdit ? 'not-allowed' : 'pointer', opacity: savingEdit ? 0.7 : 1 }}>
                                        {savingEdit ? 'Saving…' : 'Save'}
                                      </button>
                                      <button
                                        onClick={() => handleDeleteContact(c)}
                                        style={{ marginLeft: 'auto', fontSize: 11, fontWeight: 700, padding: '4px 12px', borderRadius: 6, border: '1px solid #fca5a5', background: '#fef2f2', color: '#b91c1c', cursor: 'pointer' }}
                                      >
                                        🗑 Delete
                                      </button>
                                    </div>
                                  </div>
                                ) : (
                                  <>
                                    {/* Contact details row */}
                                    <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
                                      {c.email ? (
                                        <button
                                          onClick={e => { e.stopPropagation(); openCompose(c.email, c.name); }}
                                          style={{ fontSize: 12, color: 'var(--accent)', background: 'none', border: 'none', padding: 0, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4, fontFamily: 'inherit' }}
                                        >
                                          ✉️ {c.email}
                                        </button>
                                      ) : (
                                        <button
                                          onClick={e => { e.stopPropagation(); setEditingContact(c.name); setEditDraft({ email: '' }); }}
                                          style={{ fontSize: 11, color: 'var(--text-faint)', background: 'none', border: '1px dashed var(--border)', padding: '2px 8px', borderRadius: 5, cursor: 'pointer', fontFamily: 'inherit' }}
                                        >
                                          + Add email
                                        </button>
                                      )}
                                      {c.linkedin && (
                                        <a href={c.linkedin} target="_blank" rel="noopener noreferrer" style={{ fontSize: 12, color: '#1d4ed8', textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 4 }}>
                                          🔗 LinkedIn profile
                                        </a>
                                      )}
                                      <div style={{ marginLeft: 'auto', display: 'flex', gap: 6, alignItems: 'center' }}>
                                        <button
                                          onClick={e => { e.stopPropagation(); setEditingContact(c.name); setEditDraft({}); }}
                                          style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-faint)', background: 'none', border: '1px solid var(--border)', borderRadius: 4, padding: '2px 8px', cursor: 'pointer', fontFamily: 'inherit' }}
                                        >✏ Edit</button>
                                        <button
                                          onClick={e => { e.stopPropagation(); handleDeleteContact(c); }}
                                          style={{ fontSize: 10, fontWeight: 700, color: '#b91c1c', background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: 4, padding: '2px 8px', cursor: 'pointer', fontFamily: 'inherit' }}
                                        >🗑 Remove</button>
                                      </div>
                                    </div>

                                    {/* Outreach angle */}
                                    {c.angle && (
                                      <div>
                                        <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 3 }}>Outreach Angle</div>
                                        <p style={{ fontSize: 12, color: 'var(--text)', lineHeight: 1.6, margin: 0 }}>{c.angle}</p>
                                      </div>
                                    )}

                                    {/* Hook */}
                                    {c.hook && (
                                      <div style={{ padding: '8px 10px', background: '#ede9fe', border: '1px solid #c4b5fd', borderRadius: 6 }}>
                                        <div style={{ fontSize: 10, fontWeight: 700, color: '#6d28d9', marginBottom: 3 }}>HOOK</div>
                                        <p style={{ fontSize: 12, color: '#4c1d95', lineHeight: 1.6, margin: 0 }}>{c.hook}</p>
                                      </div>
                                    )}

                                    {/* Notes */}
                                    {c.notes && (
                                      <div>
                                        <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 3 }}>Notes</div>
                                        <p style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.6, margin: 0 }}>{c.notes}</p>
                                      </div>
                                    )}

                                    {/* Posts from thesis */}
                                    {c.posts?.length > 0 && (
                                      <div>
                                        <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 6 }}>Recent Posts</div>
                                        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                                          {c.posts.slice(0, 3).map((p, pi) => (
                                            <div key={pi} style={{ padding: '7px 9px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 6, fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.5 }}>
                                              {p.platform && <span style={{ fontWeight: 700, color: p.platform === 'linkedin' ? '#1d4ed8' : '#374151', marginRight: 6 }}>{p.platform}</span>}
                                              {p.headline || p.text || p}
                                            </div>
                                          ))}
                                        </div>
                                      </div>
                                    )}
                                  </>
                                )}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })()}

            </>
          )}
        </div>
      </div>
    </div>

    {/* Transcript importer */}
    {showTranscriptImporter && (
      <TranscriptImporter
        dealId={deal.id}
        owners={OWNERS}
        initialTranscript={initialTranscript}
        onImported={({ meeting }) => {
          setMeetings(prev => [meeting, ...prev]);
          setShowTranscriptImporter(false);
          setInitialTranscript('');
        }}
        onClose={() => { setShowTranscriptImporter(false); setInitialTranscript(''); }}
      />
    )}

    {/* Proposal draft */}
    {showProposalDraft && (
      <DealProposalDraft
        deal={deal}
        meetings={meetings}
        onConfirm={(payload) => {
          setShowProposalDraft(false);
          onDraftProposal?.({ ...payload, deal });
        }}
        onClose={() => setShowProposalDraft(false)}
      />
    )}

    {/* ── Compose Email overlay ── */}
    {composeEmail && (
      <div
        style={{ position: 'fixed', inset: 0, zIndex: 500, display: 'flex', alignItems: 'flex-end', justifyContent: 'flex-end', pointerEvents: 'none' }}
      >
        <div style={{
          pointerEvents: 'all',
          width: 460, maxWidth: '96vw',
          background: 'var(--bg)',
          border: '1px solid var(--border)',
          borderRadius: '12px 12px 0 0',
          boxShadow: '0 -8px 40px rgba(0,0,0,0.18)',
          marginRight: 24,
          display: 'flex', flexDirection: 'column',
        }}>
          {/* Compose header */}
          <div style={{ padding: '12px 16px', background: '#1e293b', borderRadius: '12px 12px 0 0', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: '#f1f5f9' }}>✉️ New Email</span>
            <button onClick={() => setComposeEmail(null)} style={{ background: 'none', border: 'none', color: '#94a3b8', fontSize: 18, cursor: 'pointer', lineHeight: 1 }}>×</button>
          </div>

          <div style={{ padding: '0 0 4px', borderBottom: '1px solid var(--border)' }}>
            {/* To */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 14px', borderBottom: '1px solid var(--border)' }}>
              <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', width: 44, flexShrink: 0 }}>To</span>
              <span style={{ fontSize: 13, color: 'var(--text)', fontWeight: 500 }}>
                {composeEmail.toName ? `${composeEmail.toName} <${composeEmail.to}>` : composeEmail.to}
              </span>
            </div>
            {/* Subject */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 14px' }}>
              <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', width: 44, flexShrink: 0 }}>Subject</label>
              <input
                autoFocus
                type="text"
                value={composeDraft.subject}
                onChange={e => setComposeDraft(d => ({ ...d, subject: e.target.value }))}
                placeholder="Subject…"
                style={{ flex: 1, border: 'none', outline: 'none', fontSize: 13, background: 'transparent', color: 'var(--text)' }}
              />
            </div>
          </div>

          {/* Body */}
          <textarea
            value={composeDraft.body}
            onChange={e => setComposeDraft(d => ({ ...d, body: e.target.value }))}
            placeholder={`Hi ${composeEmail.toName?.split(' ')[0] || 'there'},\n\n`}
            style={{
              flex: 1, border: 'none', outline: 'none', resize: 'none',
              padding: '12px 14px', fontSize: 13, lineHeight: 1.6,
              background: 'transparent', color: 'var(--text)', minHeight: 180, fontFamily: 'inherit',
            }}
          />

          {/* Footer */}
          <div style={{ padding: '10px 14px', borderTop: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: 11, color: 'var(--text-faint)' }}>
              {deal.id && composeDraft.subject ? '✓ Will log as email activity' : 'Add a subject to log as activity'}
            </span>
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                onClick={() => setComposeEmail(null)}
                style={{ fontSize: 12, fontWeight: 600, padding: '6px 14px', borderRadius: 7, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text-muted)', cursor: 'pointer' }}
              >
                Discard
              </button>
              <button
                onClick={sendEmail}
                disabled={loggingEmail}
                style={{ fontSize: 12, fontWeight: 700, padding: '6px 16px', borderRadius: 7, border: 'none', background: 'var(--accent)', color: '#fff', cursor: loggingEmail ? 'not-allowed' : 'pointer', opacity: loggingEmail ? 0.7 : 1 }}
              >
                {loggingEmail ? 'Sending…' : 'Send ↗'}
              </button>
            </div>
          </div>
        </div>
      </div>
    )}
    </>
  );
}
