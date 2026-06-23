import { useCallback, useEffect, useState } from 'react';
import { loadIcp, DEFAULT_ICP } from './safe-data.js';
import { saveIcp } from './write-data.js';

/* ============================================
   V2 ICP SETTINGS

   Focused port: only ICP profile fields. The
   legacy SettingsPage also handles brand brain,
   team config, and weekly-scan setup — those
   stay accessible via the legacy app for now.
   Each field is a long-form textarea because
   that's how ICP is genuinely authored.
============================================ */

const SECTIONS = [
    {
        accent: 'orange',
        eyebrow: 'voice',
        title: 'About you',
        body: "How Part Human is described to the prospecting engine. Used in every email draft and scan.",
        fields: [
            {
                key: 'aboutCompany',
                label: 'About the company',
                placeholder: 'What Part Human is, who you serve, what the entry point looks like.',
                help: 'Used as the opening context block for every AI-generated outreach.',
                rows: 5,
            },
            {
                key: 'outreachVoice',
                label: 'Outreach voice',
                placeholder: 'How you want emails to sound.',
                help: 'Direct, warm, no jargon. Specific instructions here are followed verbatim.',
                rows: 4,
            },
            {
                key: 'emailSignature',
                label: 'Email signature',
                placeholder: 'Optional. Drop in your standard sign-off.',
                help: 'Appended at the end of generated emails. Leave blank to opt out.',
                rows: 3,
            },
        ],
    },
    {
        accent: 'blue',
        eyebrow: 'fit',
        title: 'Your ideal customer',
        body: "Who you want Signal Watch to surface, score, and prioritize.",
        fields: [
            {
                key: 'icpCriteria',
                label: 'ICP criteria',
                placeholder: 'Revenue, employees, stage, pain signals, trigger types.',
                help: 'Used by the scoring engine to decide whether a company is a Tier 1/2/3 fit.',
                rows: 6,
            },
            {
                key: 'icpScoring',
                label: 'Scoring rubric',
                placeholder: 'How 1–10 maps to "perfect fit" → "not a fit".',
                help: 'Each scan produces an ICP score per company. This text describes the bands.',
                rows: 6,
            },
            {
                key: 'icpTiers',
                label: 'Segment tiers',
                placeholder: '"Ambitious Scale-Up": series A/B, 30-100 emp…',
                help: 'Names + criteria for the segments you sell into. Surfaces as tags on companies.',
                rows: 5,
            },
        ],
    },
];

export default function V2SettingsPage() {
    const [icp,      setIcp]      = useState(DEFAULT_ICP);
    const [draft,    setDraft]    = useState(DEFAULT_ICP);
    const [loading,  setLoading]  = useState(true);
    const [saving,   setSaving]   = useState(false);
    const [error,    setError]    = useState(null);
    const [toast,    setToast]    = useState(null);

    const load = useCallback(async () => {
        try {
            setLoading(true);
            setError(null);
            const loaded = await loadIcp();
            setIcp(loaded);
            setDraft(loaded);
        } catch (err) {
            setError(err.message || 'Failed to load ICP');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { load(); }, [load]);

    // Auto-dismiss toast
    useEffect(() => {
        if (!toast) return;
        const t = setTimeout(() => setToast(null), 4000);
        return () => clearTimeout(t);
    }, [toast]);

    const isDirty = JSON.stringify(draft) !== JSON.stringify(icp);

    const handleSave = async (e) => {
        e?.preventDefault?.();
        if (!isDirty) return;
        setSaving(true);
        try {
            await saveIcp(draft);
            setIcp(draft);
            setToast({ kind: 'win', text: 'ICP saved. Future scans use the new profile.' });
        } catch (err) {
            setToast({ kind: 'warn', text: err.message || 'Couldn\'t save' });
        } finally {
            setSaving(false);
        }
    };

    const handleReset = () => {
        setDraft(icp);
        setToast({ kind: 'info', text: 'Reverted to saved values.' });
    };

    const handleResetToDefaults = () => {
        if (!window.confirm('Replace your ICP with the Part Human defaults? This only changes the draft — you still need to save.')) return;
        setDraft(DEFAULT_ICP);
    };

    const filledCount = Object.values(draft).filter((v) => (v || '').trim().length > 0).length;
    const totalCount  = Object.keys(DEFAULT_ICP).length;

    return (
        <>
            <div className="v2-page-header">
                <div>
                    <div className="v2-page-header__eyebrow">tune the prospecting engine</div>
                    <h1 className="v2-page-title">
                        ICP Settings
                        <span className="v2-page-title__count">
                            {filledCount} of {totalCount} fields filled
                        </span>
                    </h1>
                    <p className="v2-page-subtitle">
                        {loading
                            ? 'Loading from Supabase…'
                            : isDirty
                                ? 'Unsaved changes — save to apply to the next scan.'
                                : 'Saved · these values are used by every Signal Watch scan and email draft.'}
                    </p>
                </div>
                <div className="v2-page-header__actions">
                    {isDirty && (
                        <button type="button" className="v2-btn" onClick={handleReset} disabled={saving}>
                            Discard
                        </button>
                    )}
                    <button
                        type="button"
                        className="v2-btn v2-btn--primary"
                        onClick={handleSave}
                        disabled={!isDirty || saving}
                    >
                        {saving ? 'Saving…' : isDirty ? 'Save changes' : 'Saved'}
                    </button>
                </div>
            </div>

            {error && <div className="v2-error">{error}</div>}

            {SECTIONS.map((section) => (
                <div key={section.title} className={`v2-section v2-section--${section.accent}`}>
                    <div className="v2-section__header">
                        <div className="v2-section__title-block">
                            <div className="v2-section__eyebrow">{section.eyebrow}</div>
                            <h2 className="v2-section__title">{section.title}</h2>
                        </div>
                    </div>
                    <div className="v2-section__card">
                        <div className="v2-section__body">
                            <p className="v2-settings__intro">{section.body}</p>
                            {section.fields.map((field) => (
                                <div key={field.key} className="v2-settings__field">
                                    <div className="v2-settings__field-head">
                                        <label className="v2-settings__label" htmlFor={`v2-icp-${field.key}`}>{field.label}</label>
                                        {(draft[field.key] || '').trim() === '' && (
                                            <span className="v2-settings__empty-chip">empty</span>
                                        )}
                                    </div>
                                    <textarea
                                        id={`v2-icp-${field.key}`}
                                        className="v2-settings__textarea"
                                        value={draft[field.key] ?? ''}
                                        onChange={(e) => setDraft((d) => ({ ...d, [field.key]: e.target.value }))}
                                        placeholder={field.placeholder}
                                        rows={field.rows}
                                        disabled={loading}
                                    />
                                    <div className="v2-settings__help">{field.help}</div>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            ))}

            <div className="v2-settings__footer">
                <button
                    type="button"
                    className="v2-btn-link"
                    onClick={handleResetToDefaults}
                    disabled={loading}
                >
                    Reset to Part Human defaults
                </button>
                <div style={{ display: 'flex', gap: 10 }}>
                    {isDirty && (
                        <button type="button" className="v2-btn" onClick={handleReset} disabled={saving}>
                            Discard changes
                        </button>
                    )}
                    <button
                        type="button"
                        className="v2-btn v2-btn--primary"
                        onClick={handleSave}
                        disabled={!isDirty || saving}
                    >
                        {saving ? 'Saving…' : isDirty ? 'Save changes' : 'Saved'}
                    </button>
                </div>
            </div>

            {toast && (
                <div className={`v2-toast v2-toast--${toast.kind}`}>
                    <span className="v2-toast__icon">{toast.kind === 'win' ? '✓' : toast.kind === 'warn' ? '!' : '·'}</span>
                    <span>{toast.text}</span>
                </div>
            )}
        </>
    );
}
