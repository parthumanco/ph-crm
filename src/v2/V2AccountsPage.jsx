import { useEffect, useMemo, useState } from 'react';
import {
    fetchProjects,
    fetchDeals,
    fetchCases,
    fmt$,
    dealValue,
    DEAL_CLOSED_STAGES,
} from './safe-data.js';

/* ============================================
   V2 ACCOUNTS LIST

   No dedicated "accounts" table exists in the
   schema yet — accounts are derived client-side
   by grouping projects + deals + cases by
   client/company name. Each card shows the
   mini lifecycle pipeline based on what's
   currently active for that account.
============================================ */

const LIFECYCLE_STEPS = ['Sig', 'Out', 'Deal', 'Won', 'Proj', 'Ong'];

function lifecycleState(account) {
    // signals: out of scope for this pass; treat as "unknown"
    // outreach: if no closed deals + no projects, still in early stages
    // deal: any open deal
    // won: any closed-won deal
    // proj: any active project
    // ong: completed projects without active work
    const hasOpenDeal = account.deals.some((d) => !DEAL_CLOSED_STAGES.find((s) => s.id === d.stage));
    const hasWonDeal  = account.deals.some((d) => d.stage === 'won');
    const hasActiveProject = account.projects.some((p) => p.status === 'active');
    const hasCompletedProject = account.projects.some((p) => p.status === 'completed');

    if (hasActiveProject) return 4;     // Proj
    if (hasWonDeal && !hasActiveProject) return 3; // Won
    if (hasOpenDeal) return 2;          // Deal
    if (hasCompletedProject) return 5;  // Ong
    return 1;                            // Outreach (fallback)
}

function MiniLifecycle({ currentStep }) {
    return (
        <div className="v2-mini-lifecycle">
            <div className="v2-mini-lifecycle__label">Lifecycle</div>
            <div className="v2-mini-lifecycle__steps">
                {LIFECYCLE_STEPS.map((label, i) => {
                    let cls = 'v2-mini-lifecycle__step';
                    if (i < currentStep) cls += ' is-past';
                    if (i === currentStep) cls += ' is-current';
                    return (
                        <div key={label} className={cls}>
                            <span className="v2-mini-lifecycle__step-node" />
                            <span className="v2-mini-lifecycle__step-label">{label}</span>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}

function logoColor(name) {
    const colors = ['orange', 'purple', 'blue', 'teal', 'brick', 'olive'];
    let hash = 0;
    for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
    return colors[hash % colors.length];
}

export default function V2AccountsPage({ onSelect }) {
    const [projects, setProjects] = useState([]);
    const [deals, setDeals] = useState([]);
    const [cases, setCases] = useState([]);
    const [filter, setFilter] = useState('all');
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                setLoading(true);
                setError(null);
                const [ps, ds, cs] = await Promise.all([
                    fetchProjects().catch(() => []),
                    fetchDeals().catch(() => []),
                    fetchCases().catch(() => []),
                ]);
                if (cancelled) return;
                setProjects(ps);
                setDeals(ds);
                setCases(cs);
            } catch (err) {
                if (!cancelled) setError(err.message || 'Failed to load accounts');
            } finally {
                if (!cancelled) setLoading(false);
            }
        })();
        return () => { cancelled = true; };
    }, []);

    const accounts = useMemo(() => {
        const map = new Map();
        const ensure = (name) => {
            if (!name) return null;
            if (!map.has(name)) map.set(name, { name, projects: [], deals: [], cases: [], lastActivity: null });
            return map.get(name);
        };
        const bump = (acc, dateStr) => {
            if (!dateStr) return;
            const d = new Date(dateStr).getTime();
            if (!acc.lastActivity || d > acc.lastActivity) acc.lastActivity = d;
        };
        for (const p of projects) {
            const a = ensure(p.client_name || p.name);
            if (!a) continue;
            a.projects.push(p);
            bump(a, p.updated_at || p.created_at);
        }
        for (const d of deals) {
            const a = ensure(d.company_name);
            if (!a) continue;
            a.deals.push(d);
            bump(a, d.updated_at || d.created_at);
        }
        for (const c of cases) {
            const a = ensure(c.client_name || c.company_name);
            if (!a) continue;
            a.cases.push(c);
            bump(a, c.updated_at || c.created_at);
        }
        return Array.from(map.values()).sort((a, b) => (b.lastActivity || 0) - (a.lastActivity || 0));
    }, [projects, deals, cases]);

    const stats = useMemo(() => {
        const activeClients = accounts.filter((a) => a.projects.some((p) => p.status === 'active')).length;
        const openDeals = accounts.reduce((sum, a) => sum + a.deals.filter((d) => !DEAL_CLOSED_STAGES.find((s) => s.id === d.stage)).length, 0);
        const prospects = accounts.filter((a) => !a.projects.length && a.deals.length).length;
        const past = accounts.filter((a) => a.projects.some((p) => p.status === 'completed') && !a.projects.some((p) => p.status === 'active') && !a.deals.some((d) => !DEAL_CLOSED_STAGES.find((s) => s.id === d.stage))).length;
        return { activeClients, openDeals, prospects, past };
    }, [accounts]);

    const visible = useMemo(() => {
        if (filter === 'all') return accounts;
        if (filter === 'active') return accounts.filter((a) => a.projects.some((p) => p.status === 'active'));
        if (filter === 'prospects') return accounts.filter((a) => !a.projects.length && a.deals.length);
        if (filter === 'past') return accounts.filter((a) => a.projects.some((p) => p.status === 'completed') && !a.projects.some((p) => p.status === 'active'));
        return accounts;
    }, [accounts, filter]);

    return (
        <>
            <div className="v2-page-header">
                <div>
                    <div className="v2-page-header__eyebrow">your network</div>
                    <h1 className="v2-page-title">
                        Accounts
                        {accounts.length > 0 && (
                            <span className="v2-page-title__count">
                                {accounts.length} {accounts.length === 1 ? 'company' : 'companies'} · {stats.activeClients} active
                            </span>
                        )}
                    </h1>
                    <p className="v2-page-subtitle">
                        {loading ? 'Loading from Supabase…' : 'Derived from projects, deals, and cases'}
                    </p>
                </div>
            </div>

            {error && <div className="v2-error">Couldn't load accounts: {error}</div>}

            <div className="v2-stat-row">
                <div className="v2-stat-card">
                    <div className="v2-stat-card__label">Active clients</div>
                    <div className="v2-stat-card__value">{stats.activeClients}</div>
                    <div className="v2-stat-card__delta">in project</div>
                </div>
                <div className="v2-stat-card">
                    <div className="v2-stat-card__label">Open deals</div>
                    <div className="v2-stat-card__value">{stats.openDeals}</div>
                    <div className="v2-stat-card__delta">across accounts</div>
                </div>
                <div className="v2-stat-card">
                    <div className="v2-stat-card__label">Prospects</div>
                    <div className="v2-stat-card__value">{stats.prospects}</div>
                    <div className="v2-stat-card__delta">no project yet</div>
                </div>
                <div className="v2-stat-card">
                    <div className="v2-stat-card__label">Past clients</div>
                    <div className="v2-stat-card__value">{stats.past}</div>
                    <div className="v2-stat-card__delta">retention candidates</div>
                </div>
            </div>

            <div className="v2-toolbar">
                <div className="v2-segmented">
                    <button type="button" className={`v2-segmented__item ${filter === 'all' ? 'is-active' : ''}`} onClick={() => setFilter('all')}>All</button>
                    <button type="button" className={`v2-segmented__item ${filter === 'active' ? 'is-active' : ''}`} onClick={() => setFilter('active')}>Active</button>
                    <button type="button" className={`v2-segmented__item ${filter === 'prospects' ? 'is-active' : ''}`} onClick={() => setFilter('prospects')}>Prospects</button>
                    <button type="button" className={`v2-segmented__item ${filter === 'past' ? 'is-active' : ''}`} onClick={() => setFilter('past')}>Past</button>
                </div>
            </div>

            {loading && <div className="v2-empty"><strong>Loading…</strong></div>}

            {!loading && visible.length === 0 && (
                <div className="v2-empty">
                    <strong>No accounts match this filter</strong>
                    Switch to "All" or add projects/deals to populate this view.
                </div>
            )}

            <div className="v2-account-grid">
                {!loading && visible.map((acc) => {
                    const step = lifecycleState(acc);
                    const color = logoColor(acc.name);
                    const openDeals = acc.deals.filter((d) => !DEAL_CLOSED_STAGES.find((s) => s.id === d.stage));
                    const activeProjects = acc.projects.filter((p) => p.status === 'active');
                    const openCases = acc.cases.filter((c) => c.status !== 'resolved' && c.status !== 'closed');
                    const openValue = openDeals.reduce((sum, d) => sum + dealValue(d), 0);
                    return (
                        <button
                            key={acc.name}
                            type="button"
                            className="v2-account-card"
                            onClick={() => onSelect && onSelect(acc.name)}
                        >
                            <div className="v2-account-card__head">
                                <div className={`v2-account-card__logo v2-account-card__logo--${color}`}>
                                    {acc.name.slice(0, 1).toUpperCase()}
                                </div>
                                <div className="v2-account-card__head-body">
                                    <div className="v2-account-card__name">{acc.name}</div>
                                    <div className="v2-account-card__meta">
                                        {acc.projects.length} project{acc.projects.length === 1 ? '' : 's'} · {acc.deals.length} deal{acc.deals.length === 1 ? '' : 's'}
                                    </div>
                                </div>
                            </div>

                            <MiniLifecycle currentStep={step} />

                            <div className="v2-account-work">
                                {activeProjects.length > 0 && (
                                    <span className="v2-work-pill v2-work-pill--project">
                                        <span className="v2-work-pill__dot" />
                                        {activeProjects.length} active project{activeProjects.length === 1 ? '' : 's'}
                                    </span>
                                )}
                                {openDeals.length > 0 && (
                                    <span className="v2-work-pill v2-work-pill--deal">
                                        <span className="v2-work-pill__dot" />
                                        {openDeals.length} open · {fmt$(openValue)}
                                    </span>
                                )}
                                {openCases.length > 0 && (
                                    <span className="v2-work-pill v2-work-pill--support">
                                        <span className="v2-work-pill__dot" />
                                        {openCases.length} case{openCases.length === 1 ? '' : 's'}
                                    </span>
                                )}
                                {activeProjects.length === 0 && openDeals.length === 0 && openCases.length === 0 && (
                                    <span className="v2-work-pill">
                                        <span className="v2-work-pill__dot" style={{ background: 'var(--crm-text-3)' }} />
                                        Quiet
                                    </span>
                                )}
                            </div>
                        </button>
                    );
                })}
            </div>
        </>
    );
}
