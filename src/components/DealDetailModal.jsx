import { useState, useEffect } from 'react';
import {
  upsertDeal, deleteDeal,
  fetchActivities, addActivity, deleteActivity,
  fetchTasks, addTask, completeTask, deleteTask,
  STAGES, ACTIVITY_TYPES, OWNERS, stageColor, stageLabel, fmt$, daysSince,
} from '../lib/deals';

const ACTIVITY_ICONS = { email:'✉️', call:'📞', meeting:'🤝', note:'📝', proposal:'📄', contract:'✍️' };

export default function DealDetailModal({ deal: initialDeal, onClose, onSaved }) {
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

  const isNew = !initialDeal.id;

  useEffect(() => {
    if (!isNew) {
      fetchActivities(initialDeal.id).then(setActivities).catch(console.error);
      fetchTasks(initialDeal.id).then(setTasks).catch(console.error);
    }
  }, [initialDeal.id, isNew]);

  const field = (key, val) => setDeal(d => ({ ...d, [key]: val }));

  const save = async () => {
    if (!deal.company_name?.trim()) return alert('Company name is required.');
    setSaving(true);
    try {
      const saved = await upsertDeal(deal);
      onSaved(saved);
      if (isNew) onClose();
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

  const openTasks = tasks.filter(t => !t.completed);
  const overdueTasks = openTasks.filter(t => t.due_date && new Date(t.due_date) < new Date());

  return (
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
              <select value={deal.stage || 'prospect'} onChange={e => field('stage', e.target.value)} style={{ width: '100%', fontSize: 13 }}>
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

          {/* Activities + Tasks tabs */}
          {!isNew && (
            <>
              {overdueTasks.length > 0 && (
                <div style={{ background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: 6, padding: '8px 12px', marginBottom: 12, fontSize: 12, color: '#b91c1c', fontWeight: 600 }}>
                  ⚠️ {overdueTasks.length} overdue task{overdueTasks.length > 1 ? 's' : ''}
                </div>
              )}

              <div style={{ display: 'flex', gap: 0, borderBottom: '2px solid var(--border)', marginBottom: 16 }}>
                {['activities','tasks'].map(t => (
                  <button key={t} onClick={() => setTab(t)} style={{ padding: '8px 16px', fontSize: 12, fontWeight: 700, background: 'none', border: 'none', borderBottom: tab === t ? '2px solid var(--accent)' : '2px solid transparent', marginBottom: -2, cursor: 'pointer', color: tab === t ? 'var(--accent)' : 'var(--text-muted)', textTransform: 'capitalize' }}>
                    {t}{t === 'tasks' && openTasks.length > 0 ? ` (${openTasks.length})` : ''}
                  </button>
                ))}
              </div>

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
                        <button onClick={() => removeActivity(a.id)} style={{ background: 'none', border: 'none', color: 'var(--text-faint)', cursor: 'pointer', fontSize: 14, flexShrink: 0, padding: '0 2px' }}>×</button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

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
            </>
          )}
        </div>
      </div>
    </div>
  );
}
