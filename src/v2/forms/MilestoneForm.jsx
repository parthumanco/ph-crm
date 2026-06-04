import { useState } from 'react';
import { upsertMilestone } from '../write-data.js';

const STATUSES = [
    { id: 'not_started', label: 'Not started' },
    { id: 'in_progress', label: 'In progress' },
    { id: 'completed',   label: 'Completed' },
    { id: 'blocked',     label: 'Blocked' },
];

export default function MilestoneForm({ projectId, initial = null, nextOrder = 1, onSaved, onCancel }) {
    const [name,      setName]      = useState(initial?.name      || '');
    const [status,    setStatus]    = useState(initial?.status    || 'not_started');
    const [startDate, setStartDate] = useState(initial?.start_date || '');
    const [dueDate,   setDueDate]   = useState(initial?.due_date  || '');
    const [saving, setSaving] = useState(false);
    const [error,  setError]  = useState(null);

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (!name.trim()) { setError('Milestone name is required'); return; }
        setError(null);
        setSaving(true);
        try {
            const saved = await upsertMilestone({
                id: initial?.id,
                project_id: projectId,
                name: name.trim(),
                status,
                start_date: startDate || null,
                due_date:   dueDate   || null,
                order_index: initial?.order_index ?? nextOrder,
            });
            onSaved?.(saved);
        } catch (err) {
            setError(err.message || 'Couldn\'t save');
        } finally {
            setSaving(false);
        }
    };

    return (
        <form className="v2-form" onSubmit={handleSubmit}>
            {error && <div className="v2-error">{error}</div>}

            <div className="v2-form__field">
                <label className="v2-form__label">Milestone name</label>
                <input
                    className="v2-form__input"
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="e.g. Discovery phase"
                    autoFocus
                />
            </div>

            <div className="v2-form__row">
                <div className="v2-form__field">
                    <label className="v2-form__label">Status</label>
                    <div className="v2-select-wrap">
                        <select className="v2-select" value={status} onChange={(e) => setStatus(e.target.value)}>
                            {STATUSES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
                        </select>
                        <svg className="v2-select__chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M6 9l6 6 6-6"/></svg>
                    </div>
                </div>
                <div className="v2-form__field">
                    <label className="v2-form__label">Start date</label>
                    <input
                        className="v2-form__input"
                        type="date"
                        value={startDate}
                        onChange={(e) => setStartDate(e.target.value)}
                    />
                </div>
                <div className="v2-form__field">
                    <label className="v2-form__label">Due date</label>
                    <input
                        className="v2-form__input"
                        type="date"
                        value={dueDate}
                        onChange={(e) => setDueDate(e.target.value)}
                    />
                </div>
            </div>

            <div className="v2-form__footer">
                <button type="button" className="v2-btn-link" onClick={onCancel}>Cancel</button>
                <button type="submit" className="v2-btn v2-btn--primary" disabled={saving}>
                    {saving ? 'Saving…' : (initial?.id ? 'Save changes' : 'Add milestone')}
                </button>
            </div>
        </form>
    );
}
