import { useState } from 'react';
import { upsertDeal } from '../write-data.js';
import { DEAL_STAGES, DEAL_OWNERS } from '../safe-data.js';

export default function DealForm({ initial = null, onSaved, onCancel }) {
    const [companyName,   setCompanyName]   = useState(initial?.company_name   || '');
    const [title,         setTitle]         = useState(initial?.title         || '');
    const [contactName,   setContactName]   = useState(initial?.contact_name   || '');
    const [contactEmail,  setContactEmail]  = useState(initial?.contact_email  || '');
    const [stage,         setStage]         = useState(initial?.stage         || 'prospect');
    const [retainerValue, setRetainerValue] = useState(initial?.retainer_value ?? '');
    const [projectValue,  setProjectValue]  = useState(initial?.project_value  ?? '');
    const [assignedTo,    setAssignedTo]    = useState(initial?.assigned_to    || DEAL_OWNERS[0] || '');
    const [notes,         setNotes]         = useState(initial?.notes         || '');
    const [saving, setSaving] = useState(false);
    const [error,  setError]  = useState(null);

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (!companyName.trim()) { setError('Company name is required'); return; }
        setError(null);
        setSaving(true);
        try {
            const saved = await upsertDeal({
                id: initial?.id,
                company_name: companyName.trim(),
                title: title.trim() || null,
                contact_name: contactName.trim() || null,
                contact_email: contactEmail.trim() || null,
                stage,
                retainer_value: retainerValue,
                project_value: projectValue,
                assigned_to: assignedTo || null,
                notes: notes.trim() || null,
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

            <div className="v2-form__row">
                <div className="v2-form__field">
                    <label className="v2-form__label">Company</label>
                    <input
                        className="v2-form__input"
                        type="text"
                        value={companyName}
                        onChange={(e) => setCompanyName(e.target.value)}
                        placeholder="Who is this for?"
                        autoFocus
                    />
                </div>
                <div className="v2-form__field">
                    <label className="v2-form__label">Deal title</label>
                    <input
                        className="v2-form__input"
                        type="text"
                        value={title}
                        onChange={(e) => setTitle(e.target.value)}
                        placeholder="e.g. Q3 brand refresh"
                    />
                </div>
            </div>

            <div className="v2-form__row">
                <div className="v2-form__field">
                    <label className="v2-form__label">Contact name</label>
                    <input
                        className="v2-form__input"
                        type="text"
                        value={contactName}
                        onChange={(e) => setContactName(e.target.value)}
                        placeholder="Person you're talking to"
                    />
                </div>
                <div className="v2-form__field">
                    <label className="v2-form__label">Contact email</label>
                    <input
                        className="v2-form__input"
                        type="email"
                        value={contactEmail}
                        onChange={(e) => setContactEmail(e.target.value)}
                        placeholder="name@company.com"
                    />
                </div>
            </div>

            <div className="v2-form__row">
                <div className="v2-form__field">
                    <label className="v2-form__label">Stage</label>
                    <div className="v2-select-wrap">
                        <select className="v2-select" value={stage} onChange={(e) => setStage(e.target.value)}>
                            {DEAL_STAGES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
                        </select>
                        <svg className="v2-select__chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M6 9l6 6 6-6"/></svg>
                    </div>
                </div>
                <div className="v2-form__field">
                    <label className="v2-form__label">Assigned to</label>
                    <div className="v2-select-wrap">
                        <select className="v2-select" value={assignedTo} onChange={(e) => setAssignedTo(e.target.value)}>
                            {DEAL_OWNERS.map((o) => <option key={o} value={o}>{o}</option>)}
                        </select>
                        <svg className="v2-select__chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M6 9l6 6 6-6"/></svg>
                    </div>
                </div>
            </div>

            <div className="v2-form__row">
                <div className="v2-form__field">
                    <label className="v2-form__label">Retainer (per month, $)</label>
                    <input
                        className="v2-form__input"
                        type="number"
                        min="0"
                        step="100"
                        value={retainerValue}
                        onChange={(e) => setRetainerValue(e.target.value)}
                        placeholder="e.g. 5000"
                    />
                </div>
                <div className="v2-form__field">
                    <label className="v2-form__label">One-time project value ($)</label>
                    <input
                        className="v2-form__input"
                        type="number"
                        min="0"
                        step="100"
                        value={projectValue}
                        onChange={(e) => setProjectValue(e.target.value)}
                        placeholder="e.g. 25000"
                    />
                </div>
            </div>

            <div className="v2-form__field">
                <label className="v2-form__label">Notes</label>
                <textarea
                    className="v2-form__input v2-form__textarea"
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder="Anything worth remembering"
                    rows={3}
                />
            </div>

            <div className="v2-form__footer">
                <button type="button" className="v2-btn-link" onClick={onCancel}>Cancel</button>
                <button type="submit" className="v2-btn v2-btn--primary" disabled={saving}>
                    {saving ? 'Saving…' : (initial?.id ? 'Save changes' : 'Create deal')}
                </button>
            </div>
        </form>
    );
}
