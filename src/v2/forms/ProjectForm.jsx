import { useState } from 'react';
import { upsertProject } from '../write-data.js';

/* Project create / edit form. Submits via upsertProject which
   handles both insert and update based on presence of id. */

const STATUSES = [
    { id: 'active',    label: 'Active' },
    { id: 'on_hold',   label: 'On hold' },
    { id: 'completed', label: 'Completed' },
    { id: 'cancelled', label: 'Cancelled' },
];

export default function ProjectForm({ initial = null, onSaved, onCancel }) {
    const [name,        setName]        = useState(initial?.name        || '');
    const [clientName,  setClientName]  = useState(initial?.client_name  || '');
    const [contactName, setContactName] = useState(initial?.contact_name || '');
    const [status,      setStatus]      = useState(initial?.status      || 'active');
    const [startDate,   setStartDate]   = useState(initial?.start_date  || new Date().toISOString().slice(0, 10));
    const [endDate,     setEndDate]     = useState(initial?.end_date    || '');
    const [saving, setSaving] = useState(false);
    const [error,  setError]  = useState(null);

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (!name.trim()) {
            setError('Project name is required');
            return;
        }
        setError(null);
        setSaving(true);
        try {
            const saved = await upsertProject({
                id: initial?.id,
                name: name.trim(),
                client_name: clientName.trim() || null,
                contact_name: contactName.trim() || null,
                status,
                start_date: startDate || null,
                end_date:   endDate   || null,
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
                <label className="v2-form__label">Project name</label>
                <input
                    className="v2-form__input"
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="e.g. Brand refresh"
                    autoFocus
                />
            </div>

            <div className="v2-form__row">
                <div className="v2-form__field">
                    <label className="v2-form__label">Client</label>
                    <input
                        className="v2-form__input"
                        type="text"
                        value={clientName}
                        onChange={(e) => setClientName(e.target.value)}
                        placeholder="Company name"
                    />
                </div>
                <div className="v2-form__field">
                    <label className="v2-form__label">Contact</label>
                    <input
                        className="v2-form__input"
                        type="text"
                        value={contactName}
                        onChange={(e) => setContactName(e.target.value)}
                        placeholder="Primary contact"
                    />
                </div>
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
                        value={endDate}
                        onChange={(e) => setEndDate(e.target.value)}
                    />
                </div>
            </div>

            <div className="v2-form__footer">
                <button type="button" className="v2-btn-link" onClick={onCancel}>Cancel</button>
                <button type="submit" className="v2-btn v2-btn--primary" disabled={saving}>
                    {saving ? 'Saving…' : (initial?.id ? 'Save changes' : 'Create project')}
                </button>
            </div>
        </form>
    );
}
