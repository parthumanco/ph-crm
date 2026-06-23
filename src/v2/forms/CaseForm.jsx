import { useState } from 'react';
import { upsertCase } from '../write-data.js';
import { CASE_STATUSES, CASE_PRIORITIES, CHANNELS } from '../safe-data.js';

/**
 * Create or edit a support case. Wraps lib/support.upsertCase.
 * For edit, pass the existing case as `initial`.
 */
export default function CaseForm({ initial = null, onSaved, onCancel }) {
    const [clientName,  setClientName]  = useState(initial?.client_name  || initial?.company_name || '');
    const [contactName, setContactName] = useState(initial?.contact_name || '');
    const [title,       setTitle]       = useState(initial?.title       || initial?.subject || '');
    const [priority,    setPriority]    = useState(initial?.priority    || CASE_PRIORITIES[1]?.id || 'normal');
    const [status,      setStatus]      = useState(initial?.status      || CASE_STATUSES[0]?.id  || 'open');
    const [channel,     setChannel]     = useState(initial?.channel     || CHANNELS[0]?.id       || 'email');
    const [body,        setBody]        = useState(initial?.body        || initial?.description || '');
    const [saving, setSaving] = useState(false);
    const [error,  setError]  = useState(null);

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (!clientName.trim()) { setError('Client name is required'); return; }
        if (!title.trim())      { setError('Title is required');       return; }
        setError(null);
        setSaving(true);
        try {
            const saved = await upsertCase({
                ...(initial?.id ? { id: initial.id } : {}),
                client_name:  clientName.trim(),
                contact_name: contactName.trim() || null,
                title:        title.trim(),
                priority,
                status,
                channel,
                body:         body.trim() || null,
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
                    <label className="v2-form__label">Client</label>
                    <input
                        className="v2-form__input"
                        type="text"
                        value={clientName}
                        onChange={(e) => setClientName(e.target.value)}
                        placeholder="Which account is this for?"
                        autoFocus
                    />
                </div>
                <div className="v2-form__field">
                    <label className="v2-form__label">Contact</label>
                    <input
                        className="v2-form__input"
                        type="text"
                        value={contactName}
                        onChange={(e) => setContactName(e.target.value)}
                        placeholder="Person who raised this"
                    />
                </div>
            </div>

            <div className="v2-form__field">
                <label className="v2-form__label">Title</label>
                <input
                    className="v2-form__input"
                    type="text"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="One-line summary"
                />
            </div>

            <div className="v2-form__row">
                <div className="v2-form__field">
                    <label className="v2-form__label">Priority</label>
                    <div className="v2-select-wrap">
                        <select className="v2-select" value={priority} onChange={(e) => setPriority(e.target.value)}>
                            {CASE_PRIORITIES.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
                        </select>
                        <svg className="v2-select__chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M6 9l6 6 6-6"/></svg>
                    </div>
                </div>
                <div className="v2-form__field">
                    <label className="v2-form__label">Channel</label>
                    <div className="v2-select-wrap">
                        <select className="v2-select" value={channel} onChange={(e) => setChannel(e.target.value)}>
                            {CHANNELS.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
                        </select>
                        <svg className="v2-select__chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M6 9l6 6 6-6"/></svg>
                    </div>
                </div>
                <div className="v2-form__field">
                    <label className="v2-form__label">Status</label>
                    <div className="v2-select-wrap">
                        <select className="v2-select" value={status} onChange={(e) => setStatus(e.target.value)}>
                            {CASE_STATUSES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
                        </select>
                        <svg className="v2-select__chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M6 9l6 6 6-6"/></svg>
                    </div>
                </div>
            </div>

            <div className="v2-form__field">
                <label className="v2-form__label">First message (optional)</label>
                <textarea
                    className="v2-form__input v2-form__textarea"
                    value={body}
                    onChange={(e) => setBody(e.target.value)}
                    placeholder="The initial outreach or context. Leave blank to add later."
                    rows={3}
                />
            </div>

            <div className="v2-form__footer">
                <button type="button" className="v2-btn-link" onClick={onCancel}>Cancel</button>
                <button type="submit" className="v2-btn v2-btn--primary" disabled={saving}>
                    {saving ? 'Saving…' : (initial?.id ? 'Save changes' : 'Create case')}
                </button>
            </div>
        </form>
    );
}
