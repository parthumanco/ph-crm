import { useEffect, useMemo, useState } from 'react';
import {
    fetchProjects,
    fetchMilestones,
    fetchProjectTasks,
    fmtDate,
} from './safe-data.js';

/* ============================================
   V2 PROJECTS PAGE

   Wires the redesigned Projects list to the
   existing Supabase data layer. Pulls projects
   + their milestones + tasks in parallel so we
   can show "next milestone" and overall progress
   per row without changing the schema.

   Status semantics mirror the legacy app's
   PROJECT_STATUSES (active / on_hold / completed /
   cancelled) plus a derived "at_risk" surface
   when the soonest milestone is within 7 days
   and the project isn't yet half done.
============================================ */

const STATUS_FILTERS = [
    { id: 'all',       label: 'All' },
    { id: 'active',    label: 'Active' },
    { id: 'on_hold',   label: 'On Hold' },
    { id: 'review',    label: 'Review' },
    { id: 'completed', label: 'Completed' },
    { id: 'archived',  label: 'Archived' },
];

function daysFromNow(dateStr) {
    if (!dateStr) return null;
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return null;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return Math.round((d - today) / 86400000);
}

function pickNextMilestone(milestones) {
    if (!milestones?.length) return null;
    const sorted = [...milestones].sort((a, b) => {
        const ax = new Date(a.due_date || a.start_date || 0).getTime();
        const bx = new Date(b.due_date || b.start_date || 0).getTime();
        return ax - bx;
    });
    return (
        sorted.find((m) => m.status === 'in_progress' || m.status === 'not_started') ||
        sorted[sorted.length - 1]
    );
}

function statusLabel(id) {
    switch (id) {
        case 'active':    return 'Active';
        case 'on_hold':   return 'On hold';
        case 'completed': return 'Completed';
        case 'cancelled': return 'Cancelled';
        default:          return id || 'Unknown';
    }
}

function statusChipClass(status) {
    if (status === 'on_hold')   return 'v2-status-chip v2-status-chip--hold';
    if (status === 'completed' || status === 'cancelled') return `v2-status-chip v2-status-chip--${status}`;
    return 'v2-status-chip';
}

function statusDotClass(status) {
    if (status === 'on_hold')   return 'v2-project-cell-name__dot v2-project-cell-name__dot--hold';
    if (status === 'completed') return 'v2-project-cell-name__dot v2-project-cell-name__dot--completed';
    if (status === 'cancelled') return 'v2-project-cell-name__dot v2-project-cell-name__dot--cancelled';
    return 'v2-project-cell-name__dot';
}

export default function V2ProjectsPage() {
    const [projects, setProjects] = useState([]);
    const [rowsMeta, setRowsMeta] = useState({});  // { [projectId]: { nextMilestone, progress, totalTasks, doneTasks } }
    const [filter, setFilter] = useState('all');
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                setLoading(true);
                setError(null);
                const list = await fetchProjects();
                if (cancelled) return;
                setProjects(list);

                // Pull milestones + tasks for each project in parallel.
                // Failures on individual projects shouldn't take down the page.
                const metaEntries = await Promise.all(
                    list.map(async (p) => {
                        try {
                            const [milestones, tasks] = await Promise.all([
                                fetchMilestones(p.id),
                                fetchProjectTasks(p.id),
                            ]);
                            const next = pickNextMilestone(milestones);
                            const total = tasks.length;
                            const done = tasks.filter((t) => t.completed).length;
                            const progress = total ? Math.round((done / total) * 100) : 0;
                            return [p.id, { next, progress, total, done }];
                        } catch (err) {
                            console.warn('Failed to load meta for project', p.id, err);
                            return [p.id, null];
                        }
                    })
                );
                if (cancelled) return;
                setRowsMeta(Object.fromEntries(metaEntries));
            } catch (err) {
                if (cancelled) return;
                setError(err.message || 'Failed to load projects');
            } finally {
                if (!cancelled) setLoading(false);
            }
        })();
        return () => { cancelled = true; };
    }, []);

    const visible = useMemo(() => {
        if (filter === 'all') return projects;
        if (filter === 'archived') return [];  // archived list isn't fetched in this view yet
        return projects.filter((p) => p.status === filter);
    }, [projects, filter]);

    const stats = useMemo(() => {
        const active = projects.filter((p) => p.status === 'active').length;
        const onHold = projects.filter((p) => p.status === 'on_hold').length;
        let dueSoon = 0;
        let atRisk = 0;
        for (const p of projects) {
            const meta = rowsMeta[p.id];
            if (!meta?.next?.due_date) continue;
            const days = daysFromNow(meta.next.due_date);
            if (days === null) continue;
            if (days <= 7 && days >= 0) dueSoon += 1;
            if (days <= 7 && meta.progress < 50) atRisk += 1;
        }
        return { active, onHold, dueSoon, atRisk };
    }, [projects, rowsMeta]);

    return (
        <>
            {/* PAGE HEADER (editorial pattern) */}
            <div className="v2-page-header">
                <div>
                    <div className="v2-page-header__eyebrow">currently in flight</div>
                    <h1 className="v2-page-title">
                        Projects
                        {projects.length > 0 && (
                            <span className="v2-page-title__count">
                                {projects.length} {projects.length === 1 ? 'engagement' : 'engagements'}
                            </span>
                        )}
                    </h1>
                    <p className="v2-page-subtitle">
                        {loading
                            ? 'Loading from Supabase…'
                            : `${stats.active} active · ${stats.dueSoon} due this week${stats.atRisk ? ` · ${stats.atRisk} at risk` : ''}`}
                    </p>
                </div>
            </div>

            {error && <div className="v2-error">Couldn't load projects: {error}</div>}

            {/* STATS */}
            <div className="v2-stat-row">
                <div className="v2-stat-card">
                    <div className="v2-stat-card__label">Active</div>
                    <div className="v2-stat-card__value">{stats.active}</div>
                    <div className="v2-stat-card__delta">{projects.length} total</div>
                </div>
                <div className="v2-stat-card">
                    <div className="v2-stat-card__label">Due this week</div>
                    <div className="v2-stat-card__value">{stats.dueSoon}</div>
                    <div className={`v2-stat-card__delta ${stats.atRisk ? 'v2-warn' : ''}`}>
                        {stats.atRisk ? `${stats.atRisk} at risk` : 'on track'}
                    </div>
                </div>
                <div className="v2-stat-card">
                    <div className="v2-stat-card__label">On hold</div>
                    <div className="v2-stat-card__value">{stats.onHold}</div>
                    <div className="v2-stat-card__delta">awaiting client</div>
                </div>
                <div className="v2-stat-card">
                    <div className="v2-stat-card__label">Filter</div>
                    <div className="v2-stat-card__value">{visible.length}</div>
                    <div className="v2-stat-card__delta">{filter === 'all' ? 'all engagements' : `status: ${statusLabel(filter)}`}</div>
                </div>
            </div>

            {/* FILTER */}
            <div className="v2-toolbar">
                <div className="v2-segmented">
                    {STATUS_FILTERS.map((f) => (
                        <button
                            key={f.id}
                            type="button"
                            className={`v2-segmented__item ${filter === f.id ? 'is-active' : ''}`}
                            onClick={() => setFilter(f.id)}
                        >
                            {f.label}
                        </button>
                    ))}
                </div>
            </div>

            {/* LIST */}
            <div className="v2-project-list">
                <div className="v2-project-list__header">
                    <div>Project</div>
                    <div>Status</div>
                    <div>Next milestone</div>
                    <div>Progress</div>
                    <div></div>
                </div>

                {loading && (
                    <div className="v2-empty">
                        <strong>Loading…</strong>
                        Pulling projects from Supabase. If this hangs, check your <code>.env</code>.
                    </div>
                )}

                {!loading && visible.length === 0 && (
                    <div className="v2-empty">
                        <strong>No projects match this filter</strong>
                        {filter !== 'all' && 'Try switching to "All" or change the project status.'}
                    </div>
                )}

                {!loading && visible.map((p) => {
                    const meta = rowsMeta[p.id];
                    const nextMs = meta?.next;
                    const dueDays = nextMs?.due_date ? daysFromNow(nextMs.due_date) : null;
                    const dueSoon = dueDays !== null && dueDays <= 7 && dueDays >= 0;
                    const progress = meta?.progress ?? 0;
                    const total = meta?.total ?? 0;
                    const done = meta?.done ?? 0;

                    return (
                        <div key={p.id} className="v2-project-row">
                            <div className="v2-project-cell-name">
                                <span className={statusDotClass(p.status)} />
                                <div className="v2-project-cell-name__body">
                                    <div className="v2-project-cell-name__title">{p.name}</div>
                                    <div className="v2-project-cell-name__client">
                                        {p.client_name || 'No client'}
                                    </div>
                                </div>
                            </div>

                            <div>
                                <span className={statusChipClass(p.status)}>
                                    {statusLabel(p.status)}
                                </span>
                            </div>

                            <div className="v2-dates">
                                {nextMs ? (
                                    <>
                                        <strong>{nextMs.name}</strong>
                                        {' · '}
                                        <span style={dueSoon ? { color: 'var(--v2-orange)', fontWeight: 600 } : null}>
                                            {nextMs.due_date ? fmtDate(nextMs.due_date) : 'no due date'}
                                        </span>
                                    </>
                                ) : (
                                    <em>No milestones</em>
                                )}
                            </div>

                            <div className="v2-progress">
                                <div className="v2-progress__bar">
                                    <span
                                        className={`v2-progress__fill ${
                                            p.status === 'completed' ? 'v2-progress__fill--gray'
                                            : dueSoon && progress < 50 ? 'v2-progress__fill--orange'
                                            : ''
                                        }`}
                                        style={{ width: `${progress}%` }}
                                    />
                                </div>
                                <div className="v2-progress__label">{done} / {total} tasks</div>
                            </div>

                            <div className="v2-row-actions">
                                <svg viewBox="0 0 24 24"><circle cx="12" cy="5" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="12" cy="19" r="1"/></svg>
                            </div>
                        </div>
                    );
                })}
            </div>
        </>
    );
}
