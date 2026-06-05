import { useState, useEffect, useRef } from 'react';
import {
  upsertDeal, deleteDeal,
  fetchActivities, addActivity, deleteActivity,
  fetchTasks, addTask, completeTask, deleteTask,
  STAGES, ACTIVITY_TYPES, OWNERS, stageColor, stageLabel, fmt$, daysSince,
} from '../lib/deals';
import { fetchDealMeetings, deleteProjectMeeting } from '../lib/projects';
import { fetchCompanyIntel, runBuildThesis, findOrCreateCompany } from '../lib/clients';
import { loadIcp } from '../lib/settings';
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
  const [tab, setTab]             = useState('activities');
  const [meetings, setMeetings]   = useState([]);
  const [showTranscript, setShowTranscript] = useState(null);
  const [showTranscriptImporter, setShowTranscriptImporter] = useState(false);
  const [showProposalDraft, setShowProposalDraft] = useState(false);

  // Research tab state
  const [companyIntel, setCompanyIntel]   = useState(null);
  const [intelLoading, setIntelLoading]   = useState(false);
  const [buildingThesis, setBuildingThesis] = useState(false);
  const [thesisPhases, setThesisPhases]   = useState([]);
  const [thesisLog, setThesisLog]         = useState([]);
  const [thesisError, setThesisError]     = useState(null);
  const thesisLogEndRef                   = useRef(null);
  const intelFetchedRef                   = useRef(false); // prevents double-fetch on tab switch

  // Notes state (for quick save from Meetings tab)
  const [savingNotes, setSavingNotes]     = useState(false);

  const isNew = !initialDeal.id;

  useEffect(() => {
    if (!isNew) {
      fetchActivities(initialDeal.id).then(setActivities).catch(console.error);
      fetchTasks(initialDeal.id).then(setTasks).catch(console.error);
      fetchDealMeetings(initialDeal.id).then(setMeetings).catch(console.error);
    }
  }, [initialDeal.id, isNew]);

  // Load company intel once when research tab first opens
  useEffect(() => {
    if (tab === 'research' && deal.company_name && !intelFetchedRef.current && !intelLoading) {
      intelFetchedRef.current = true;
      setIntelLoading(true);
      fetchCompanyIntel(deal.company_name)
        .then(intel => { setCompanyIntel(intel); setIntelLoading(false); })
        .catch(() => setIntelLoading(false));
    }
  }, [tab]);

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

  const handleBuildThesis = async () => {
    if (buildingThesis) return;
    setBuildingThesis(true);
    setThesisLog([]);
    setThesisPhases([]);
    setThesisError(null);

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

      // Always set state from result so thesis is visible even if DB save failed
      setCompanyIntel(result);
      // Re-fetch to confirm DB save; if it comes back empty the migration hasn't been run
      fetchCompanyIntel(deal.company_name).then(saved => {
        if (saved?.thesis) setCompanyIntel(saved);
        else addLog('⚠ Thesis built but not persisted — run the companies table migration in Supabase');
      }).catch(() => {});
      addLog('✓ Thesis complete');
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
        <div style={{ padding: '20px 24px 16px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'flex-start', gap: 12 }}>
          <div style={{ flex: 1 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
              <span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: '50%', background: stageColor(deal.stage), flexShrink: 0 }} />
              <span style={{ fontSize: 11, fontWeight: 700, color: stageColor(deal.stage), textTransform: 'uppercase', letterSpacing: '.04em' }}>{stageLabel(deal.stage)}</span>
              {!isNew && <span style={{ fontSize: 11, color: 'var(--text-faint)', marginLeft: 4 }}>{daysSince(deal.stage_entered_at)}d in stage</span>}
            </div>
            <h3 style={{ fontSize: 18, fontWeight: 800, margin: 0 }}>{deal.company_name || 'New Deal'}</h3>
            {deal.contact_name && <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: '2px 0 0' }}>{deal.contact_name}{deal.contact_email ? ` · ${deal.contact_email}` : ''}</p>}
          </div>
          <button style={{ background: 'none', border: 'none', fontSize: 20, cursor: 'pointer', color: 'var(--text-muted)', padding: '0 4px', lineHeight: 1 }} onClick={onClose}>✕</button>
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '20px 24px' }}>

          {/* Core fields */}
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
              <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '.04em', display: 'block', marginBottom: 4 }}>Retainer Value <span style={{ fontWeight: 400, textTransform: 'none' }}>($/mo)</span></label>
              <input type="number" min="0" value={deal.retainer_value || ''} onChange={e => field('retainer_value', e.target.value)} placeholder="0" style={{ width: '100%', fontSize: 13 }} />
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
            <div style={{ gridColumn: '1/-1' }}>
              <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '.04em', display: 'block', marginBottom: 4 }}>Notes</label>
              <textarea rows={3} value={deal.notes || ''} onChange={e => field('notes', e.target.value)} placeholder="Internal context, key decisions, next steps…" style={{ width: '100%', fontSize: 13, lineHeight: 1.6 }} />
            </div>
          </div>

          {/* Save / Delete */}
          <div style={{ display: 'flex', gap: 8, marginBottom: 24 }}>
            <button className="btn btn-primary" onClick={save} disabled={saving} style={{ flex: 1 }}>
              {saving ? 'Saving…' : isNew ? 'Create Deal' : 'Save Changes'}
            </button>
            {!isNew && (
              <button className="btn btn-danger" onClick={handleDelete} disabled={deleting} style={{ flexShrink: 0 }}>
                {deleting ? '…' : '🗑'}
              </button>
            )}
          </div>

          {/* Tabs */}
          {!isNew && (
            <>
              {overdueTasks.length > 0 && (
                <div style={{ background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: 6, padding: '8px 12px', marginBottom: 12, fontSize: 12, color: '#b91c1c', fontWeight: 600 }}>
                  ⚠️ {overdueTasks.length} overdue task{overdueTasks.length > 1 ? 's' : ''}
                </div>
              )}

              <div style={{ display: 'flex', gap: 0, borderBottom: '2px solid var(--border)', marginBottom: 16 }}>
                {[
                  { id: 'activities', label: 'Activities' },
                  { id: 'tasks',      label: openTasks.length > 0 ? `Tasks (${openTasks.length})` : 'Tasks' },
                  { id: 'meetings',   label: meetings.length > 0 ? `Meetings (${meetings.length})` : 'Meetings' },
                  { id: 'research',   label: companyIntel?.thesis_built ? '🔬 Research ✓' : '🔬 Research' },
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
                      <div key={a.id} style={{ display: 'flex', gap: 10, padding: '10px 12px', background: 'var(--surface)', borderRadius: 6, border: '1px solid var(--border)' }}>
                        <span style={{ fontSize: 16, flexShrink: 0, marginTop: 1 }}>{ACTIVITY_ICONS[a.type] || '📝'}</span>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 2 }}>
                            <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'capitalize' }}>{a.type}</span>
                            <span style={{ fontSize: 11, color: 'var(--text-faint)' }}>{a.activity_date}</span>
                            {a.assigned_to && <span style={{ fontSize: 10, fontWeight: 700, padding: '1px 6px', borderRadius: 3, background: a.assigned_to === 'Mike' ? '#f3e8ff' : '#eff6ff', color: a.assigned_to === 'Mike' ? '#7c3aed' : '#1d4ed8' }}>{a.assigned_to}</span>}
                          </div>
                          <p style={{ fontSize: 12, color: 'var(--text)', margin: 0, lineHeight: 1.5 }}>{a.summary}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* ── Tasks ── */}
              {tab === 'tasks' && (
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                    <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '.04em' }}>Tasks</span>
                    <button className="btn btn-secondary btn-xs" onClick={() => setAddingTask(a => !a)}>+ Add Task</button>
                  </div>

                  {addingTask && (
                    <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, padding: 12, marginBottom: 12 }}>
                      <input type="text" placeholder="Task title…" value={taskForm.title} onChange={e => setTaskForm(f => ({ ...f, title: e.target.value }))} style={{ width: '100%', fontSize: 12, marginBottom: 8 }} />
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

                  {tasks.length === 0 && !addingTask && (
                    <p style={{ fontSize: 12, color: 'var(--text-faint)', textAlign: 'center', padding: '16px 0' }}>No tasks yet.</p>
                  )}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {tasks.map(t => {
                      const overdue = !t.completed && t.due_date && new Date(t.due_date) < new Date();
                      return (
                        <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', background: t.completed ? 'var(--surface)' : overdue ? '#fef2f2' : 'var(--surface)', borderRadius: 6, border: `1px solid ${overdue && !t.completed ? '#fca5a5' : 'var(--border)'}`, opacity: t.completed ? 0.6 : 1 }}>
                          <input type="checkbox" checked={t.completed} onChange={() => toggleTask(t)} style={{ cursor: 'pointer', flexShrink: 0 }} />
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <span style={{ fontSize: 13, textDecoration: t.completed ? 'line-through' : 'none', color: t.completed ? 'var(--text-muted)' : 'var(--text)' }}>{t.title}</span>
                            <div style={{ display: 'flex', gap: 6, marginTop: 2, alignItems: 'center' }}>
                              {t.due_date && <span style={{ fontSize: 11, color: overdue && !t.completed ? '#b91c1c' : 'var(--text-faint)', fontWeight: overdue && !t.completed ? 700 : 400 }}>{overdue && !t.completed ? '⚠ ' : ''}{t.due_date}</span>}
                              {t.assigned_to && <span style={{ fontSize: 10, fontWeight: 700, padding: '1px 6px', borderRadius: 3, background: t.assigned_to === 'Mike' ? '#f3e8ff' : '#eff6ff', color: t.assigned_to === 'Mike' ? '#7c3aed' : '#1d4ed8' }}>{t.assigned_to}</span>}
                            </div>
                          </div>
                          <button onClick={() => removeTask(t.id)} style={{ background: 'none', border: 'none', color: 'var(--text-faint)', cursor: 'pointer', fontSize: 14, flexShrink: 0, padding: '0 2px' }}>×</button>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* ── Meetings ── */}
              {tab === 'meetings' && (
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                    <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '.04em' }}>Meeting Log</span>
                    <div style={{ display: 'flex', gap: 8 }}>
                      {meetings.length > 0 && (
                        <button className="btn btn-primary btn-xs" onClick={() => setShowProposalDraft(true)}>✦ Draft Proposal</button>
                      )}
                      <button className="btn btn-secondary btn-xs" onClick={() => setShowTranscriptImporter(true)}>+ Add Meeting</button>
                    </div>
                  </div>

                  {meetings.length === 0 && (
                    <div style={{ textAlign: 'center', padding: '24px 0' }}>
                      <p style={{ fontSize: 12, color: 'var(--text-faint)', marginBottom: 10 }}>No meetings logged yet.</p>
                      <button className="btn btn-secondary btn-sm" onClick={() => setShowTranscriptImporter(true)}>📝 Add first meeting</button>
                    </div>
                  )}

                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    {meetings.map(mtg => (
                      <div key={mtg.id} style={{ padding: '12px 14px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8 }}>
                        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginBottom: mtg.summary ? 6 : 0 }}>
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
                          ? '↺ Rebuild Thesis'
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
                        🔬 Build Thesis
                      </button>
                    </div>
                  )}
                </div>
              )}
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
        onImported={({ meeting }) => {
          setMeetings(prev => [meeting, ...prev]);
          setShowTranscriptImporter(false);
        }}
        onClose={() => setShowTranscriptImporter(false)}
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
    </>
  );
}
