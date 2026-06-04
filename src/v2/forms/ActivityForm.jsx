import { useState } from 'react';
import { addActivity } from '../write-data.js';
import { ACTIVITY_TYPES, DEAL_OWNERS } from '../safe-data.js';

/**
 * Log a deal activity (email / call / meeting / note / proposal / contract).
 * Activities belong to a deal — if the account has multiple, the user picks one.
 */
export default function ActivityForm({ deals = [], onSaved, onCancel }) {
    const [dealId,    setDealId]    = useState(deals[0]?.id || '');
    const [type,      setType]      = useState('note');
    const [summary,   setSummary]   = useState('');
    const [date,      setDate]      = useState(new Date().toISOString().slice(0, 10));
    const [owner,     setOwner]     = useState(DEAL_OWNERS[0] || '');
    const [saving, setSaving] = useState(false);
    const [error,  setError]  = useState(null);

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (!dealId)          { setError('Pick a deal to log this activity against'); return; }
        if (!summary.trim())  { setError('Summary is required'); return; }
        setError(null);
        setSaving(true);
        try {
            const saved = await addActivity({
                deal_id: dealId,
                type,
                summary: summary.trim(),
                activity_date: date,
                assigned_to: owner || null,
            });
            onSaved?.(saved);
        } catch (err) {
            setError(err.message || 'Couldn\'t save');
        } finally {
            setSaving(false);
        }
    };

    if (deals.length === 0) {
        return (
            <div className="v2-empty">
                <strong>No deals to log against yet</strong>
                Create a deal for this account first — activities attach to deals.
                <div style={{ marginTop: 14 }}>
                    <button type="button" className="v2-btn" onClick={onCancel}>Close</button>
                </div>
            </div>
        );
    }

    return (
        <form className="v2-form" onSubmit={handleSubmit}>
            {error && <div className="v2-error">{error}</div>}

            <div className="v2-form__field">
                <label className="v2-form__label">Deal</label>
                <div className="v2-select-wrap">
                    <select className="v2-select" value={dealId} onChange={(e) => setDealId(e.target.value)}>
                        {deals.map((d) => (
                            <option key={d.id} value={d.id}>
                                {d.title || d.company_name || 'Untitled deal'}
                            </option>
                        ))}
                    </select>
                    <svg className="v2-select__chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M6 9l6 6 6-6"/></svg>
                </div>
            </div>

            <div className="v2-form__row">
                <div className="v2-form__field">
                    <label className="v2-form__label">Type</label>
                    <div className="v2-select-wrap">
                        <select className="v2-select" value={type} onChange={(e) => setType(e.target.value)}>
                            {ACTIVITY_TYPES.map((t) => (
                                <option key={t} value={t}>{t[0].toUpperCase() + t.slice(1)}</option>
                            ))}
                        </select>
                        <svg className="v2-select__chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M6 9l6 6 6-6"/></svg>
                    </div>
                </div>
                <div className="v2-form__field">
                    <label className="v2-form__label">When</label>
                    <input
                        className="v2-form__input"
                        type="date"
                        value={date}
                        onChange={(e) => setDate(e.target.value)}
                    />
                </div>
            </div>

            <div className="v2-form__field">
                <label className="v2-form__label">Summary</label>
                <textarea
                    className="v2-form__input v2-form__textarea"
                    value={summary}
                    onChange={(e) => setSummary(e.target.value)}
                    placeholder="What happened? Decisions, next steps, who said what."
                    rows={4}
                    autoFocus
                />
            </div>

            <div className="v2-form__field">
                <label className="v2-form__label">Logged by</label>
                <div className="v2-select-wrap">
                    <select className="v2-select" value={owner} onChange={(e) => setOwner(e.target.value)}>
                        {DEAL_OWNERS.map((o) => <option key={o} value={o}>{o}</option>)}
                    </select>
                    <svg className="v2-select__chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M6 9l6 6 6-6"/></svg>
                </div>
            </div>

            <div className="v2-form__footer">
                <button type="button" className="v2-btn-link" onClick={onCancel}>Cancel</button>
                <button type="submit" className="v2-btn v2-btn--primary" disabled={saving}>
                    {saving ? 'Saving…' : 'Log activity'}
                </button>
            </div>
        </form>
    );
}
