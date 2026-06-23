import { useState } from 'react';
import { generateProposalFromMeetings, buildTimelineFromParsed, addDays } from '../lib/projects';

const today = new Date().toISOString().slice(0, 10);

/**
 * DealProposalDraft
 * Generates a structured editable proposal plan from deal meeting transcripts.
 *
 * Props:
 *   deal         — deal object { id, company_name, ... }
 *   meetings     — array of meeting records with transcripts
 *   onConfirm    — fn(parsed) called with the editable plan — caller handles project creation
 *   onClose      — fn()
 */
export default function DealProposalDraft({ deal, meetings, onConfirm, onClose }) {
  const [step, setStep]       = useState('generating'); // generating | edit | confirming
  const [error, setError]     = useState('');
  const [parsed, setParsed]   = useState(null);
  const [startDate, setStartDate] = useState(today);

  // Milestones in editable form
  const [milestones, setMilestones] = useState([]);

  // Generate on mount
  useState(() => {
    generate();
  });

  async function generate() {
    setStep('generating');
    setError('');
    try {
      const result = await generateProposalFromMeetings(meetings, deal.company_name, startDate);
      setParsed(result);
      // Build editable milestones with tasks
      let cursor = startDate;
      const ms = (result.milestones || []).map((m, mi) => {
        const msStart = cursor;
        const msEnd   = addDays(cursor, m.duration_days || 14);
        cursor = msEnd;
        return {
          _id:          `ms-${mi}`,
          title:        m.title        || `Phase ${mi + 1}`,
          description:  m.description  || '',
          start_date:   msStart,
          due_date:     msEnd,
          duration_days: m.duration_days || 14,
          tasks: (m.tasks || []).map((t, ti) => ({
            _id:           `t-${mi}-${ti}`,
            title:         t.title        || 'Task',
            duration_days: t.duration_days || 3,
            assigned_to:   t.assigned_to   || '',
          })),
        };
      });
      setMilestones(ms);
      setStep('edit');
    } catch (e) {
      setError(e.message || 'Failed to generate proposal');
      setStep('edit');
    }
  }

  const updateMs = (id, patch) => setMilestones(prev => prev.map(m => m._id === id ? { ...m, ...patch } : m));
  const updateTask = (msId, tId, patch) => setMilestones(prev => prev.map(m =>
    m._id === msId ? { ...m, tasks: m.tasks.map(t => t._id === tId ? { ...t, ...patch } : t) } : m
  ));
  const removeTask = (msId, tId) => setMilestones(prev => prev.map(m =>
    m._id === msId ? { ...m, tasks: m.tasks.filter(t => t._id !== tId) } : m
  ));
  const addTask = (msId) => setMilestones(prev => prev.map(m =>
    m._id === msId ? { ...m, tasks: [...m.tasks, { _id: `t-${Date.now()}`, title: '', duration_days: 3, assigned_to: '' }] } : m
  ));
  const removeMs = (id) => setMilestones(prev => prev.filter(m => m._id !== id));
  const addMs = () => setMilestones(prev => {
    const last = prev[prev.length - 1];
    const start = last ? addDays(last.due_date, 1) : startDate;
    const end   = addDays(start, 14);
    return [...prev, { _id: `ms-${Date.now()}`, title: '', description: '', start_date: start, due_date: end, duration_days: 14, tasks: [] }];
  });

  const handleConfirm = () => {
    // Rebuild parsed structure from edited milestones
    const editedParsed = {
      ...parsed,
      milestones: milestones.map(m => ({
        title:         m.title,
        description:   m.description,
        duration_days: m.duration_days,
        assigned_to:   '',
        tasks: m.tasks.map(t => ({
          title:         t.title,
          duration_days: t.duration_days,
          assigned_to:   t.assigned_to,
        })),
      })),
    };
    onConfirm({ parsed: editedParsed, startDate });
  };

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.45)' }} onClick={step === 'generating' ? undefined : onClose} />
      <div style={{ position: 'relative', zIndex: 1, background: 'var(--bg)', borderRadius: 14, padding: '28px 28px 24px', width: 680, maxWidth: '96vw', maxHeight: '92vh', display: 'flex', flexDirection: 'column', boxShadow: '0 24px 64px rgba(0,0,0,0.26)' }}>

        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20, flexShrink: 0 }}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 800, color: 'var(--text)' }}>📋 Draft Proposal — {deal.company_name}</div>
            <div style={{ fontSize: 12, color: 'var(--text-faint)', marginTop: 3 }}>
              {step === 'generating' && `Synthesizing ${meetings.length} meeting${meetings.length !== 1 ? 's' : ''}…`}
              {step === 'edit'       && 'Review and edit the proposed plan before creating a project'}
            </div>
          </div>
          {step !== 'generating' && (
            <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 18, cursor: 'pointer', color: 'var(--text-muted)', padding: '2px 4px', flexShrink: 0 }}>✕</button>
          )}
        </div>

        {/* Generating spinner */}
        {step === 'generating' && (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 16, padding: '40px 0' }}>
            <span style={{ display: 'inline-block', width: 32, height: 32, border: '3px solid var(--accent)', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 0.7s linear infinite' }} />
            <div style={{ fontSize: 13, color: 'var(--text-faint)' }}>Reading meeting transcripts and generating plan…</div>
          </div>
        )}

        {/* Edit step */}
        {step === 'edit' && (
          <>
            {error && (
              <div style={{ fontSize: 12, color: '#ef4444', padding: '8px 12px', background: '#fef2f2', borderRadius: 6, border: '1px solid #fecaca', marginBottom: 14, flexShrink: 0 }}>{error}</div>
            )}

            {/* Project name + start date */}
            {parsed && (
              <div style={{ display: 'flex', gap: 12, marginBottom: 16, flexShrink: 0, alignItems: 'flex-end' }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 4 }}>Project Name</div>
                  <input
                    value={parsed.project_name || ''}
                    onChange={e => setParsed(p => ({ ...p, project_name: e.target.value }))}
                    style={{ width: '100%', fontSize: 14, fontWeight: 700, padding: '6px 10px' }}
                  />
                </div>
                <div>
                  <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 4 }}>Start Date</div>
                  <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} style={{ fontSize: 13, padding: '6px 8px' }} />
                </div>
                <button
                  onClick={generate}
                  style={{ fontSize: 11, fontWeight: 700, padding: '6px 12px', borderRadius: 7, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text-muted)', cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0 }}
                >↺ Regenerate</button>
              </div>
            )}

            {/* Milestones */}
            <div style={{ flex: 1, overflowY: 'auto', minHeight: 0, display: 'flex', flexDirection: 'column', gap: 12 }}>
              {milestones.map((ms, mi) => (
                <div key={ms._id} style={{ border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden' }}>
                  {/* Milestone header */}
                  <div style={{ display: 'flex', gap: 10, padding: '12px 14px', background: 'var(--surface)', alignItems: 'center' }}>
                    <div style={{ width: 20, height: 20, borderRadius: '50%', background: 'var(--accent)', color: '#fff', fontSize: 11, fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>{mi + 1}</div>
                    <input
                      value={ms.title}
                      onChange={e => updateMs(ms._id, { title: e.target.value })}
                      placeholder="Phase name"
                      style={{ flex: 1, fontSize: 13, fontWeight: 700, background: 'none', border: 'none', outline: 'none', color: 'var(--text)', padding: 0 }}
                    />
                    <input
                      type="date"
                      value={ms.start_date}
                      onChange={e => updateMs(ms._id, { start_date: e.target.value })}
                      style={{ fontSize: 11, padding: '3px 6px', borderRadius: 5, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text-muted)', flexShrink: 0 }}
                    />
                    <span style={{ fontSize: 11, color: 'var(--text-faint)', flexShrink: 0 }}>→</span>
                    <input
                      type="date"
                      value={ms.due_date}
                      onChange={e => updateMs(ms._id, { due_date: e.target.value })}
                      style={{ fontSize: 11, padding: '3px 6px', borderRadius: 5, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text-muted)', flexShrink: 0 }}
                    />
                    <button onClick={() => removeMs(ms._id)} style={{ background: 'none', border: 'none', color: 'var(--text-faint)', cursor: 'pointer', fontSize: 14, padding: '2px 4px', flexShrink: 0 }}>🗑</button>
                  </div>

                  {/* Tasks */}
                  <div style={{ padding: '8px 14px 10px 14px', display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {ms.tasks.map(t => (
                      <div key={t._id} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                        <span style={{ fontSize: 11, color: 'var(--text-faint)', flexShrink: 0 }}>·</span>
                        <input
                          value={t.title}
                          onChange={e => updateTask(ms._id, t._id, { title: e.target.value })}
                          placeholder="Task title"
                          style={{ flex: 1, fontSize: 12, background: 'none', border: 'none', outline: 'none', borderBottom: '1px solid var(--border-light)', padding: '3px 0', color: 'var(--text)' }}
                        />
                        <input
                          type="number"
                          value={t.duration_days}
                          onChange={e => updateTask(ms._id, t._id, { duration_days: parseInt(e.target.value) || 1 })}
                          min={1}
                          style={{ width: 44, fontSize: 11, padding: '3px 6px', borderRadius: 5, border: '1px solid var(--border)', background: 'var(--bg)', textAlign: 'center', flexShrink: 0 }}
                          title="Duration (days)"
                        />
                        <span style={{ fontSize: 10, color: 'var(--text-faint)', flexShrink: 0 }}>d</span>
                        <button onClick={() => removeTask(ms._id, t._id)} style={{ background: 'none', border: 'none', color: 'var(--text-faint)', cursor: 'pointer', fontSize: 13, padding: '1px 3px', flexShrink: 0 }}>×</button>
                      </div>
                    ))}
                    <button
                      onClick={() => addTask(ms._id)}
                      style={{ alignSelf: 'flex-start', marginTop: 4, fontSize: 11, color: 'var(--text-faint)', background: 'none', border: 'none', cursor: 'pointer', padding: '2px 0', marginLeft: 14 }}
                    >+ Add task</button>
                  </div>
                </div>
              ))}

              <button
                onClick={addMs}
                style={{ padding: '10px', border: '2px dashed var(--border)', borderRadius: 10, background: 'none', cursor: 'pointer', fontSize: 12, color: 'var(--text-faint)', transition: 'border-color .15s' }}
                onMouseEnter={e => e.currentTarget.style.borderColor = 'var(--accent)'}
                onMouseLeave={e => e.currentTarget.style.borderColor = 'var(--border)'}
              >+ Add Phase</button>
            </div>

            {/* Footer */}
            <div style={{ display: 'flex', gap: 10, marginTop: 20, justifyContent: 'flex-end', flexShrink: 0, borderTop: '1px solid var(--border-light)', paddingTop: 16 }}>
              <button onClick={onClose} style={{ padding: '9px 16px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>Cancel</button>
              <button
                onClick={handleConfirm}
                disabled={milestones.length === 0}
                style={{ padding: '9px 22px', borderRadius: 8, border: 'none', background: 'var(--accent)', color: '#fff', fontSize: 13, fontWeight: 700, cursor: milestones.length > 0 ? 'pointer' : 'default', opacity: milestones.length > 0 ? 1 : 0.5 }}
              >Create Project →</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
