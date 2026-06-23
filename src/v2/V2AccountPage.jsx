import { useCallback, useEffect, useMemo, useState } from 'react';
import {
    fetchProjects,
    fetchDeals,
    fetchCases,
    fetchActivities,
    fetchClients,
    fetchClientDetail,
    fetchCompanyIntel,
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
    const [meetings, setMeetings] = useState([]);
    const [clientRecord, setClientRecord] = useState(null);
    const [contacts, setContacts] = useState([]);
    const [intel, setIntel] = useState(null);
    const [items, setItems] = useState([]); // client_items — research notes/links
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
            const [allProjects, allDeals, allCases, allClients] = await Promise.all([
                fetchProjects().catch(() => []),
                fetchDeals().catch(() => []),
                fetchCases().catch(() => []),
                fetchClients().catch(() => []),
            ]);
            const matchedProjects = allProjects.filter((p) => p.client_name === accountName || p.name === accountName);
            const matchedDeals    = allDeals.filter((d) => d.company_name === accountName);
            const matchedCases    = allCases.filter((c) => (c.client_name || c.company_name) === accountName);
            setProjects(matchedProjects);
            setDeals(matchedDeals);
            setCases(matchedCases);

            // Match a client record by name. fetchClients reconciles project
            // client_name strings into a real clients row, so the lookup is
            // usually clean. Names are case-sensitive in storage, so we do
            // a forgiving compare.
            const target = (allClients || []).find((c) => {
                const a = (c.name || '').trim().toLowerCase();
                const b = (accountName || '').trim().toLowerCase();
                return a && b && a === b;
            }) || null;
            setClientRecord(target);

            // fetchClientDetail returns { client, projects, deals, activities,
            // meetings, items } — single round-trip for the rich layer.
            if (target?.id) {
                try {
                    const detail = await fetchClientDetail(target.id);
                    const rich = Array.isArray(detail?.client?.contacts) ? detail.client.contacts : [];
                    setContacts(rich);
                    setMeetings(Array.isArray(detail?.meetings) ? detail.meetings : []);
                    setItems(Array.isArray(detail?.items) ? detail.items : []);
                    // Prefer detail.client over the bare clients-list record so
                    // contacts and any later-added fields stay in sync.
                    if (detail?.client) setClientRecord(detail.client);
                } catch {
                    setContacts(Array.isArray(target.contacts) ? target.contacts : []);
                    setMeetings([]);
                    setItems([]);
                }
            } else {
                setContacts([]);
                setMeetings([]);
                setItems([]);
            }

            // Company intel (summary, triggers, thesis, ICP score…) lives on the
            // `companies` table and is fetched by client name.
            try {
                const companyIntel = await fetchCompanyIntel(accountName);
                setIntel(companyIntel || null);
            } catch {
                setIntel(null);
            }

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
        // Meetings are conversation events — fold them into the timeline so
        // the History merge matches what the legacy account view shows.
        for (const m of meetings) {
            const when = m.meeting_date || m.created_at;
            if (when) {
                const attendeesText = Array.isArray(m.attendees) ? m.attendees.join(' · ') : (m.attendees || '');
                events.push({
                    type: 'meeting',
                    when,
                    title: `Meeting · ${m.title || 'Untitled'}`,
                    meta: attendeesText || (m.summary ? m.summary.slice(0, 80) : ''),
                });
            }
        }
        events.sort((a, b) => new Date(b.when) - new Date(a.when));
        return events.slice(0, 20);
    }, [activities, deals, projects, cases, meetings]);

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
                            {intel?.icp_tier && (
                                <span className="v2-account-tier v2-account-tier--icp">
                                    ICP · {intel.icp_tier}
                                </span>
                            )}
                            {typeof intel?.icp_score === 'number' && (
                                <span className={`v2-account-score ${intel.icp_score >= 7 ? 'is-strong' : intel.icp_score >= 4 ? 'is-mid' : 'is-weak'}`}>
                                    {intel.icp_score}/10
                                </span>
                            )}
                        </div>
                        <div className="v2-account-meta">
                            {intel?.industry && (
                                <span className="v2-account-meta__item">
                                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 21h18M5 21V8l7-5 7 5v13"/><path d="M9 21V11h6v10"/></svg>
                                    {intel.industry}
                                </span>
                            )}
                            {intel?.hq && (
                                <span className="v2-account-meta__item">
                                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>
                                    {intel.hq}
                                </span>
                            )}
                            <span className="v2-account-meta__item">{projects.length} project{projects.length === 1 ? '' : 's'}</span>
                            <span className="v2-account-meta__item">{deals.length} deal{deals.length === 1 ? '' : 's'}</span>
                            <span className="v2-account-meta__item">{cases.length} case{cases.length === 1 ? '' : 's'}</span>
                            {openValue > 0 && <span className="v2-account-meta__item">{fmt$(openValue)} open value</span>}
                            {(clientRecord?.website) && (
                                <a className="v2-account-meta__link" href={clientRecord.website} target="_blank" rel="noopener noreferrer">
                                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/></svg>
                                    Website
                                </a>
                            )}
                            {clientRecord?.linkedin_url && (
                                <a className="v2-account-meta__link" href={clientRecord.linkedin_url} target="_blank" rel="noopener noreferrer">
                                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M16 8a6 6 0 0 1 6 6v7h-4v-7a2 2 0 0 0-4 0v7h-4v-7a6 6 0 0 1 6-6z"/><rect x="2" y="9" width="4" height="12"/><circle cx="4" cy="4" r="2"/></svg>
                                    LinkedIn
                                </a>
                            )}
                            {intel?.scan_date && (
                                <span className="v2-account-meta__item v2-account-meta__item--muted">
                                    Last scanned {fmtDate(intel.scan_date)}
                                </span>
                            )}
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

            {/* OVERVIEW — company intel: summary, recommended angle, triggers,
                contact angles, thesis (with risks + next step). Pulls from
                companies via fetchCompanyIntel. */}
            <div className="v2-section v2-section--purple">
                <div className="v2-section__header">
                    <div className="v2-section__title-block">
                        <div className="v2-section__eyebrow">company intel</div>
                        <h2 className="v2-section__title">
                            Overview
                            {intel && (
                                <span className="v2-section__count">
                                    {intel.thesis_built ? 'full thesis ✓' : intel.deep_scanned ? 'deep scan ✓' : intel.summary ? 'surface scan' : 'starter'}
                                </span>
                            )}
                        </h2>
                    </div>
                    <div className="v2-section__actions">
                        <a
                            href="/legacy"
                            onClick={(e) => { e.preventDefault(); window.location.href = '/legacy'; }}
                            className="v2-section__link"
                        >
                            Scan / build thesis in legacy
                        </a>
                    </div>
                </div>
                <div className="v2-section__card">
                    <div className="v2-section__body">
                        {!intel ? (
                            <div className="v2-empty">
                                <strong>No company intel yet for {accountName}</strong>
                                Run a deep scan or build a thesis in the legacy Signal Watch / Clients page. Results land here automatically.
                            </div>
                        ) : (
                            <div className="v2-research">
                                {intel.summary && (
                                    <div className="v2-research__block">
                                        <div className="v2-research__label">Summary</div>
                                        <p className="v2-research__body">{intel.summary}</p>
                                    </div>
                                )}
                                {intel.recommended_angle && (
                                    <div className="v2-research__block v2-research__block--callout">
                                        <div className="v2-research__label">Recommended angle</div>
                                        <p className="v2-research__body" style={{ fontStyle: 'italic' }}>"{intel.recommended_angle}"</p>
                                    </div>
                                )}
                                {Array.isArray(intel.triggers) && intel.triggers.length > 0 && (
                                    <div className="v2-research__block">
                                        <div className="v2-research__label">Signal triggers · {intel.triggers.length}</div>
                                        <div className="v2-trigger-grid">
                                            {intel.triggers.map((t, i) => {
                                                // Mirror V2SignalsPage's trigger pill — same category palette.
                                                const cat = t.category || 'social';
                                                const accents = {
                                                    leadership: 'var(--v2-orange)',
                                                    funding:    'var(--v2-teal)',
                                                    expansion:  'var(--v2-blue)',
                                                    product:    'var(--v2-purple)',
                                                    pain:       '#c2451a',
                                                    hiring:     '#1e90ad',
                                                    social:     '#cc3366',
                                                };
                                                return (
                                                    <div
                                                        key={i}
                                                        className="v2-trigger"
                                                        style={{ '--trigger-accent': accents[cat] || accents.social }}
                                                    >
                                                        <div className="v2-trigger__head">
                                                            <span className="v2-trigger__cat">{cat}</span>
                                                            {t.urgency && (
                                                                <span className="v2-trigger__urgency">{t.urgency}</span>
                                                            )}
                                                        </div>
                                                        <div className="v2-trigger__title">{t.headline || t.title || 'Signal'}</div>
                                                        {t.detail && <div className="v2-trigger__detail">{t.detail}</div>}
                                                        {(t.source || t.date) && (
                                                            <div className="v2-trigger__meta">
                                                                {t.date && <span>{t.date}</span>}
                                                                {t.source && <span>· {t.source}</span>}
                                                            </div>
                                                        )}
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    </div>
                                )}
                                {Array.isArray(intel.contact_angles) && intel.contact_angles.length > 0 && (
                                    <div className="v2-research__block">
                                        <div className="v2-research__label">Contact angles · {intel.contact_angles.length}</div>
                                        <div className="v2-research__items">
                                            {intel.contact_angles.map((ca, i) => (
                                                <div key={i} className="v2-research__item">
                                                    <div className="v2-research__item-title">
                                                        {ca.name || ca.contact_name || 'Contact'}
                                                        {ca.is_primary && (
                                                            <span style={{ marginLeft: 8, fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.08em', padding: '2px 6px', borderRadius: 4, background: 'var(--v2-orange)', color: '#fff' }}>Primary</span>
                                                        )}
                                                    </div>
                                                    {(ca.title || ca.role) && <div className="v2-research__item-meta">{ca.title || ca.role}</div>}
                                                    {ca.angle && <div className="v2-research__item-body">{ca.angle}</div>}
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                )}
                                {intel.thesis_built && intel.thesis && (
                                    <div className="v2-research__block v2-research__block--callout">
                                        <div className="v2-research__label">
                                            Thesis
                                            {intel.thesis_date && (
                                                <span style={{ marginLeft: 8, fontStyle: 'normal', fontFamily: 'var(--v2-font-body)', color: 'var(--crm-text-3)' }}>
                                                    Built {fmtDate(intel.thesis_date)}
                                                </span>
                                            )}
                                        </div>
                                        <p className="v2-research__body">{intel.thesis}</p>
                                        {intel.thesis_next_step && (
                                            <div className="v2-research__next-step">
                                                <strong>Next step:</strong> {intel.thesis_next_step}
                                            </div>
                                        )}
                                    </div>
                                )}
                                {Array.isArray(intel.thesis_risks) && intel.thesis_risks.length > 0 && (
                                    <div className="v2-research__block">
                                        <div className="v2-research__label">Risks</div>
                                        <ul className="v2-research__list">
                                            {intel.thesis_risks.map((r, i) => (
                                                <li key={i}>{typeof r === 'string' ? r : (r.risk || r.text || r.label || JSON.stringify(r))}</li>
                                            ))}
                                        </ul>
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                </div>
            </div>

            {/* RESEARCH — client_items (notes, links Mike adds via legacy Clients) */}
            <div className="v2-section v2-section--teal">
                <div className="v2-section__header">
                    <div className="v2-section__title-block">
                        <div className="v2-section__eyebrow">notes &amp; links</div>
                        <h2 className="v2-section__title">
                            Research
                            <span className="v2-section__count">
                                {items.length} {items.length === 1 ? 'item' : 'items'}
                            </span>
                        </h2>
                    </div>
                    {clientRecord?.id && (
                        <div className="v2-section__actions">
                            <a
                                href="/legacy"
                                onClick={(e) => { e.preventDefault(); window.location.href = '/legacy'; }}
                                className="v2-section__link"
                            >
                                Add in legacy
                            </a>
                        </div>
                    )}
                </div>
                <div className="v2-section__card">
                    <div className="v2-section__body">
                        {!clientRecord ? (
                            <div className="v2-empty">
                                <strong>No client record yet for {accountName}</strong>
                                Research items attach to the Clients table. Create the record from Mike's Clients page first.
                            </div>
                        ) : items.length === 0 ? (
                            <div className="v2-empty">
                                <strong>No research items yet</strong>
                                Notes and links live on the client record. Add them from the legacy Clients page → Research tab.
                            </div>
                        ) : (
                            <div className="v2-research__items">
                                {items.map((it) => (
                                    <div key={it.id} className="v2-research__item">
                                        <div className="v2-research__item-title">
                                            {it.url ? (
                                                <a href={it.url} target="_blank" rel="noopener noreferrer">{it.title || it.url}</a>
                                            ) : (
                                                it.title || 'Untitled'
                                            )}
                                            <span style={{ marginLeft: 8, fontFamily: 'var(--v2-font-serif)', fontStyle: 'italic', fontSize: 11, color: 'var(--crm-text-3)' }}>
                                                {it.type}
                                            </span>
                                        </div>
                                        {it.body && <div className="v2-research__item-body">{it.body}</div>}
                                        <div className="v2-research__item-meta">
                                            {it.added_by && <>{it.added_by} · </>}
                                            {it.created_at && fmtDate(it.created_at)}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                </div>
            </div>

            {/* CLIENT NOTES — surfaces clients.notes (Mike's editable client memo) */}
            {clientRecord?.notes && (
                <div className="v2-section v2-section--orange">
                    <div className="v2-section__header">
                        <div className="v2-section__title-block">
                            <div className="v2-section__eyebrow">client memo</div>
                            <h2 className="v2-section__title">Notes</h2>
                        </div>
                        <div className="v2-section__actions">
                            <a
                                href="/legacy"
                                onClick={(e) => { e.preventDefault(); window.location.href = '/legacy'; }}
                                className="v2-section__link"
                            >
                                Edit in legacy
                            </a>
                        </div>
                    </div>
                    <div className="v2-section__card">
                        <div className="v2-section__body">
                            <p className="v2-research__body" style={{ whiteSpace: 'pre-wrap' }}>{clientRecord.notes}</p>
                        </div>
                    </div>
                </div>
            )}

            {/* TIMELINE */}
            {/* CONTACTS — from the canonical clients.contacts jsonb */}
            <div className="v2-section v2-section--blue">
                <div className="v2-section__header">
                    <div className="v2-section__title-block">
                        <div className="v2-section__eyebrow">who you talk to</div>
                        <h2 className="v2-section__title">
                            Contacts
                            <span className="v2-section__count">
                                {contacts.length} {contacts.length === 1 ? 'person' : 'people'}
                            </span>
                        </h2>
                    </div>
                    {clientRecord?.id && (
                        <div className="v2-section__actions">
                            <a
                                href="/legacy"
                                onClick={(e) => { e.preventDefault(); window.location.href = '/legacy'; }}
                                className="v2-section__link"
                            >
                                Manage in legacy
                            </a>
                        </div>
                    )}
                </div>
                <div className="v2-section__card">
                    <div className="v2-section__body">
                        {!clientRecord && (
                            <div className="v2-empty">
                                <strong>No client record yet for {accountName}</strong>
                                Contacts attach to the Clients table. Mike's Clients page will create
                                the record once you add the first contact there.
                            </div>
                        )}
                        {clientRecord && contacts.length === 0 && (
                            <div className="v2-empty">
                                <strong>No contacts on this client yet</strong>
                                Add them from the Clients page — they'll appear here automatically.
                            </div>
                        )}
                        {contacts.length > 0 && (
                            <div className="v2-contact-grid">
                                {contacts.map((c, i) => {
                                    const initials = (c.name || '?')
                                        .split(' ')
                                        .filter(Boolean)
                                        .slice(0, 2)
                                        .map((w) => w[0].toUpperCase())
                                        .join('');
                                    return (
                                        <div key={c.id || c.name || i} className="v2-contact-card">
                                            <div className="v2-contact-card__head">
                                                <div className="v2-contact-card__avatar">{initials}</div>
                                                <div className="v2-contact-card__body">
                                                    <div className="v2-contact-card__name-row">
                                                        <span className="v2-contact-card__name">{c.name || 'Unnamed'}</span>
                                                        {c.is_primary && (
                                                            <span className="v2-contact-card__primary">Primary</span>
                                                        )}
                                                    </div>
                                                    {c.title && <div className="v2-contact-card__title">{c.title}</div>}
                                                </div>
                                            </div>
                                            <div className="v2-contact-card__details">
                                                {c.email && (
                                                    <a className="v2-contact-card__link" href={`mailto:${c.email}`}>
                                                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/></svg>
                                                        {c.email}
                                                    </a>
                                                )}
                                                {c.linkedin && (
                                                    <a className="v2-contact-card__link" href={c.linkedin} target="_blank" rel="noopener noreferrer">
                                                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M16 8a6 6 0 0 1 6 6v7h-4v-7a2 2 0 0 0-4 0v7h-4v-7a6 6 0 0 1 6-6z"/><rect x="2" y="9" width="4" height="12"/><circle cx="4" cy="4" r="2"/></svg>
                                                        LinkedIn
                                                    </a>
                                                )}
                                                {c.source && (
                                                    <span className={`v2-contact-card__source v2-contact-card__source--${c.source}`}>
                                                        {c.source}
                                                    </span>
                                                )}
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </div>
                </div>
            </div>

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
