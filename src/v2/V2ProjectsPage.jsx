import { useCallback, useEffect, useMemo, useState } from 'react';
import {
    fetchProjects,
    fetchArchivedProjects,
    fetchMilestones,
    fetchProjectTasks,
    fetchProjectFiles,
    fmtDate,
} from './safe-data.js';
import {
    restoreProject,
    deleteProject,
} from './write-data.js';
import V2Modal from './V2Modal.jsx';
import V2Confirm from './V2Confirm.jsx';
import ProjectForm from './forms/ProjectForm.jsx';

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

// Status filter options. Mirrors lib/projects PROJECT_STATUSES — no 'review'
// since legacy doesn't define that status (the old V2 filter was a dead
// option that never matched anything). 'archived' is special: it switches
// to a separate fetch (fetchArchivedProjects) rather than filtering the
// active list.
const STATUS_FILTERS = [
    { id: 'all',       label: 'All' },
    { id: 'active',    label: 'Active' },
    { id: 'on_hold',   label: 'On Hold' },
    { id: 'completed', label: 'Completed' },
    { id: 'cancelled', label: 'Cancelled' },
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

export default function V2ProjectsPage({ onSelect }) {
    const [projects, setProjects] = useState([]);
    const [archived, setArchived] = useState([]);
    const [rowsMeta, setRowsMeta] = useState({});  // { [projectId]: { next, progress, totalTasks, doneTasks, fileCount } }
    const [filter, setFilter] = useState('all');
    const [restoreTarget, setRestoreTarget] = useState(null); // null | project
    const [deleteTarget, setDeleteTarget] = useState(null);   // null | project
    const [working, setWorking] = useState(false);
    const [toast, setToast] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [showNewModal, setShowNewModal] = useState(false);

    const load = useCallback(async () => {
        try {
            setLoading(true);
            setError(null);

            // Active and archived load in parallel so flipping the filter
            // doesn't trigger a second round-trip.
            const [list, archivedList] = await Promise.all([
                fetchProjects(),
                fetchArchivedProjects().catch(() => []),
            ]);
            setProjects(list);
            setArchived(archivedList);

            // Per-project meta: next milestone, progress, task count, and
            // file count. One round-trip per project, all in parallel.
            const metaEntries = await Promise.all(
                list.map(async (p) => {
                    try {
                        const [milestones, tasks, files] = await Promise.all([
                            fetchMilestones(p.id),
                            fetchProjectTasks(p.id),
                            fetchProjectFiles(p.id).catch(() => []),
                        ]);
                        const next = pickNextMilestone(milestones);
                        const total = tasks.length;
                        const done = tasks.filter((t) => t.completed).length;
                        const progress = total ? Math.round((done / total) * 100) : 0;
                        return [p.id, { next, progress, total, done, fileCount: files.length }];
                    } catch (err) {
                        console.warn('Failed to load meta for project', p.id, err);
                        return [p.id, null];
                    }
                })
            );
            setRowsMeta(Object.fromEntries(metaEntries));
        } catch (err) {
            setError(err.message || 'Failed to load projects');
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

    const handleRestore = useCallback(async () => {
        if (!restoreTarget) return;
        setWorking(true);
        try {
            await restoreProject(restoreTarget.id);
            setRestoreTarget(null);
            await load();
            setFilter('active');
            setToast({ kind: 'win', text: `Restored ${restoreTarget.name}.` });
        } catch (err) {
            setToast({ kind: 'warn', text: err.message || 'Couldn\'t restore' });
        } finally {
            setWorking(false);
        }
    }, [restoreTarget, load]);

    const handleHardDelete = useCallback(async () => {
        if (!deleteTarget) return;
        setWorking(true);
        try {
            await deleteProject(deleteTarget.id);
            setDeleteTarget(null);
            await load();
            setToast({ kind: 'info', text: `Deleted ${deleteTarget.name}.` });
        } catch (err) {
            setToast({ kind: 'warn', text: err.message || 'Couldn\'t delete' });
        } finally {
            setWorking(false);
        }
    }, [deleteTarget, load]);

    const visible = useMemo(() => {
        if (filter === 'archived') return archived;
        if (filter === 'all') return projects;
        return projects.filter((p) => p.status === filter);
    }, [projects, archived, filter]);
    const viewingArchived = filter === 'archived';

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
                <div className="v2-page-header__actions">
                    <button
                        type="button"
                        className="v2-btn v2-btn--primary"
                        onClick={() => setShowNewModal(true)}
                    >
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 5v14M5 12h14"/></svg>
                        New project
                    </button>
                </div>
            </div>

            <V2Modal
                open={showNewModal}
                onClose={() => setShowNewModal(false)}
                eyebrow="new engagement"
                title="Create a project"
            >
                <ProjectForm
                    onSaved={() => { setShowNewModal(false); load(); }}
                    onCancel={() => setShowNewModal(false)}
                />
            </V2Modal>

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
                        <strong>
                            {viewingArchived
                                ? 'No archived projects'
                                : 'No projects match this filter'}
                        </strong>
                        {viewingArchived
                            ? 'Projects you archive will land here. Restore them to bring them back.'
                            : filter !== 'all' && 'Try switching to "All" or change the project status.'}
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
                    const fileCount = meta?.fileCount ?? 0;

                    return (
                        <div
                            key={p.id}
                            className={`v2-project-row ${viewingArchived ? 'is-archived' : ''}`}
                            onClick={() => !viewingArchived && onSelect && onSelect(p.id)}
                            style={viewingArchived ? { cursor: 'default' } : null}
                        >
                            <div className="v2-project-cell-name">
                                <span className={statusDotClass(p.status)} />
                                <div className="v2-project-cell-name__body">
                                    <div className="v2-project-cell-name__title">{p.name}</div>
                                    <div className="v2-project-cell-name__client">
                                        {p.client_name || 'No client'}
                                        {p.contact_name && <> · {p.contact_name}</>}
                                    </div>
                                </div>
                                {fileCount > 0 && (
                                    <span className="v2-project-row__file-badge" title={`${fileCount} file${fileCount === 1 ? '' : 's'}`}>
                                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 11v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h6"/><path d="M17 3l4 4-9 9H8v-4z"/></svg>
                                        {fileCount}
                                    </span>
                                )}
                            </div>

                            <div>
                                <span className={statusChipClass(p.status)}>
                                    {statusLabel(p.status)}
                                </span>
                            </div>

                            <div className="v2-dates">
                                {viewingArchived ? (
                                    <span>
                                        {p.archived_at ? <>archived <strong>{fmtDate(p.archived_at)}</strong></> : 'archived'}
                                    </span>
                                ) : nextMs ? (
                                    <>
                                        <strong>{nextMs.name}</strong>
                                        {' · '}
                                        <span style={dueSoon ? { color: 'var(--v2-orange)', fontWeight: 600 } : null}>
                                            {nextMs.due_date ? fmtDate(nextMs.due_date) : 'no due date'}
                                        </span>
                                        {p.end_date && (
                                            <div style={{ fontSize: 11, color: 'var(--crm-text-3)', marginTop: 2 }}>
                                                Project ends {fmtDate(p.end_date)}
                                            </div>
                                        )}
                                    </>
                                ) : p.end_date ? (
                                    <>
                                        <em>No milestones</em>
                                        <div style={{ fontSize: 11, color: 'var(--crm-text-3)', marginTop: 2 }}>
                                            ends {fmtDate(p.end_date)}
                                        </div>
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
                                {viewingArchived ? (
                                    <div className="v2-row-actions__archived">
                                        <button
                                            type="button"
                                            className="v2-row-actions__link"
                                            onClick={(e) => { e.stopPropagation(); setRestoreTarget(p); }}
                                        >
                                            Restore
                                        </button>
                                        <button
                                            type="button"
                                            className="v2-row-actions__link v2-row-actions__link--danger"
                                            onClick={(e) => { e.stopPropagation(); setDeleteTarget(p); }}
                                        >
                                            Delete
                                        </button>
                                    </div>
                                ) : (
                                    <svg viewBox="0 0 24 24"><circle cx="12" cy="5" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="12" cy="19" r="1"/></svg>
                                )}
                            </div>
                        </div>
                    );
                })}
            </div>

            {/* Toast */}
            {toast && (
                <div className={`v2-toast v2-toast--${toast.kind}`}>
                    <span className="v2-toast__icon">{toast.kind === 'win' ? '✓' : toast.kind === 'warn' ? '!' : '·'}</span>
                    <span>{toast.text}</span>
                </div>
            )}

            {/* Restore confirm */}
            <V2Confirm
                open={restoreTarget !== null}
                onClose={() => setRestoreTarget(null)}
                onConfirm={handleRestore}
                eyebrow="restore"
                title="Restore this project?"
                description={restoreTarget ? `${restoreTarget.name} will move back to the active list.` : null}
                confirmLabel="Restore"
                confirmTone="primary"
                loading={working}
            />

            {/* Hard delete confirm */}
            <V2Confirm
                open={deleteTarget !== null}
                onClose={() => setDeleteTarget(null)}
                onConfirm={handleHardDelete}
                eyebrow="careful"
                title="Permanently delete this project?"
                description={deleteTarget ? `${deleteTarget.name} and all its milestones, tasks, and files will be permanently removed. This can't be undone.` : null}
                confirmLabel="Delete permanently"
                confirmTone="danger"
                loading={working}
            />
        </>
    );
}
