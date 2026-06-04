import { useCallback, useEffect, useMemo, useState } from 'react';
import {
    fetchProjects,
    fetchDeals,
    fetchCases,
    fetchActivities,
    fmtDate,
    fmt$,
    dealValue,
    DEAL_CLOSED_STAGES,
    stageLabel,
} from './safe-data.js';
import V2Modal from './V2Modal.jsx';
import DealForm from './forms/DealForm.jsx';
import ActivityForm from './forms/ActivityForm.jsx';

/* ============================================
   V2 ACCOUNT HUB

   Derives a single account view by client name
   from projects + deals + cases. Shows active
   work cards, lifecycle stage, and a chronological
   activity stream by merging deal activities +
   project updates + case message events.

   Until there's a true accounts table this is
   the best we can do without schema changes.
============================================ */

const LIFECYCLE_STEPS = [
    { id: 'signal',   label: 'Signal' },
    { id: 'outreach', label: 'Outreach' },
    { id: 'deal',     label: 'Deal' },
    { id: 'won',      label: 'Deal Won' },
    { id: 'project',  label: 'Project' },
    { id: 'ongoing',  label: 'Ongoing' },
];

function pickCurrentStep(deals, projects) {
    const hasActive = projects.some((p) => p.status === 'active');
    const hasWon    = deals.some((d) => d.stage === 'won');
    const hasOpen   = deals.some((d) => !DEAL_CLOSED_STAGES.find((s) => s.id === d.stage));
    const hasCompleted = projects.some((p) => p.status === 'completed');
    if (hasActive) return 4;
    if (hasWon && !hasActive) return 3;
    if (hasOpen) return 2;
    if (hasCompleted) return 5;
    return 1;
}

function formatRel(dateStr) {
    if (!dateStr) return '';
    const d = new Date(dateStr);
    const diffH = (Date.now() - d.getTime()) / 3600000;
    if (diffH < 1) return `${Math.round(diffH * 60)}m ago`;
    if (diffH < 24) return `${Math.round(diffH)}h ago`;
    const days = Math.round(diffH / 24);
    if (days < 7) return `${days}d ago`;
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export default function V2AccountPage({ accountName, onBack, onSelectProject }) {
    const [projects, setProjects] = useState([]);
    const [deals, setDeals] = useState([]);
    const [cases, setCases] = useState([]);
    const [activities, setActivities] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    // Modal state
    const [dealModal, setDealModal] = useState(null);    // null | { mode: 'new' | 'edit', target?: deal }
    const [activityOpen, setActivityOpen] = useState(false);
    const [toast, setToast] = useState(null);

    const load = useCallback(async () => {
        try {
            setLoading(true);
            setError(null);
            const [allProjects, allDeals, allCases] = await Promise.all([
                fetchProjects().catch(() => []),
                fetchDeals().catch(() => []),
                fetchCases().catch(() => []),
            ]);
            const matchedProjects = allProjects.filter((p) => p.client_name === accountName || p.name === accountName);
            const matchedDeals    = allDeals.filter((d) => d.company_name === accountName);
            const matchedCases    = allCases.filter((c) => (c.client_name || c.company_name) === accountName);
            setProjects(matchedProjects);
            setDeals(matchedDeals);
            setCases(matchedCases);
            // Pull activities for every matched deal in parallel
            const acts = await Promise.all(matchedDeals.map((d) => fetchActivities(d.id).catch(() => [])));
            setActivities(acts.flat());
        } catch (err) {
            setError(err.message || 'Failed to load account');
        } finally {
            setLoading(false);
        }
    }, [accountName]);

    useEffect(() => { load(); }, [load]);

    // Auto-dismiss toast
    useEffect(() => {
        if (!toast) return;
        const t = setTimeout(() => setToast(null), 4000);
        return () => clearTimeout(t);
    }, [toast]);

    const currentStep = pickCurrentStep(deals, projects);
    const openDeals = deals.filter((d) => !DEAL_CLOSED_STAGES.find((s) => s.id === d.stage));
    const activeProjects = projects.filter((p) => p.status === 'active');
    const openCases = cases.filter((c) => c.status !== 'resolved' && c.status !== 'closed');
    const openValue = openDeals.reduce((sum, d) => sum + dealValue(d), 0);

    const timeline = useMemo(() => {
        const events = [];
        for (const a of activities) {
            events.push({ type: 'activity', when: a.activity_date || a.created_at, title: a.summary || a.type, meta: `${a.type} · ${a.assigned_to || ''}` });
        }
        for (const d of deals) {
            if (d.won_date) events.push({ type: 'deal-won', when: d.won_date, title: `Won deal · ${d.title || d.company_name}`, meta: fmt$(dealValue(d)) });
            if (d.lost_date) events.push({ type: 'deal-lost', when: d.lost_date, title: `Lost deal · ${d.title || d.company_name}`, meta: 'closed' });
            else if (d.created_at) events.push({ type: 'deal-new', when: d.created_at, title: `Deal opened · ${d.title || d.company_name}`, meta: `${stageLabel(d.stage)} · ${fmt$(dealValue(d))}` });
        }
        for (const p of projects) {
            if (p.created_at) events.push({ type: 'project', when: p.created_at, title: `Project · ${p.name}`, meta: p.status });
        }
        for (const c of cases) {
            if (c.created_at) events.push({ type: 'case', when: c.created_at, title: `Case · ${c.title || c.subject || 'opened'}`, meta: c.priority || '' });
        }
        events.sort((a, b) => new Date(b.when) - new Date(a.when));
        return events.slice(0, 15);
    }, [activities, deals, projects, cases]);

    if (loading) {
        return (
            <>
                <div className="v2-page-header">
                    <div>
                        <div className="v2-page-header__eyebrow">loading account</div>
                        <h1 className="v2-page-title">{accountName}</h1>
                    </div>
                </div>
                <div className="v2-empty"><strong>Loading…</strong></div>
            </>
        );
    }

    if (error) {
        return (
            <>
                <div className="v2-error">{error}</div>
                <button type="button" className="v2-btn" onClick={onBack}>← Back</button>
            </>
        );
    }

    return (
        <>
            <section className="v2-account-hero">
                <div className="v2-account-hero__top">
                    <div className="v2-account-logo">{accountName.slice(0, 1).toUpperCase()}</div>
                    <div className="v2-account-header">
                        <div className="v2-account-header__row">
                            <h1 className="v2-account-name">{accountName}</h1>
                            <span className="v2-account-tier">
                                <span className="v2-account-tier__dot" />
                                {activeProjects.length ? 'Active client' : openDeals.length ? 'Prospect' : 'Past client'}
                            </span>
                        </div>
                        <div className="v2-account-meta">
                            <span className="v2-account-meta__item">{projects.length} project{projects.length === 1 ? '' : 's'}</span>
                            <span className="v2-account-meta__item">{deals.length} deal{deals.length === 1 ? '' : 's'}</span>
                            <span className="v2-account-meta__item">{cases.length} case{cases.length === 1 ? '' : 's'}</span>
                            {openValue > 0 && <span className="v2-account-meta__item">{fmt$(openValue)} open value</span>}
                        </div>
                    </div>
                    <div className="v2-account-actions">
                        <button type="button" className="v2-btn" onClick={onBack}>← All accounts</button>
                        <button
                            type="button"
                            className="v2-btn"
                            onClick={() => setActivityOpen(true)}
                            title={deals.length === 0 ? 'Create a deal first — activities attach to deals' : 'Log activity to this account'}
                        >
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H5a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h13a2 2 0 0 0 2-2v-6"/><path d="M19 3l3 3-9 9H10v-3z"/></svg>
                            Log activity
                        </button>
                        <button
                            type="button"
                            className="v2-btn v2-btn--primary"
                            onClick={() => setDealModal({ mode: 'new' })}
                        >
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 5v14M5 12h14"/></svg>
                            New deal
                        </button>
                    </div>
                </div>

                <div className="v2-lifecycle">
                    <div className="v2-lifecycle__title">Account lifecycle</div>
                    <div className="v2-lifecycle__steps">
                        {LIFECYCLE_STEPS.map((step, i) => {
                            let cls = 'v2-lifecycle-step';
                            if (i < currentStep) cls += ' is-past';
                            if (i === currentStep) cls += ' is-current';
                            return (
                                <div key={step.id} className={cls}>
                                    <span className="v2-lifecycle-step__node" />
                                    <div className="v2-lifecycle-step__label">{step.label}</div>
                                </div>
                            );
                        })}
                    </div>
                </div>
            </section>

            {/* ACTIVE WORK */}
            <div className="v2-section v2-section--work">
                <div className="v2-section__header">
                    <div className="v2-section__title-block">
                        <div className="v2-section__eyebrow">in motion</div>
                        <h2 className="v2-section__title">
                            Open work
                            <span className="v2-section__count">
                                {activeProjects.length + openDeals.length + openCases.length} item{(activeProjects.length + openDeals.length + openCases.length) === 1 ? '' : 's'}
                            </span>
                        </h2>
                    </div>
                </div>
                <div className="v2-section__card">
                    <div className="v2-section__body">
                        {activeProjects.length === 0 && openDeals.length === 0 && openCases.length === 0 ? (
                            <div className="v2-empty">
                                <strong>No active work for {accountName}</strong>
                                When a deal opens or a project starts here, it'll show up automatically.
                            </div>
                        ) : (
                            <div className="v2-work-grid">
                                {activeProjects.map((p) => (
                                    <button key={p.id} type="button" className="v2-work-card" onClick={() => onSelectProject && onSelectProject(p.id)}>
                                        <div className="v2-work-card__type v2-work-card__type--project">Project · Active</div>
                                        <div className="v2-work-card__title">{p.name}</div>
                                        <div className="v2-work-card__meta">
                                            {p.start_date && `Started ${fmtDate(p.start_date)}`}
                                            {p.end_date && ` · Due ${fmtDate(p.end_date)}`}
                                        </div>
                                    </button>
                                ))}
                                {openDeals.map((d) => (
                                    <button
                                        key={d.id}
                                        type="button"
                                        className="v2-work-card"
                                        onClick={() => setDealModal({ mode: 'edit', target: d })}
                                    >
                                        <div className="v2-work-card__type v2-work-card__type--deal">Deal · {stageLabel(d.stage)}</div>
                                        <div className="v2-work-card__title">{d.title || d.company_name}</div>
                                        <div className="v2-work-card__meta">
                                            {d.contact_name && `${d.contact_name} · `}
                                            {fmt$(dealValue(d))}
                                        </div>
                                    </button>
                                ))}
                                {openCases.map((c) => (
                                    <div key={c.id} className="v2-work-card">
                                        <div className="v2-work-card__type v2-work-card__type--support">Support · {c.status || 'open'}</div>
                                        <div className="v2-work-card__title">{c.title || c.subject || 'Untitled case'}</div>
                                        <div className="v2-work-card__meta">{c.priority || ''}</div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                </div>
            </div>

            {/* TIMELINE */}
            <div className="v2-section v2-section--timeline">
                <div className="v2-section__header">
                    <div className="v2-section__title-block">
                        <div className="v2-section__eyebrow">the log</div>
                        <h2 className="v2-section__title">
                            Activity timeline
                            <span className="v2-section__count">{timeline.length} recent events</span>
                        </h2>
                    </div>
                </div>
                <div className="v2-section__card">
                    <div>
                        {timeline.length === 0 ? (
                            <div className="v2-empty">No activity logged yet.</div>
                        ) : timeline.map((event, i) => (
                            <div key={i} className="v2-timeline-item">
                                <div className="v2-timeline-item__date"><strong>{formatRel(event.when)}</strong></div>
                                <div className="v2-timeline-item__body">
                                    <span className={`v2-timeline-item__dot v2-timeline-item__dot--${event.type.split('-')[0]}`} />
                                    <div className="v2-timeline-item__content">
                                        <div className="v2-timeline-item__title">{event.title}</div>
                                        <div className="v2-timeline-item__meta">{event.meta}</div>
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            </div>

            {/* Toast */}
            {toast && (
                <div className={`v2-toast v2-toast--${toast.kind}`}>
                    <span className="v2-toast__icon">{toast.kind === 'win' ? '✓' : toast.kind === 'warn' ? '!' : '·'}</span>
                    <span>{toast.text}</span>
                </div>
            )}

            {/* New / edit deal modal — company_name pre-filled when creating new */}
            <V2Modal
                open={dealModal !== null}
                onClose={() => setDealModal(null)}
                eyebrow={dealModal?.mode === 'edit' ? 'edit deal' : 'new deal'}
                title={dealModal?.mode === 'edit'
                    ? (dealModal.target?.title || dealModal.target?.company_name || 'Edit deal')
                    : `New deal · ${accountName}`}
            >
                {dealModal && (
                    <DealForm
                        initial={dealModal.mode === 'edit'
                            ? dealModal.target
                            : { company_name: accountName }}
                        onSaved={() => {
                            const wasNew = dealModal.mode === 'new';
                            setDealModal(null);
                            load();
                            if (wasNew) setToast({ kind: 'win', text: `Deal added to ${accountName}.` });
                        }}
                        onCancel={() => setDealModal(null)}
                    />
                )}
            </V2Modal>

            {/* Log activity modal — picks from this account's deals */}
            <V2Modal
                open={activityOpen}
                onClose={() => setActivityOpen(false)}
                eyebrow="log activity"
                title={`Activity · ${accountName}`}
            >
                {activityOpen && (
                    <ActivityForm
                        deals={deals}
                        onSaved={() => {
                            setActivityOpen(false);
                            load();
                            setToast({ kind: 'win', text: 'Activity logged.' });
                        }}
                        onCancel={() => setActivityOpen(false)}
                    />
                )}
            </V2Modal>
        </>
    );
}
