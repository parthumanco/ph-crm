import { useState } from 'react';
import { upsertProjectTask } from '../write-data.js';

export default function TaskForm({ projectId, milestoneId, initial = null, nextOrder = 1, onSaved, onCancel }) {
    const [title,      setTitle]      = useState(initial?.title       || '');
    const [dueDate,    setDueDate]    = useState(initial?.due_date    || '');
    const [assignedTo, setAssignedTo] = useState(initial?.assigned_to || '');
    const [completed,  setCompleted]  = useState(initial?.completed   || false);
    const [saving, setSaving] = useState(false);
    const [error,  setError]  = useState(null);

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (!title.trim()) { setError('Task title is required'); return; }
        setError(null);
        setSaving(true);
        try {
            const saved = await upsertProjectTask({
                id: initial?.id,
                project_id: projectId,
                milestone_id: milestoneId,
                title: title.trim(),
                due_date:   dueDate    || null,
                assigned_to: assignedTo.trim() || null,
                completed,
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
                <label className="v2-form__label">Task</label>
                <input
                    className="v2-form__input"
                    type="text"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="What needs to happen?"
                    autoFocus
                />
            </div>

            <div className="v2-form__row">
                <div className="v2-form__field">
                    <label className="v2-form__label">Due date</label>
                    <input
                        className="v2-form__input"
                        type="date"
                        value={dueDate}
                        onChange={(e) => setDueDate(e.target.value)}
                    />
                </div>
                <div className="v2-form__field">
                    <label className="v2-form__label">Assigned to</label>
                    <input
                        className="v2-form__input"
                        type="text"
                        value={assignedTo}
                        onChange={(e) => setAssignedTo(e.target.value)}
                        placeholder="Name or initials"
                    />
                </div>
            </div>

            {initial?.id && (
                <div className="v2-form__field v2-form__field--inline">
                    <label className="v2-form__check">
                        <input
                            type="checkbox"
                            checked={completed}
                            onChange={(e) => setCompleted(e.target.checked)}
                        />
                        <span>Mark as complete</span>
                    </label>
                </div>
            )}

            <div className="v2-form__footer">
                <button type="button" className="v2-btn-link" onClick={onCancel}>Cancel</button>
                <button type="submit" className="v2-btn v2-btn--primary" disabled={saving}>
                    {saving ? 'Saving…' : (initial?.id ? 'Save changes' : 'Add task')}
                </button>
            </div>
        </form>
    );
}
